// GoodTrip AIO settings codes, the same format as the mod's settings.lua:
// "1", then Crockford base-32 bits: how many settings (3-bit groups), then per
// setting its number in the code key list (9 bits), whether it is a change on
// top of the vanilla look (1 bit), and its value (a switch 1 bit; anything else
// a whole number in 3-bit groups).
(function (root) {
  "use strict";
  const B32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  const B32_VALUE = {};
  for (let i = 0; i < 32; i++) B32_VALUE[B32[i]] = i;

  function isNone(v) { return v === undefined || v === null; }
  function same(a, b) { return (isNone(a) && isNone(b)) || a === b; }

  function toInt(o, v) {
    if (o.kind === "key" || o.kind === "pad") return isNone(v) ? 0 : v + 1;
    const step = o.kind === "number" ? (o.step || 1) : 1;
    const n = Math.floor(v / step + 0.5);
    return n >= 0 ? n * 2 : -n * 2 - 1;
  }
  function fromInt(o, n) {
    if (o.kind === "key" || o.kind === "pad") return n > 0 ? n - 1 : null;
    const z = n % 2 === 0 ? n / 2 : -(n + 1) / 2;
    if (o.kind === "number") return Math.floor(z * (o.step || 1) * 1000 + 0.5) / 1000;
    return z;
  }

  // values: key -> value for every stored setting (missing = default);
  // vanilla: key -> value changed on top of the vanilla look, or null
  function encode(S, values, vanilla) {
    const entries = [];
    if (vanilla) {
      S.codeKeys.forEach((k, i) => {
        if (S.options[k] && !isNone(vanilla[k])) entries.push([i, true, S.options[k], vanilla[k]]);
      });
    }
    S.codeKeys.forEach((k, i) => {
      const o = S.options[k];
      if (!o) return;
      const v = k in values ? values[k] : o.default;
      if (!same(v, o.default)) entries.push([i, false, o, v]);
    });
    if (entries.length === 0) return "";
    const bits = [];
    const put = (n, w) => { for (let i = w - 1; i >= 0; i--) bits.push(Math.floor(n / 2 ** i) % 2); };
    const varint = (n) => {
      do {
        const chunk = n % 8;
        n = Math.floor(n / 8);
        put(n > 0 ? 1 : 0, 1); put(chunk, 3);
      } while (n > 0);
    };
    varint(entries.length);
    for (const [i, van, o, v] of entries) {
      put(i, 9); put(van ? 1 : 0, 1);
      if (o.kind === "bool") put(v ? 1 : 0, 1); else varint(toInt(o, v));
    }
    while (bits.length % 5) bits.push(0);
    let out = "1";
    for (let i = 0; i < bits.length; i += 5) {
      out += B32[bits[i] * 16 + bits[i + 1] * 8 + bits[i + 2] * 4 + bits[i + 3] * 2 + bits[i + 4]];
    }
    return out;
  }

  // -> { values, vanilla, known, unknown } or throws an Error saying why
  function decode(S, code) {
    code = String(code || "").replace(/[\s-]/g, "").toUpperCase().replace(/O/g, "0").replace(/[IL]/g, "1");
    if (code[0] !== "1") throw new Error("That is not a GoodTrip settings code (they start with 1).");
    const bits = [];
    for (const ch of code.slice(1)) {
      const n = B32_VALUE[ch];
      if (n === undefined) throw new Error("The code has a character that cannot be in one: " + ch);
      for (let b = 4; b >= 0; b--) bits.push((n >> b) & 1);
    }
    let pos = 0;
    const get = (w) => {
      if (pos + w > bits.length) throw new Error("The code is cut short or mistyped.");
      let n = 0;
      for (let i = 0; i < w; i++) n = n * 2 + bits[pos++];
      return n;
    };
    const varint = () => {
      let n = 0, mul = 1, more;
      do { more = get(1); n += get(3) * mul; mul *= 8; } while (more && mul < 2 ** 33);
      return n;
    };
    const values = {}, vanilla = {};
    let known = 0, unknown = 0;
    if (bits.length > 0) {
      const count = varint();
      for (let c = 0; c < count; c++) {
        const i = get(9), van = get(1) === 1;
        const k = S.codeKeys[i], o = k && S.options[k];
        if (!o) { unknown = count - c; break; } // a newer version's setting: its size is unknown
        const v = o.kind === "bool" ? get(1) === 1 : fromInt(o, varint());
        if (van) vanilla[k] = v; else values[k] = v;
        known++;
      }
    }
    return { values, vanilla: Object.keys(vanilla).length ? vanilla : null, known, unknown };
  }

  // a save file's settings (the mod's save1.dat is JSON)
  function fromSave(S, text) {
    let data;
    try { data = JSON.parse(text); } catch (e) { throw new Error("That file is not a GoodTrip AIO save (not JSON)."); }
    if (!data || typeof data !== "object") throw new Error("That file is not a GoodTrip AIO save.");
    const values = {};
    let found = 0;
    for (const k of Object.keys(S.options)) {
      if (S.options[k].both) continue;
      if (k in data) { values[k] = data[k]; found++; }
    }
    if (found === 0) throw new Error("No GoodTrip AIO settings in that file.");
    const vanilla = data.VanillaLook && typeof data.VanillaLook === "object" ? data.VanillaLook : null;
    return { values, vanilla, code: typeof data.SettingsCode === "string" ? data.SettingsCode : null };
  }

  // a save file for these settings: what the mod writes, the code first. The
  // widget's place and the click nudges keep their defaults.
  function toSave(S, values, vanilla) {
    const out = { SettingsCode: encode(S, values, vanilla) || "1" };
    for (const k of Object.keys(S.options).sort()) {
      const o = S.options[k];
      if (o.both) continue;
      const v = k in values ? values[k] : o.default;
      if (!isNone(v)) out[k] = v;
    }
    if (vanilla) out.VanillaLook = vanilla;
    for (const k of S.migrated) out[k] = true;
    return JSON.stringify(out);
  }

  function spaced(code) { return (code || "").replace(/(.{4})/g, "$1 ").trim(); }

  root.GTCodec = { encode, decode, fromSave, toSave, spaced, same, isNone };
  if (typeof module !== "undefined") module.exports = root.GTCodec;
})(typeof window !== "undefined" ? window : globalThis);

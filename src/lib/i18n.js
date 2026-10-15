// Bilingual catalogs live in src/messages/*.json (§26 apps/web/messages).
// Every visible string goes through t() / tx() so EN↔NE switch is instant.
import ne from "../messages/ne.json";
import en from "../messages/en.json";

// Recombined dictionary (kept for backwards-compat imports).
export const STR = {};
for (const k of Object.keys({ ...ne, ...en })) {
  STR[k] = { ne: ne[k], en: en[k] };
}

export function t(key, lang) {
  return STR[key]?.[lang] ?? STR[key]?.en ?? key;
}
// inline bilingual helper: tx("नेपाली", "English", lang)
export function tx(ne_, en_, lang) {
  return lang === "ne" ? ne_ : en_;
}
// Nepali digits — per-user option (§34 localisation).
const NP = ["०", "१", "२", "३", "४", "५", "६", "७", "८", "९"];
export function toNpDigits(s) {
  return String(s).replace(/[0-9]/g, (d) => NP[Number(d)]);
}
export function digits(s, lang, npDigits) {
  return lang === "ne" && npDigits ? toNpDigits(s) : String(s);
}

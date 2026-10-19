// Collects every translatable string (t("...") and tx("...") calls, plus city and country names)
// into lib/i18n/source-strings.json, and reports which ones each locale is still missing.
// Usage: node scripts/extract-strings.mjs
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const dirs = ["app", "components", "lib", "context"];
const files = [];
const walk = (d) => {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(tsx?|jsx?)$/.test(f)) files.push(p);
  }
};
dirs.forEach((d) => walk(join(root, d)));

const strings = new Set();
const call = /\btx?\(\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|`((?:[^`\\$]|\\.)*)`)/g;
for (const f of files) {
  const src = readFileSync(f, "utf8");
  for (const m of src.matchAll(call)) {
    const raw = m[1] ?? m[2] ?? m[3];
    if (raw === undefined || !/[A-Za-z]/.test(raw)) continue;
    strings.add(JSON.parse(`"${raw.replace(/\\'/g, "'").replace(/"/g, '\\"')}"`));
  }
}

// City and country names shown through t(city.name) / t(city.country).
const cities = readFileSync(join(root, "components", "aseanCities.ts"), "utf8");
for (const m of cities.matchAll(/(?:name|country): "([^"]+)"/g)) strings.add(m[1]);

// Messages that come from the API server and are shown through t(...).
[
  "The AI service rejected the server's API key.",
  "The AI account has run out of credits.",
  "The free AI models are busy right now. Please try again in a moment.",
  "The AI service is unavailable right now.",
  "The AI service did not respond in time.",
  "The AI service stopped responding.",
  "The connection to the AI service dropped.",
  "The AI model returned an empty answer. Please try again.",
  "This invite code wasn't found or has already been used.",
].forEach((s) => strings.add(s));

const list = [...strings].sort((a, b) => a.localeCompare(b));
writeFileSync(join(root, "lib", "i18n", "source-strings.json"), JSON.stringify(list, null, 2) + "\n");
console.log(`${list.length} strings from ${files.length} files`);

for (const code of ["ms", "zh-HK", "zh-CN", "hi", "ta", "te"]) {
  const dict = JSON.parse(readFileSync(join(root, "lib", "i18n", "locales", `${code}.json`), "utf8"));
  const missing = list.filter((s) => !dict[s]);
  const badVars = list.filter((s) => dict[s] && [...s.matchAll(/\{(\w+)\}/g)].some((v) => !dict[s].includes(v[0])));
  console.log(`${code}: ${list.length - missing.length}/${list.length} translated${badVars.length ? `, ${badVars.length} with missing {placeholders}` : ""}`);
  if (process.argv.includes("--verbose")) missing.forEach((s) => console.log(`  missing: ${s}`));
}

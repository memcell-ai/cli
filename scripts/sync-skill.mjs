// The skill has two homes: the file the plugin installs, and the string
// compiled into the package (dist ships without plugins/, so it cannot be
// read at runtime). This copies the file into the string. test/skill.test.ts
// fails if they drift — which is what happens whenever the markdown is
// reformatted, so run this after.

import { readFileSync, writeFileSync } from "node:fs";

const skill = readFileSync("plugins/memcell/SKILL.md", "utf8");
const escaped = skill.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");

const at = "src/adapters/skill.ts";
const source = readFileSync(at, "utf8");
const start = source.indexOf("const SKILL = `");
const end = source.indexOf("\n`;\n", start) + "\n`;\n".length;
if (start < 0 || end <= start) throw new Error(`no SKILL template found in ${at}`);

const next =
  source.slice(0, start) + "const SKILL = `" + escaped.replace(/\n+$/, "") + "\n`;\n" + source.slice(end);
if (next === source) {
  console.log("skill already in sync");
} else {
  writeFileSync(at, next);
  console.log(`skill synced into ${at}`);
}

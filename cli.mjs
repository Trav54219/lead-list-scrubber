#!/usr/bin/env node
// node cli.mjs leads.csv --dnc customers.csv --dnc unsubscribes.txt [--per-company 2] [--free-mail] > clean.csv
// Removed rows with reasons go to leads-removed.csv next to the input.
import { readFileSync, writeFileSync } from "node:fs";
import { buildSuppression, guessColumns, parseCsv, scrub, toCsv } from "./scrub.js";

const a = process.argv.slice(2);
const file = a.find((x, i) => !x.startsWith("--") && !a[i - 1]?.startsWith("--dnc") && !a[i - 1]?.startsWith("--per-company"));
if (!file) {
  console.error("usage: node cli.mjs leads.csv --dnc dnc.csv [--dnc more.txt] [--per-company N] [--free-mail] [--keep-roles] > clean.csv");
  process.exit(2);
}
const rows = parseCsv(readFileSync(file, "utf8"));
const sups = a.flatMap((x, i) => (x === "--dnc" ? [buildSuppression(a[i + 1], readFileSync(a[i + 1], "utf8"))] : []));
const cap = a.includes("--per-company") ? +a[a.indexOf("--per-company") + 1] : 0;
const r = scrub(rows, guessColumns(rows[0]), sups, { perCompany: cap, freeMail: a.includes("--free-mail"), role: !a.includes("--keep-roles") });
process.stdout.write(toCsv(r.kept) + "\n");
const out = file.replace(/\.csv$/i, "") + "-removed.csv";
writeFileSync(out, toCsv(r.removed) + "\n");
console.error(`${r.stats.input} in, ${r.stats.kept} kept, ${r.stats.removed} removed (${out})`);
for (const [k, v] of r.stats.reasons) console.error(`  ${String(v).padStart(6)}  ${k}`);

#!/usr/bin/env node
import { readFileSync } from "node:fs";

const version = process.argv[2];
if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
  console.error("usage: node scripts/changelog-section.mjs 0.1.0");
  process.exit(1);
}

const changelog = readFileSync("CHANGELOG.md", "utf8");
const heading = new RegExp(`^## \\[${escapeRegExp(version)}\\](?: - \\d{4}-\\d{2}-\\d{2})?$`, "m");
const match = heading.exec(changelog);
if (!match) {
  console.error(`CHANGELOG.md has no release section for ${version}`);
  process.exit(1);
}
const start = match.index;
const remainder = changelog.slice(start + match[0].length);
const nextSection = remainder.search(/^## /m);
const section = nextSection < 0 ? remainder : remainder.slice(0, nextSection);
process.stdout.write(`${match[0]}${section}`.trim() + "\n");

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

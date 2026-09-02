#!/usr/bin/env node
import { readFileSync } from "node:fs";

const version = process.argv[2];
if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
  console.error("usage: node scripts/verify-release.mjs 0.1.0");
  process.exit(1);
}

const packageVersion = JSON.parse(readFileSync("package.json", "utf8")).version;
const tauriVersion = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8")).version;
const cargo = readFileSync("Cargo.toml", "utf8");
const cargoMatch = cargo.match(/^\[workspace\.package\][^[]*?^version = "([^"]+)"/ms);
const cargoVersion = cargoMatch?.[1];
const changelog = readFileSync("CHANGELOG.md", "utf8");
const heading = new RegExp(`^## \\[${escapeRegExp(version)}\\](?: - \\d{4}-\\d{2}-\\d{2})?$`, "m");

if (packageVersion !== version || tauriVersion !== version || cargoVersion !== version) {
  console.error(
    `Tag v${version} does not match package.json (${packageVersion}), ` +
      `Cargo.toml (${cargoVersion}), or tauri.conf.json (${tauriVersion})`,
  );
  process.exit(1);
}
if (!heading.test(changelog)) {
  console.error(`CHANGELOG.md has no valid release section for ${version}`);
  process.exit(1);
}

console.log(`Release v${version} is consistent.`);

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

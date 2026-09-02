#!/usr/bin/env node
import { readFileSync } from "node:fs";

const config = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8"));
const workflow = readFileSync(".github/workflows/release.yml", "utf8");
const errors = [];

const updater = config.plugins?.updater;
const macOS = config.bundle?.macOS;

expect(
  config.bundle?.createUpdaterArtifacts === true,
  "bundle.createUpdaterArtifacts must be true",
);
expect(macOS?.signingIdentity !== "-", "macOS releases must not use ad-hoc signingIdentity '-' ");
expect(macOS?.hardenedRuntime === true, "bundle.macOS.hardenedRuntime must be true");
expect(
  isMinisignPublicKey(updater?.pubkey),
  "plugins.updater.pubkey must be a Tauri minisign public key",
);
expect(
  updater?.endpoints?.includes(
    "https://github.com/lucabmn/wavex/releases/latest/download/latest.json",
  ),
  "plugins.updater.endpoints must include the GitHub Releases latest.json feed",
);

for (const secret of [
  "APPLE_CERTIFICATE",
  "APPLE_CERTIFICATE_PASSWORD",
  "APPLE_ID",
  "APPLE_PASSWORD",
  "APPLE_TEAM_ID",
  "TAURI_SIGNING_PRIVATE_KEY",
  "TAURI_SIGNING_PRIVATE_KEY_PASSWORD",
]) {
  expect(
    workflow.includes(`secrets.${secret}`),
    `.github/workflows/release.yml must consume ${secret}`,
  );
}

for (const contract of [
  "tauri-apps/tauri-action@",
  "releaseDraft: true",
  "includeUpdaterJson: true",
  "--target aarch64-apple-darwin",
  "codesign --verify",
  "xcrun stapler validate",
  "spctl --assess",
  'gh release edit "$GITHUB_REF_NAME" --draft=false',
]) {
  expect(workflow.includes(contract), `.github/workflows/release.yml is missing: ${contract}`);
}

if (errors.length > 0) {
  console.error(`Distribution configuration is invalid:\n- ${errors.join("\n- ")}`);
  process.exit(1);
}

console.log("Distribution configuration is ready for signed, notarized updates.");

function expect(condition, message) {
  if (!condition) errors.push(message);
}

function isMinisignPublicKey(value) {
  if (typeof value !== "string" || value.length === 0) return false;
  try {
    const decoded = Buffer.from(value, "base64").toString("utf8");
    return decoded.startsWith("untrusted comment: minisign public key:");
  } catch {
    return false;
  }
}

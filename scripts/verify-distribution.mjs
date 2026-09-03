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
// Each release job passes its own `--bundles`, so the config has to leave every
// platform's bundle enabled rather than pin the macOS pair.
expect(
  config.bundle?.targets === "all",
  'bundle.targets must be "all" so each release job can select its own bundles',
);
// Tauri replaces arrays on a platform-config merge rather than deep-merging
// them, so each override has to redeclare the whole main window — and each has
// to drop the macOS-only `resources`, or Assets.car ships inside the installer.
for (const platform of ["windows", "linux"]) {
  const override = readOptional(`src-tauri/tauri.${platform}.conf.json`);
  expect(override != null, `src-tauri/tauri.${platform}.conf.json must exist`);
  expect(
    override?.bundle?.resources === null,
    `src-tauri/tauri.${platform}.conf.json must set bundle.resources to null`,
  );
  expect(
    override?.app?.windows?.[0]?.label === "main",
    `src-tauri/tauri.${platform}.conf.json must redeclare the main window`,
  );
}
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
  "--bundles ${{ matrix.bundles }} --target ${{ matrix.target }}",
  // Every supported platform needs a build job, or the updater feed publishes
  // with one of them silently missing.
  "target: aarch64-apple-darwin",
  "target: x86_64-unknown-linux-gnu",
  "target: x86_64-pc-windows-msvc",
  // Serialized because the jobs all rewrite one shared latest.json.
  "max-parallel: 1",
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

console.log("Distribution configuration is ready for macOS, Linux, and Windows updates.");

function readOptional(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

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

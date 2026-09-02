# Rework-Plan: wavex

Dieses Dokument beschreibt den vollständigen Umbau des Repositories. Es ist als
Arbeitsanweisung für einen ausführenden Agenten geschrieben: jede Phase hat ein
Ziel, eine konkrete Dateiliste, die auszuführenden Befehle, ein überprüfbares
Abnahmekriterium (Gate) und eine explizite Liste von Dingen, die in dieser Phase
nicht angefasst werden dürfen.

## Ausgangslage

Das Repository ist eine Kopie von [usemono.dev](https://usemono.dev) (MonoCode),
die als eigene Basis weiterentwickelt werden soll. Es ist eine Tauri-2-Desktop-App:
React 19 + TypeScript im Frontend, Rust im Backend, Vite als Bundler, Vitest für
Tests.

Umfang:

| Bereich              | Umfang                                           |
| -------------------- | ------------------------------------------------ |
| TypeScript/TSX       | 354 Dateien, ~90.500 Zeilen                      |
| Rust                 | 18 Dateien, ~15.650 Zeilen                       |
| Testdateien          | 96 (`*.test.ts`, direkt neben dem Produktivcode) |
| Kommentarzeilen (TS) | 1.552 von 90.517 Zeilen (≈ 1,7 %)                |

Es existiert genau ein Commit (`initial commit`) auf `main`.

### Getroffene Entscheidungen

Diese vier Entscheidungen sind bereits gefallen und gelten für den gesamten Plan.
Sie dürfen vom ausführenden Agenten nicht neu verhandelt werden.

1. **Package Manager: pnpm.** `package-lock.json` wird gelöscht. Alle Stellen,
   die `npm` aufrufen, werden auf `pnpm` umgestellt.
2. **Plattform-Scope: nur macOS.** Der komplette Linux-Pfad (Build-Konfiguration,
   Setup-Skript, CI-Job, README-Abschnitt) wird entfernt.
3. **Release: nur GitHub Releases, unsigniert.** Apple-Signing, Notarization,
   Cloudflare-R2-Upload und der Tauri-Updater-Endpoint entfallen. Das Signieren
   kann später als eigene Phase nachgerüstet werden.
4. **Feature-Cut: Arcade-Easter-Egg und Linear-Integration werden entfernt.**
   Die GitHub-Inbox bleibt erhalten.

### Offener Punkt vor Phase 0

Der Name `wavex` steckt an fünf Stellen fest: Crate-Name (`src-tauri/Cargo.toml`),
Library-Name (`wavex_lib`), npm-Paketname (`wavex-desktop`), Bundle-Identifier
(`com.wavex.desktop`) und Fenstertitel (`index.html`, `tauri.conf.json`).
Falls das Projekt umbenannt werden soll, muss das **vor Phase 0** geschehen —
später betrifft es Dateien, die Phase 3 und Phase 6 ohnehin verschieben, und die
Umbenennung wird unnötig unübersichtlich. Wenn keine Umbenennung gewünscht ist,
bleibt alles wie es ist und dieser Punkt entfällt.

---

## Arbeitsweise

- **Branch anlegen, nicht direkt auf `main` arbeiten.** Empfehlung:
  `git checkout -b chore/repo-rework`.
- **Ein Commit pro Phase.** Eine misslungene Phase muss sich mit einem einzigen
  `git revert` zurücknehmen lassen. Innerhalb von Phase 5 und 6 gilt: ein Commit
  pro Extraktion, nicht ein Commit für die ganze Phase.
- **Das Gate einer Phase muss grün sein, bevor die nächste beginnt.** Es gibt
  aktuell kein funktionierendes Sicherheitsnetz (siehe Phase 0); deshalb ist die
  Reihenfolge der Phasen nicht beliebig.
- **Alle Dateipfade in diesem Dokument beziehen sich auf den heutigen Stand.**
  Ab Phase 3 liegen Testdateien unter `tests/unit/…` statt neben dem Quellcode,
  ab Phase 6 liegen Quelldateien unter `src/features/…` und `src/shared/…` statt
  unter `src/lib/`. Wer eine spätere Phase ausführt, muss die genannten Pfade
  entsprechend übersetzen.

### Reihenfolge und ihre Begründung

Phase 0 baut das Sicherheitsnetz (Linter, Formatter, funktionierender Typecheck,
grüne CI). Phasen 1–4 sind mechanisch und für den Compiler sichtbar. Phasen 5
und 6 sind semantische Refactorings — das sind die einzigen Schritte, bei denen
ein Fehler dem Typechecker entgehen kann. Deshalb kommen sie zuletzt, wenn Linter
und typgeprüfte Tests bereits existieren.

---

## Phase 0 — Baseline: Toolchain und grüne CI

**Ziel:** Ein Zustand, in dem ein einziger Befehl (`pnpm check`) verlässlich sagt,
ob das Repository in Ordnung ist — und in dem CI dasselbe tut.

### Problem

Der Build ist aktuell in einem widersprüchlichen Zustand:

- `package-lock.json` **und** `pnpm-lock.yaml` liegen beide im Repository.
- `package.json` ruft in `check` und `check:web` `pnpm run` auf.
- `.github/workflows/ci.yml` nutzt `npm ci` mit `cache: npm`.
- `src-tauri/tauri.conf.json` ruft `npm run dev` und `npm run build`.
- Es gibt **keinen** TypeScript-Linter und **kein** Formatter-Skript.
- `tsconfig.json` enthält `"exclude": ["src/**/*.test.ts"]` — die 96 Testdateien
  werden also überhaupt nicht typgeprüft.

### Schritte

1. `package-lock.json` löschen.
2. `.npmrc` mit `engine-strict=true` anlegen (optional, aber konsistent mit den
   anderen Repos).
3. In `package.json` das Feld `packageManager` setzen, z. B.
   `"packageManager": "pnpm@10.x.x"` (die tatsächlich installierte Version
   eintragen: `pnpm --version`).
4. `prettier` von `dependencies` nach `devDependencies` verschieben —
   **Vorsicht:** `src/lib/format.ts:1` importiert `type { Plugin } from "prettier"`.
   Das ist nur ein Typ-Import, kein Laufzeit-Import. Vor dem Verschieben mit
   `grep -rn 'from "prettier"' src` gegenprüfen, dass es dabei bleibt. Falls
   `format.ts` Prettier zur Laufzeit ausführt, bleibt es in `dependencies`.
   Die anderen ungewöhnlichen Laufzeit-Abhängigkeiten (`cuelume` in
   `src/lib/sounds.ts`, `rehype-harden` in `src/surfaces/AgentMarkdown.tsx`,
   `react-material-icon-theme` in `src/chrome/FileTypeIcon.tsx`) sind verifiziert
   echte Laufzeit-Abhängigkeiten und bleiben, wo sie sind.
5. **oxlint + oxfmt + lefthook** als devDependencies hinzufügen. Diese Toolchain
   wird verwendet, weil sie in den anderen Repos dieses Nutzers (Qenvia, Tenvima,
   tenvima-ai) bereits Standard ist. **Kein ESLint, kein Prettier-Skript** —
   das wäre eine abweichende Konvention.

   `.oxlintrc.json`:

   ```json
   {
     "$schema": "./node_modules/oxlint/configuration_schema.json",
     "plugins": ["typescript", "unicorn", "oxc", "react"],
     "categories": {
       "correctness": "error"
     },
     "rules": {},
     "env": {
       "builtin": true,
       "browser": true
     }
   }
   ```

   `.oxfmtrc.json`:

   ```json
   { "ignorePatterns": ["dist", "target", "src-tauri/gen"] }
   ```

   `lefthook.yml`:

   ```yaml
   pre-commit:
     parallel: true
     jobs:
       - name: oxlint
         glob: "*.{js,jsx,ts,tsx,mjs,cjs}"
         run: pnpm oxlint --fix {staged_files}
         stage_fixed: true
       - name: oxfmt
         glob: "*.{js,jsx,ts,tsx,mjs,cjs,json,css}"
         run: pnpm oxfmt --write {staged_files}
         stage_fixed: true
       - name: rustfmt
         glob: "*.rs"
         run: cargo fmt -- {staged_files}
         stage_fixed: true
   ```

   **Vor dem Verdrahten in `check` zuerst messen.** Ein `correctness: error`-Setup
   samt `unicorn`- und `react`-Plugin trifft hier auf 90.000 Zeilen geerbten Code.
   Deshalb in dieser Reihenfolge vorgehen:

   ```bash
   pnpm oxlint 2>&1 | tail -3     # Anzahl Fehler feststellen
   pnpm oxlint --fix              # was automatisch behebbar ist
   pnpm oxlint 2>&1 | tail -3     # Rest zählen
   ```

   - **Wenige verbleibende Fehler:** in einem eigenen Commit
     (`fix: oxlint correctness`) beheben und `"correctness": "error"` beibehalten.
   - **Viele verbleibende Fehler:** die Konfiguration mit `"correctness": "warn"`
     einführen, damit CI grün bleibt, und ein Issue anlegen, um Regel für Regel
     auf `error` hochzuziehen. Phase 0 soll mechanisch und schnell sein — sie ist
     nicht der Ort, um Verhalten im Produktivcode zu ändern, das verbietet die
     "Nicht anfassen"-Liste dieser Phase ausdrücklich.
   - Das **`react`-Plugin** ist das größte Risiko und in Qenvia bewusst nicht
     aktiviert. `App.tsx` hat 104 `useCallback` und 25 `useEffect`; Regeln zu
     Hook-Abhängigkeiten werden dort nicht sauber durchlaufen. Einmal mit und
     einmal ohne das Plugin zählen — wenn es den Großteil der Meldungen erzeugt,
     in Phase 0 weglassen und nach Phase 8 erneut prüfen, wenn `App.tsx`
     aufgeteilt ist.

6. Skripte in `package.json` neu ordnen:

   ```json
   {
     "prepare": "lefthook install",
     "dev": "vite",
     "build": "tsc --noEmit && vite build",
     "preview": "vite preview",
     "test": "vitest run",
     "test:watch": "vitest",
     "lint": "oxlint",
     "format": "oxlint --fix && oxfmt --write",
     "check": "pnpm run check:web && pnpm run check:rust",
     "check:web": "oxlint && oxfmt --check && tsc --noEmit && vitest run && vite build",
     "check:rust": "cargo fmt --check && cargo clippy --workspace --all-targets -- -D warnings && cargo test",
     "set-version": "node scripts/bump-version.mjs",
     "tauri": "tauri",
     "tauri:stable": "tauri dev --no-watch --config src-tauri/tauri.stable.conf.json"
   }
   ```

   Anmerkungen: `dev:stable` bleibt erhalten (wird von `tauri.stable.conf.json`
   referenziert). `setup:linux:deb` und `build:linux` entfallen (Phase 4).
   `build` nutzt jetzt `tsc --noEmit` statt `tsc`, weil `noEmit` ohnehin in
   `tsconfig.json` steht und der bisherige Aufruf irreführend war.

   **`vite build` gehört zwingend in `check:web`.** Ohne diesen Schritt prüft das
   Gate den Bundler nie — und genau dort brechen die Verschiebe-Phasen. `index.html`
   enthält `<script type="module" src="/src/main.tsx">`; dieser Pfad ist reines
   HTML und für `tsc` unsichtbar. Wenn Phase 6 `main.tsx` nach `src/app/` verschiebt,
   läuft `tsc --noEmit` sauber durch und die App startet trotzdem nicht mehr.
   Dasselbe gilt für `src/index.css` und die SVG-Imports aus `src/assets/`.

7. `src-tauri/tauri.conf.json`: `beforeDevCommand` auf `pnpm dev`,
   `beforeBuildCommand` auf `pnpm build` ändern. `src-tauri/tauri.stable.conf.json`
   analog auf `pnpm dev:stable`.

8. `.github/workflows/ci.yml` neu schreiben:

   ```yaml
   name: CI

   on:
     push:
       branches: [main]
     pull_request:

   concurrency:
     group: ci-${{ github.ref }}
     cancel-in-progress: true

   jobs:
     web:
       runs-on: macos-latest
       steps:
         - uses: actions/checkout@v4
         - uses: pnpm/action-setup@v4
         - uses: actions/setup-node@v4
           with:
             node-version: 22
             cache: pnpm
         - run: pnpm install --frozen-lockfile
         - run: pnpm oxlint
         - run: pnpm oxfmt --check
         - run: pnpm exec tsc --noEmit
         - run: pnpm exec tsc --noEmit -p tsconfig.test.json
         - run: pnpm test

     rust:
       runs-on: macos-latest
       steps:
         - uses: actions/checkout@v4
         - uses: dtolnay/rust-toolchain@stable
           with:
             components: rustfmt, clippy
         - uses: Swatinem/rust-cache@v2
           with:
             workspaces: "src-tauri -> target"
         - run: cargo fmt --check
         - run: cargo clippy --workspace --all-targets -- -D warnings
         - run: cargo test --workspace
   ```

   Änderungen gegenüber vorher: `npm ci` → `pnpm install --frozen-lockfile`;
   Linux-Matrix-Eintrag entfernt; `concurrency`-Gruppe ergänzt (spart CI-Minuten
   bei schnellen Force-Pushes); `Swatinem/rust-cache` ergänzt — ohne Cargo-Cache
   dauert jeder Rust-Job mehrere Minuten für einen Full-Rebuild; das redundante
   `cargo check` entfernt (`clippy --all-targets` prüft dasselbe und mehr);
   Web- und Rust-Job getrennt, damit sie parallel laufen und man sofort sieht,
   welche Seite gebrochen ist; Node auf 22 (aktuelles LTS).

   Der zweite `tsc`-Aufruf (`-p tsconfig.test.json`) wird erst ab Phase 3
   funktionieren. Bis dahin auskommentiert lassen und in Phase 3 aktivieren.

9. `pnpm install` ausführen, Lockfile committen.

### Gate

```bash
pnpm install --frozen-lockfile
pnpm check
```

Beides muss ohne Fehler durchlaufen. `pnpm check` schließt jetzt `vite build`
ein — damit prüft das Gate ab hier in jeder Phase auch, dass die App überhaupt
noch gebaut werden kann. `pnpm oxfmt --check` wird beim ersten Lauf
sehr wahrscheinlich fehlschlagen — dann einmalig `pnpm format` laufen lassen und
das Ergebnis als **separaten** Commit committen ("style: apply oxfmt"), damit
der Formatierungs-Diff nicht die inhaltlichen Änderungen dieser Phase überdeckt.

### Nicht anfassen

- Keine Quelldateien unter `src/` oder `src-tauri/src/` inhaltlich verändern
  (außer der reinen Formatierung durch oxfmt).
- Keine Dateien verschieben.
- Keine Dependencies aktualisieren oder entfernen (außer der
  `prettier`-Verschiebung).

---

## Phase 1 — Branding und tote Verweise bereinigen

**Ziel:** Keine Verweise mehr auf MonoCode, usemono.dev oder das Upstream-Repo
`hardbeat920/…`.

### Problem

18 Fundstellen. Die kritischste zuerst:

- **`.github/ISSUE_TEMPLATE/config.yml:4`** leitet Sicherheitsmeldungen an
  `https://github.com/hardbeat920/wavex/security/advisories/new` — also an das
  Repository eines Fremden. Das muss zuerst weg.
- `src/lib/updater.ts:93` zeigt Nutzern einen Download-Link auf
  `github.com/hardbeat920/wavex/releases/latest`. Achtung: Dieser String wird in
  `src/lib/updaterConfig.test.ts:44` per `expect.stringContaining` geprüft — der
  Test muss im selben Commit mitgeändert werden.
- `src-tauri/src/fs.rs:4272-4273`, `src/lib/githubTasks.test.ts:200-223` —
  Testfixtures mit `hardbeat920/wavex`. Reine Beispieldaten, können auf den
  eigenen Namespace umgeschrieben werden.
- `src-tauri/Cargo.toml`: `authors = ["Nick"]`, `homepage = "https://usemono.dev"`,
  `repository = "https://github.com/hardbeat920/wavex"` — alle drei anpassen.
- `README.md` — wird in Phase 7 komplett neu geschrieben, hier nur zur Kenntnis.

### Zusätzlich kaputte Verweise

- `README.md:2` referenziert `public/monocode.png`. Vorhanden ist nur
  `public/wavecode.png`.
- `README.md` verlinkt `CONTRIBUTING.md` und `NOTICE`. **Beide Dateien
  existieren nicht.** Sie werden in Phase 7 angelegt.

### Schritte

1. `.github/ISSUE_TEMPLATE/config.yml` auf den eigenen Repo-Pfad umstellen.
2. `src/lib/updater.ts` und `src/lib/updaterConfig.test.ts` gemeinsam anpassen.
3. Testfixtures in `src-tauri/src/fs.rs` und `src/lib/githubTasks.test.ts`
   umschreiben.
4. `src-tauri/Cargo.toml`: `authors`, `homepage`, `repository`.
5. `public/wavecode.png` prüfen: Ist das noch das MonoCode-Logo? Wenn ja, ist es
   ein eigenes Asset-Thema und sollte als offener Punkt notiert, nicht in diesem
   Commit gelöst werden.

### Gate

```bash
grep -rniE 'monocode|usemono|hardbeat920' . \
  --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=target \
  --exclude=pnpm-lock.yaml --exclude=Cargo.lock --exclude=README.md
```

Muss leer sein (README ist ausgenommen, weil sie erst in Phase 7 ersetzt wird).
Danach `pnpm check`.

### Nicht anfassen

- README noch nicht neu schreiben — das ist Phase 7 und hängt davon ab, dass
  Struktur und Build-Befehle bis dahin final sind.

---

## Phase 2 — Versionsstände synchronisieren

**Ziel:** Eine einzige Wahrheit für die Versionsnummer.

### Problem

Vier Orte, die auseinanderlaufen:

| Ort                                  | Wert                                                                         |
| ------------------------------------ | ---------------------------------------------------------------------------- |
| `Cargo.toml` (`[workspace.package]`) | `0.0.1`                                                                      |
| `package.json`                       | `0.0.1`                                                                      |
| `src-tauri/tauri.conf.json`          | `0.0.1`                                                                      |
| `CHANGELOG.md`                       | enthält sowohl `## [0.1.25] - 2026-09-02` als auch `## [0.0.1] - 2026-09-02` |

`release.yml` bricht hart ab, wenn Tag, `package.json`, `Cargo.toml`,
`tauri.conf.json` und ein passender CHANGELOG-Abschnitt nicht exakt
übereinstimmen. Der aktuelle CHANGELOG mit dem verwaisten `0.1.25`-Eintrag ist
ein Überbleibsel aus dem Upstream.

### Schritte

1. Startversion festlegen. Empfehlung: `0.1.0` — das Projekt ist eine neue Basis,
   nicht die Fortsetzung von MonoCodes Versionslinie.
2. `scripts/bump-version.mjs` lesen und prüfen, ob es alle drei Manifeste
   bedient. Falls es noch npm-spezifische Annahmen enthält, anpassen.
3. `pnpm set-version 0.1.0` ausführen (oder die drei Manifeste manuell setzen,
   falls das Skript nicht alle abdeckt).
4. `CHANGELOG.md` auf einen einzigen Abschnitt zurücksetzen:

   ```markdown
   # Changelog

   Alle nennenswerten Änderungen an diesem Projekt werden hier dokumentiert.
   Das Format orientiert sich an [Keep a Changelog](https://keepachangelog.com/de/1.1.0/),
   die Versionierung an [Semantic Versioning](https://semver.org/lang/de/).

   ## [0.1.0] - JJJJ-MM-TT

   - Erste Version dieser Basis.
   ```

### Gate

```bash
node -p "require('./package.json').version"
node -p "require('./src-tauri/tauri.conf.json').version"
awk '/^\[workspace.package\]/{f=1} f && /^version = /{gsub(/"/,"",$3); print $3; exit}' Cargo.toml
grep -c '^## \[0.1.0\]' CHANGELOG.md
```

Die ersten drei Befehle müssen dieselbe Zahl ausgeben, der vierte `1`.

---

## Phase 3 — Tests nach `tests/` verschieben

**Ziel:** Kein `*.test.ts` mehr unter `src/`. Alle 96 Testdateien liegen unter
`tests/` und werden typgeprüft.

Das ist der riskanteste rein mechanische Schritt des ganzen Plans. Er wird
skriptgesteuert durchgeführt, nicht von Hand.

### Wichtige Vorbedingungen

**Die Tests sind bewusst reine Logik-Tests.** `vitest.config.ts` setzt
`environment: "node"`, und jeder Komponententest ist eine `.test.ts`-Datei neben
einer `.tsx`-Datei (`Modal.test.ts` zu `Modal.tsx`, `TitleBar.test.ts` zu
`TitleBar.tsx`). Getestet wird die extrahierte Logik, nicht das Rendering.

**Es wird kein jsdom und kein React Testing Library hinzugefügt.** Das wäre ein
eigenes Architekturthema und gehört nicht in eine Verschiebe-Phase.

### Zielstruktur

Spiegelbildlich zur Quellstruktur, damit die Zuordnung eindeutig bleibt:

```
tests/
  unit/
    lib/
      fileTree.test.ts          ← war src/lib/fileTree.test.ts
      harness/
        claudeProtocol.test.ts  ← war src/lib/harness/claudeProtocol.test.ts
    chrome/
      Modal.test.ts
    surfaces/
      editorGit.test.ts
```

### Schritte

1. **Codemod-Skript schreiben** (z. B. `scripts/move-tests.mjs`, nach Abschluss
   der Phase wieder löschen). Es muss:
   - alle `src/**/*.test.ts` finden,
   - sie nach `tests/unit/<relativer-pfad-ab-src>/` verschieben (`git mv`, damit
     die Historie erhalten bleibt),
   - in jeder verschobenen Datei jeden relativen Import umschreiben. Ein Import
     `from "./fileTree"` in `src/lib/fileTree.test.ts` wird zu
     `from "../../../src/lib/fileTree"` in `tests/unit/lib/fileTree.test.ts`.
     Die Umrechnung erfolgt über `path.relative` zwischen altem und neuem
     Verzeichnis — nicht über String-Ersetzung.
   - Nur relative Imports (`./` und `../`) anfassen. Paket-Imports (`vitest`,
     `react`, …) bleiben unverändert.

   Alternativ und robuster: einen Alias einführen. In `vite.config.ts` und
   `tsconfig.json` `@/*` auf `src/*` mappen, dann werden alle Testimports zu
   `@/lib/fileTree` und sind gegen künftige Verschiebungen immun. Das ist der
   empfohlene Weg, weil Phase 4 die Quellstruktur ohnehin noch einmal umbaut —
   ohne Alias müssten die Testimports dann ein zweites Mal angefasst werden.

2. **`vitest.config.ts` anpassen:**

   ```ts
   import { defineConfig } from "vitest/config";
   import { fileURLToPath } from "node:url";

   export default defineConfig({
     resolve: {
       alias: {
         "@": fileURLToPath(new URL("./src", import.meta.url)),
       },
     },
     test: {
       environment: "node",
       include: ["tests/**/*.test.ts"],
     },
   });
   ```

3. **`tsconfig.json` anpassen.** Die `exclude`-Zeile für Tests entfällt, weil
   Tests nicht mehr unter `src/` liegen. Der Alias wird ergänzt:

   ```json
   {
     "compilerOptions": {
       "...": "unverändert",
       "baseUrl": ".",
       "paths": { "@/*": ["src/*"] }
     },
     "include": ["src"],
     "references": [{ "path": "./tsconfig.node.json" }]
   }
   ```

4. **`tsconfig.test.json` neu anlegen** — das schließt die Lücke, dass Tests
   bisher nie typgeprüft wurden:

   ```json
   {
     "extends": "./tsconfig.json",
     "include": ["tests", "src"]
   }
   ```

5. **`vite.config.ts`** um denselben Alias ergänzen, damit der Produktivbuild
   dieselben Pfade auflöst.

6. Den in Phase 0 auskommentierten CI-Schritt `pnpm exec tsc --noEmit -p tsconfig.test.json`
   aktivieren.

### Gate

Vor der Verschiebung die Testanzahl festhalten:

```bash
pnpm test 2>&1 | tail -5   # Anzahl Testdateien und Tests notieren
```

Nach der Verschiebung:

```bash
find src -name '*.test.ts' | wc -l      # muss 0 sein
find tests -name '*.test.ts' | wc -l    # muss 96 sein
pnpm test                                # gleiche Anzahl bestandener Tests wie vorher
pnpm exec tsc --noEmit
pnpm exec tsc --noEmit -p tsconfig.test.json
```

Die Anzahl bestandener Tests muss exakt identisch sein. Eine gesunkene Zahl
bedeutet, dass eine Datei vom `include`-Glob nicht mehr erfasst wird — das ist
der typische Fehlerfall und fällt sonst niemandem auf.

Der neue Typecheck der Tests wird sehr wahrscheinlich Fehler finden, die vorher
verborgen waren. Diese im selben Commit beheben; wenn es viele sind, einen
eigenen Folge-Commit daraus machen.

### Nicht anfassen

- Keine Testinhalte umschreiben (außer Importpfaden).
- Keine Tests hinzufügen oder löschen.
- Kein jsdom, kein React Testing Library, kein Coverage-Setup.
- Rust-Tests bleiben, wo sie sind: Rust-Konvention ist `#[cfg(test)] mod tests`
  innerhalb der Quelldatei. Diese Tests werden **nicht** verschoben.

---

## Phase 4 — Feature-Cut: Arcade und Linux

**Ziel:** Toten Ballast entfernen. Zwei unabhängige Schnitte, zwei Commits.

### 4a — Arcade-Easter-Egg entfernen (~2.000 Zeilen)

Die Schnittkante wurde geprüft und ist sauber. Diese Dateien werden vollständig
gelöscht:

```
src/surfaces/gridArcade.ts
src/surfaces/gridGames.ts
src/surfaces/gridGames.test.ts
src/surfaces/pacmanArcade.ts          (1.150 Zeilen)
src/surfaces/pacmanArcade.test.ts
src/surfaces/snakeArcade.ts
src/surfaces/snakeArcade.test.ts
src/surfaces/speechBubble.ts
src/surfaces/speechBubble.test.ts
src/surfaces/TerminalGridBackground.tsx
```

(Nach Phase 3 liegen die `*.test.ts` unter `tests/unit/surfaces/`.)

Anschließend die Verwendungsstellen entfernen:

- `src/surfaces/EmptySession.tsx:9,33` — Import und die Bedingung
  `{arcadeEnabled ? <TerminalGridBackground /> : null}`. Die `arcadeEnabled`-Prop
  fällt damit ebenfalls weg; Aufrufer entsprechend anpassen.
- `src/surfaces/SettingsView.tsx:262,364` — `gridArcadeEnabled`-State und der
  zugehörige Toggle in der Einstellungsansicht.
- `src/lib/settings.ts:183-217` — `GRID_ARCADE_ENABLED_KEY`, das Custom-Event
  `wavex:grid-arcade-enabled-change`, `loadGridArcadeEnabled`,
  `saveGridArcadeEnabled`, `subscribeGridArcadeEnabled`.
- `src/lib/settings.test.ts:20` und die zugehörigen Testfälle.

**Wichtig — nicht mit entfernen:** `src/chrome/ProjectMascot.tsx` und
`src/lib/projectMascots.ts` gehören **nicht** zum Arcade-Feature. Das Maskottchen
ist die Projekt-Identität und wird an sechs Stellen verwendet
(`Sidebar.tsx`, `ProjectRail.tsx`, `TabGroupMenu.tsx`, `NoteMiniCard.tsx`,
`ComposerRunner.tsx`, `InboxView.tsx`). Es bleibt vollständig erhalten.

### 4b — Linux-Support entfernen

Gelöscht werden:

```
scripts/install-linux-deps-debian.sh
src-tauri/tauri.linux.conf.json
```

Angepasst werden:

- `package.json` — Skripte `setup:linux:deb` und `build:linux` entfernen
  (bereits in Phase 0 geschehen, hier nur verifizieren).
- `.github/workflows/release.yml` — der komplette `linux`-Job und die Schritte
  `Download Linux packages` sowie die `.deb`/AppImage-Prüfung im Release-Schritt
  (wird in Phase 5 ohnehin komplett neu geschrieben; hier nur zur Kenntnis).
- `.github/ISSUE_TEMPLATE/bug_report.yml` — die Zeile über den Plattform-Scope
  ist jetzt korrekt und bleibt.
- `src-tauri/tauri.conf.json` — `"targets": "all"` auf `["app", "dmg"]` ändern.

### 4c — Linear-Integration entfernen (~1.100 Zeilen)

**Dies ist der heikelste Schnitt des Plans und braucht einen eigenen Commit.**
Anders als das Arcade-Feature ist Linear kein isolierter Block, sondern ein
zweiter Provider in einer geteilten Inbox-Abstraktion. Betroffen sind rund 140
Fundstellen in acht Dateien.

Vollständig gelöscht:

```
src-tauri/src/linear.rs        (909 Zeilen)
src/lib/linear.ts
src/lib/linear.test.ts
src/chrome/InboxProviderMark.tsx   ← nur wenn es ausschließlich Provider-Icons
                                     unterscheidet; vorher prüfen
```

**Vorgehen — die Typ-Verengung als Werkzeug nutzen:**

`src/lib/githubTasks.ts:43` definiert `export type InboxProvider = "github" | "linear";`
und Zeile 18 `export type InboxKind = GithubTaskKind | "linear";`.

Der effizienteste und sicherste Weg ist:

1. Zuerst **nur** diese beiden Typen verengen: `"linear"` aus beiden Unions
   entfernen.
2. `pnpm exec tsc --noEmit` laufen lassen. Der Compiler zeigt jetzt **jede**
   Stelle an, die auf `"linear"` prüft oder darauf verzweigt — das sind unter
   anderem `githubTasks.ts:485-522,614-733`, `App.tsx:1209-1240`,
   `InboxView.tsx`, `inboxFilters.ts`, `SettingsView.tsx:113`,
   `useInboxUnseen.ts:21`, `InboxMiniCard.tsx`.
3. Diese Stellen der Reihe nach abräumen, bis `tsc` sauber ist.
4. Erst danach die Dateien löschen und die sieben Tauri-Kommandos aus
   `src-tauri/src/lib.rs:7,192-198` entfernen (`mod linear;` und die Einträge im
   `invoke_handler!`-Makro).
5. `src-tauri/Cargo.toml`: **`ureq` bleibt.** Es wird außer von `linear.rs` auch
   von `harness.rs` (für `harness_http`, `harness_sse_open`, `harness_sse_close`)
   und von `rate_limits.rs` verwendet. Der Schritt besteht nur darin, das mit
   `grep -rln 'ureq' src-tauri/src/` zu bestätigen — nicht darin, die Dependency
   zu entfernen.
6. Die CSP in `src-tauri/tauri.conf.json` enthält `https://uploads.linear.app`
   in `img-src` (in beiden Varianten, `csp` und `devCsp`). Diesen Eintrag
   entfernen.
7. Prüfen, ob `src/lib/inboxSeen.ts` / `inboxFilters.ts` nach dem Schnitt noch
   sinnvoll generisch sind oder vereinfacht werden können — falls ja, ist das
   ein eigener kleiner Folge-Commit, kein Teil dieses.

### Gate

```bash
grep -rniE 'arcade|pacman|snake' src tests | grep -v node_modules   # leer
grep -rniE 'linear' src tests src-tauri/src | grep -v 'linearGradient\|linear-gradient\|linearly'  # leer
grep -rn 'linux' package.json scripts src-tauri/tauri.conf.json     # leer
pnpm check
```

Danach die App einmal manuell starten (`pnpm tauri dev`) und prüfen: leere
Session-Ansicht rendert, Einstellungen öffnen sich ohne Fehler, Inbox lädt
GitHub-Items. Der Typechecker fängt bei React-Komponenten nicht alles ab.

---

## Phase 5 — GitHub Actions und Repository-Vorlagen

**Ziel:** Eine Release-Pipeline, die ohne geerbte Secrets funktioniert, und
Vorlagen, die zum Projekt passen.

### 5a — `release.yml` neu schreiben

Die bestehende Datei (rund 230 Zeilen) setzt voraus: Apple-Developer-Zertifikat,
Notarization-API-Key, Cloudflare-R2-Bucket mit Access Keys und einen
Tauri-Updater-Signaturschlüssel. Nichts davon ist vorhanden.

Neue Fassung — unsigniertes `.dmg` und `.app`-Archiv, direkt an GitHub Releases:

```yaml
name: Release

on:
  push:
    tags: ["v*"]

permissions:
  contents: write

jobs:
  release:
    runs-on: macos-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - uses: dtolnay/rust-toolchain@stable
      - uses: Swatinem/rust-cache@v2
        with:
          workspaces: "src-tauri -> target"

      - run: pnpm install --frozen-lockfile

      - name: Verify tag matches manifests and CHANGELOG
        run: node scripts/verify-release.mjs "${GITHUB_REF_NAME#v}"

      - run: pnpm exec tauri build --bundles app,dmg

      - name: Publish GitHub Release
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          set -euo pipefail
          DMG=$(find target/release/bundle/dmg -maxdepth 1 -name '*.dmg' -print -quit)
          [ -n "$DMG" ] || { echo "No .dmg produced" >&2; exit 1; }
          gh release create "$GITHUB_REF_NAME" \
            --title "${GITHUB_REF_NAME}" \
            --notes-file <(node scripts/changelog-section.mjs "${GITHUB_REF_NAME#v}") \
            "$DMG"
```

Die Inline-Node-Skripte aus der alten Datei (Versionsprüfung, CHANGELOG-Prüfung)
wandern in echte Dateien unter `scripts/` — `verify-release.mjs` und
`changelog-section.mjs`. Heredoc-eingebetteter Node-Code in YAML ist nicht
testbar, nicht lintbar und der Hauptgrund, warum die alte Datei so unübersichtlich
ist. Die Logik selbst kann aus der alten `release.yml` übernommen werden.

**Hinweis zum Updater:** Ohne Signaturschlüssel und Endpoint ist der
Tauri-Updater funktionslos. `src-tauri/tauri.conf.json` hat bereits
`"pubkey": ""` und `"endpoints": []`. `src/lib/updater.ts:93` zeigt dann die
Meldung "Automatic updates aren't configured for this build" — das ist korrektes
Verhalten und bleibt so. `createUpdaterArtifacts` in `tauri.conf.json` kann auf
`false` gesetzt werden, solange kein Updater existiert.

**Hinweis zur Signierung:** Ein unsigniertes `.dmg` wird von macOS Gatekeeper
beim ersten Start blockiert. Das muss in der README dokumentiert werden
(Rechtsklick → Öffnen, oder `xattr -d com.apple.quarantine`). Alternativ ist
Ad-hoc-Signierung (`"signingIdentity": "-"`, wie aktuell in `tauri.conf.json`)
weiterhin gesetzt und ausreichend für lokale Nutzung.

### 5b — Issue-Vorlagen

Aktuell existiert nur `bug_report.yml`, und `config.yml` setzt
`blank_issues_enabled: false`. **Damit lassen sich derzeit überhaupt keine
Feature-Requests einreichen** — es gibt weder eine Vorlage dafür noch die
Möglichkeit, ein leeres Issue zu öffnen.

Neu anlegen: `.github/ISSUE_TEMPLATE/feature_request.yml` mit den Feldern
Problem/Motivation, Lösungsvorschlag, betrachtete Alternativen.

`bug_report.yml` überarbeiten:

- Der `provider`-Dropdown muss nach dem Linear-Cut unverändert bleiben (Linear
  war kein Provider im Sinne dieses Feldes), aber die Liste sollte gegen
  `src/lib/session.ts` (`HarnessId`) gegengeprüft werden.
- Ein Feld für Logs/Konsolenausgabe fehlt und sollte ergänzt werden.
- Die Plattform-Zeile ist nach Phase 4b korrekt.

### 5c — Fehlende Standarddateien

Alle vier fehlen aktuell:

- **`SECURITY.md`** — Meldeweg für Sicherheitslücken, verweist auf die
  GitHub-Security-Advisories des **eigenen** Repos.
- **`CONTRIBUTING.md`** — wird von der README bereits verlinkt. Inhalt:
  Voraussetzungen (Node 22+, pnpm, Rust stable, Xcode Command Line Tools),
  Setup, `pnpm check` vor jedem PR, Commit-Konventionen, Hinweis auf kleine
  fokussierte PRs.
- **`.github/dependabot.yml`** — drei Ökosysteme: `npm` (pnpm wird davon
  unterstützt), `cargo` und `github-actions`, jeweils wöchentlich.
- **`NOTICE`** — wird von der README verlinkt. Inhalt: Hinweis, dass Namen und
  Logos der Provider (Claude, Codex, Cursor, …) Marken der jeweiligen Inhaber
  sind, plus die Upstream-Attribution an MonoCode/usemono.dev, da dieses Projekt
  darauf aufbaut. Die `LICENSE` ist MIT; die Attribution des ursprünglichen
  Copyright-Inhabers ist damit rechtlich erforderlich — `LICENSE` prüfen und den
  Original-Copyright-Vermerk **nicht** entfernen.

### 5d — Pull-Request-Vorlage

Die bestehende ist inhaltlich in Ordnung, nur die Checkliste zeigt auf den
falschen Befehl (`npm run check`). Auf `pnpm check` ändern.

### Gate

```bash
pnpm exec actionlint          # falls installiert; sonst YAML-Syntax manuell prüfen
ls SECURITY.md CONTRIBUTING.md NOTICE .github/dependabot.yml
ls .github/ISSUE_TEMPLATE/feature_request.yml
grep -rn 'npm ' .github/ package.json README.md   # leer
```

Die Release-Pipeline lässt sich nicht ohne echten Tag testen. Empfehlung: einen
Testtag `v0.1.0-rc.1` auf einem Branch pushen, den Lauf beobachten, Release und
Tag danach löschen.

---

## Phase 6 — Struktur: `src/lib` aufteilen

**Ziel:** Keine Verzeichnisse mit über 100 Dateien mehr. Verwandtes liegt
beieinander.

### Problem

```
src/lib/          146 Dateien flach im Verzeichnis
src/lib/harness/   85 Dateien flach im Verzeichnis
src/chrome/        65 Dateien
src/surfaces/      42 Dateien
src/hooks/         13 Dateien
```

`src/lib` ist eine Halde. Darin liegen nebeneinander: Session-Verwaltung,
Layout-Algorithmen, Git-Anbindung, Terminal-Verwaltung, Dateiindex, Einstellungen,
Sounds, Zwischenablage, Fuzzy-Suche. Es gibt keine erkennbare Gruppierung.

### Zielstruktur

Gruppiert nach Fachlichkeit, nicht nach technischer Art:

```
src/
  app/              App.tsx, main.tsx (Einstiegspunkt)
  features/
    session/        session.ts, sessionStore.ts, sessionCache.ts, sessionHistory.ts,
                    sessionFilters.ts, sessionFolders.ts, sessionTitle.ts,
                    sessionDone.ts, sessionSkills.ts, sessionListWindow.ts
    harness/        (bleibt als eigener Bereich, siehe Phase 7)
    workspace/      layout.ts, tabGroups.ts, tabKeys.ts, tabVisitHistory.ts,
                    workspaceSnapshot.ts, workspaceTabGroups.ts, paneDrop.ts,
                    reorder.ts, drag.ts
    terminal/       pty.ts, projectTerminal.ts, terminalChrome.ts, terminalClose.ts,
                    terminalLayout.ts, terminalTab.ts
    editor/         (aus src/surfaces: editorDoc, editorGit, editorLint,
                    editorSearch, editorChrome, editorEditing, editorAutocomplete)
    files/          fs.ts, fileIndex.ts, fileTree.ts, fileMentions.ts, fileName.ts,
                    fileWatch.ts, paths.ts, attachments.ts
    git/            gitText.ts, checkpoint.ts, prDiff.ts
    inbox/          githubTasks.ts, inboxFilters.ts, inboxSeen.ts
    notes/          notes.ts
    skills/         skills.ts, createSkill.ts, skillCatalog.ts
    updates/        updater.ts, updateNotice.ts, releaseNotes.ts,
                    releaseNotesWorkspace.ts
  shared/           fuzzy.ts, format.ts, jsonText.ts, colorUtils.ts, platform.ts,
                    clipboard.ts, layers.ts, csp.ts, sounds.ts, appearance.ts,
                    settings.ts, recents.ts
  chrome/           (bleibt; ggf. Unterordner nach Bereich)
  surfaces/         (bleibt; ohne die editor*-Dateien)
  hooks/            (bleibt)
```

Die genaue Zuordnung ist ein Vorschlag. Der ausführende Agent soll sie vor der
Umsetzung anhand der tatsächlichen Importbeziehungen validieren — eine Datei, die
von vier Bereichen importiert wird, gehört nach `shared/`, nicht in einen der
vier.

### Schritte

1. Importgraph erheben, um die Zuordnung zu validieren:
   ```bash
   grep -rhoE 'from "\.\./[^"]+"|from "\./[^"]+"' src --include='*.ts' --include='*.tsx' \
     | sort | uniq -c | sort -rn | head -50
   ```
2. **Bereich für Bereich verschieben, ein Commit pro Bereich.** Nicht alles auf
   einmal. Nach jedem Bereich `pnpm check`.
3. `git mv` verwenden, damit die Historie erhalten bleibt.
4. Der in Phase 3 eingeführte `@/`-Alias sorgt dafür, dass die Testdateien
   trotzdem angepasst werden müssen — `@/lib/fileTree` wird zu
   `@/features/files/fileTree`. Das ist eine reine Suchen-und-Ersetzen-Operation
   pro Bereich.
5. **`index.html` anpassen, sobald `main.tsx` verschoben wird.** Die Datei enthält
   `<script type="module" src="/src/main.tsx">`. Dieser Pfad wird von keinem
   Typechecker geprüft; wird er vergessen, ist der Commit für `tsc` und `vitest`
   fehlerfrei und die App startet trotzdem nicht. Dasselbe gilt für den Import von
   `src/index.css` in `main.tsx` und für die SVG-Imports aus `src/assets/providers/`.
   Der Fenstertitel in `index.html` und `src-tauri/tauri.conf.json` bleibt davon
   unberührt.

6. Pro Bereich eine `index.ts` als Barrel anlegen ist **optional** und sollte
   nur dort gemacht werden, wo der Bereich eine echte öffentliche Schnittstelle
   hat. Barrel-Dateien um ihrer selbst willen erschweren Tree-Shaking und
   verschleiern Abhängigkeiten (siehe das Problem mit
   `src/lib/harness/index.ts` in Phase 7).

### Gate

Nach jedem Teilschritt:

```bash
pnpm check          # enthält seit Phase 0 auch `vite build`
pnpm tauri dev      # nach dem Verschieben von main.tsx einmal manuell starten
find src/lib -maxdepth 1 -type f | wc -l   # sinkt monoton gegen 0
```

`vite build` ist in dieser Phase das entscheidende Gate — es ist der einzige
Schritt, der die Einstiegspfade aus `index.html` und die Asset-Imports auflöst.

Am Ende der Phase: `src/lib` existiert nicht mehr. Der Diff darf **nur**
Verschiebungen und Importpfade enthalten — keine geänderte Logik. Das lässt sich
prüfen mit:

```bash
git diff --stat HEAD~1
git log -1 -p | grep '^[+-]' | grep -vE '^[+-]{3}' | grep -vE '^[+-]\s*(import|})' | head -50
```

Die letzte Ausgabe sollte leer oder sehr kurz sein.

### Nicht anfassen

- Keine Funktion umbenennen, keine Signatur ändern, keine Logik anfassen. Das ist
  Phase 7. Verschieben und Refactoring im selben Commit zu mischen macht den Diff
  unlesbar und einen Revert unmöglich.

---

## Phase 7 — Harness-Duplikate zusammenführen

**Ziel:** Rund 600 Zeilen kopierten Code durch eine Factory ersetzen und den
Übergang zur Registry-Architektur abschließen.

**Das ist der Schritt mit dem besten Verhältnis von Nutzen zu Risiko im ganzen
Plan.** Es geht nicht darum, eine Abstraktion zu entwerfen — die existiert
bereits. Es geht darum, eine halbfertige Migration zu Ende zu bringen.

### Befund

`src/lib/harness/registry.ts` definiert bereits einen `HarnessAdapter`-Vertrag
mit den optionalen Mitgliedern `generateTitle`, `generateCommitMessage`,
`generatePrContent`, `generateBranchName`, `warmupText`.
`src/lib/harness/textHarness.ts` routet bereits über diese Registry.

Trotzdem existieren daneben pro Harness eigene, praktisch identische Dateien:

| Muster                                                  | Anzahl | Zeilen je Datei | Unterschied                                                               |
| ------------------------------------------------------- | ------ | --------------- | ------------------------------------------------------------------------- |
| `*Git.ts` (claude, codex, cursor, grok, opencode)       | 5      | 85–89           | nur der importierte `run<X>TextPrompt` und ein Prosa-String im Fehlerfall |
| `*Title.ts` (claude, codex, cursor, grok, opencode, pi) | 6      | 25–45           | nur der importierte `run<X>TextPrompt`                                    |

Der Diff zwischen `claudeGit.ts` und `codexGit.ts` besteht aus exakt neun
Zeilen, davon acht reine Umbenennungen und eine ein Prosa-String
(`"… Claude Code returned no text."` gegen `"… Codex returned no text."`).

### Schritte

1. **`src/lib/harness/textPrompt.ts`** anlegen (Name frei) mit zwei Factories:

   ```ts
   type TextPromptRunner = (input: {
     cwd: string;
     prompt: string;
     timeoutMs: number;
   }) => Promise<string>;

   export function createTitleGenerator(run: TextPromptRunner) { … }

   export function createGitTextGenerators(run: TextPromptRunner, label: string) {
     return { generateCommitMessage, generatePrContent, generateBranchName };
   }
   ```

   `label` ist der Anzeigename für die Fehlermeldung ("Claude Code", "Codex", …).

2. Die elf Dateien löschen und die jeweiligen `*Adapter.ts` auf die Factory
   umstellen. Ein Adapter sieht danach etwa so aus:

   ```ts
   const text = createGitTextGenerators(runClaudeTextPrompt, "Claude Code");
   register({ id: "claude", …, ...text, generateTitle: createTitleGenerator(runClaudeTextPrompt) });
   ```

3. **`src/lib/harness/index.ts` auflösen.** Diese Barrel-Datei exportiert noch
   die Vor-Registry-API einzeln pro Harness: `sendClaudeTurn`, `sendCodexTurn`,
   `sendCursorTurn`, `stopClaudeSession`, `bindCodexSession` und so weiter. Solange
   sie existiert, können Aufrufer an der Registry vorbei direkt auf einen Harness
   zugreifen — genau das, was die Registry verhindern soll.

   Vorgehen: die Einzelexporte entfernen, `tsc` laufen lassen, jede angezeigte
   Aufrufstelle (überwiegend in `App.tsx`) auf die generische Registry-Funktion
   umstellen (`sendHarnessTurn`, `stopHarnessSession`, …). Übrig bleiben soll ein
   Barrel mit einer Handvoll generischer Exporte.

4. Danach prüfen, ob dieselbe Behandlung für die `*Protocol.ts`-Dateien lohnt.
   Diese sind mit 680–1.040 Zeilen deutlich größer und tatsächlich
   unterschiedlich (verschiedene Wire-Protokolle) — hier ist Vorsicht geboten. Ein
   Vergleich von `claudeProtocol.ts` und `grokProtocol.ts` sollte zeigen, ob es
   eine gemeinsame Basis gibt oder ob die Ähnlichkeit oberflächlich ist. **Im
   Zweifel nicht anfassen** — falsche Abstraktion ist teurer als Duplikat.

### Gate

```bash
ls src/features/harness/*Git.ts src/features/harness/*Title.ts 2>/dev/null   # leer
grep -rn 'sendClaudeTurn\|sendCodexTurn\|sendCursorTurn\|sendGrokTurn' src   # leer
pnpm check
```

Zeilenzahl vorher/nachher dokumentieren. Erwartung: ~600 Zeilen weniger bei
identischem Verhalten.

Manueller Test: mit mindestens zwei installierten Providern je einen Turn
starten, eine Commit-Message generieren lassen und einen Session-Titel erzeugen
lassen.

---

## Phase 8 — `App.tsx` aufbrechen

**Ziel:** Aus einer 4.513-Zeilen-Komponente werden mehrere überschaubare Module.
Das ist gleichzeitig die eigentliche Performance-Maßnahme.

### Warum das die Performance-Frage beantwortet

`src/App.tsx`:

- 4.513 Zeilen, davon rund 3.800 im Rumpf einer einzigen Komponente
- 99 Import-Anweisungen
- 30 `useState`
- 25 `useEffect`
- 104 `useCallback`

Jeder dieser 30 State-Werte löst bei Änderung ein Re-Render des **gesamten**
Komponentenbaums aus. Die 104 `useCallback`-Aufrufe sind der Versuch, das
abzufedern — sie verhindern zwar neue Funktionsreferenzen, aber nicht das
Re-Render der Komponente selbst, in der sie definiert sind. Jedes Zeichen im
Composer, jeder eingehende Harness-Event, jede Änderung des Git-Status rendert
Sidebar, Titelleiste, Transkript, Editor und Terminal neu.

Das Aufteilen des States in externe Stores ist deshalb keine ästhetische
Maßnahme, sondern **die** Performance-Verbesserung. Komponenten abonnieren dann
nur noch die Slices, die sie tatsächlich lesen.

### Vorgehen — kein neues State-Framework

Das Repository hat das Muster bereits: `useSyncExternalStore` wird in
`src/hooks/useProjectBranches.ts`, `useGitFileStatuses.ts`,
`useProjectDiffStats.ts` und `src/lib/paneDrop.ts` von Hand verwendet.

**Es wird kein Zustand, Jotai oder Redux hinzugefügt.** Stores werden als
einfache Module nach demselben Muster gebaut: ein Modul-lokaler Wert, ein
`Set<() => void>` von Listenern, `subscribe`/`getSnapshot`/`set`, und ein
`useX()`-Hook darüber. Das passt zum bestehenden Code und bringt keine neue
Abhängigkeit.

### Extraktionsreihenfolge

Von außen nach innen, jeweils ein eigener Commit, jeweils `pnpm check` danach.
Reihenfolge nach steigendem Risiko:

1. **Reine Hilfsfunktionen** — die Funktionen am Dateiende
   (`src/App.tsx:4261-4520`: `conversationTitle`, `lastUserBlockId`,
   `isBlankSession`, `selectedChangePath`, `isBlankWorkspaceTab`, `toTitleTab`,
   `dropOpenFiles`, `trackSessionEdits`, `nudgeWorkspace`, `nudgeOpenEditors`,
   `sameSettings`) sowie die am Anfang (`setsEqual`, `cancelScheduledFlush`,
   `scheduleHarnessFlush`, `userTurnCards`, `withHarnessChoice`,
   `openSessionIds`, `titleTabsEqual`). Diese haben keine React-Abhängigkeit und
   lassen sich sofort in Module verschieben — **und testen**, was heute nicht
   möglich ist.

2. **Settings-Store** — der am wenigsten verflochtene Zustand. Es gibt bereits
   `src/lib/settings.ts` mit Persistenz und Subscribe-Mechanik; der State in
   `App.tsx` ist im Wesentlichen ein Spiegel davon.

3. **Workspace-/Layout-Store** — Tabs, Panes, Splits. `src/lib/layout.ts` (965
   Zeilen) enthält die Algorithmen bereits als reine Funktionen; in `App.tsx`
   liegt nur der State und das Verdrahten. Das ist eine saubere Naht.

4. **Terminal-Dock-Store** — analog, `src/lib/projectTerminal.ts` liefert die
   Operationen bereits.

5. **Session-Store** — der größte und am stärksten verflochtene Bereich
   (Harness-Events, Streaming, Approvals). Zuletzt, und intern noch einmal in
   mehrere Commits geteilt.

6. **Verbleibende Effects gruppieren.** Nach den Store-Extraktionen sollten die
   25 `useEffect` deutlich weniger und thematisch sortiert sein. Was übrig bleibt,
   wandert in benannte Hooks (`useHarnessEventBridge`, `useWindowLifecycle`,
   `useMenuCommands`, …) unter `src/hooks/`.

### Gate

Pro Commit: `pnpm check` grün (enthält `vite build`), und die App startet
(`pnpm tauri dev`) mit funktionierender Grundinteraktion. Wenn `App.tsx` nach
`src/app/` wandert, muss der Import in `main.tsx` mitgezogen werden — und falls
`main.tsx` selbst umzieht, der Pfad in `index.html`.

Am Ende der Phase:

```bash
wc -l src/app/App.tsx                    # Ziel: unter 800 Zeilen
grep -c 'useState' src/app/App.tsx       # Ziel: unter 8
grep -c 'useEffect(' src/app/App.tsx     # Ziel: unter 8
```

**Messung der Performance-Verbesserung:** Vor Beginn der Phase mit den React
DevTools (Profiler, "Highlight updates when components render") eine Baseline
aufnehmen: Was rendert alles neu, wenn man ein Zeichen in den Composer tippt?
Nach der Phase dieselbe Messung. Das ist der Beleg, dass die Phase ihr Ziel
erreicht hat — ohne diese Messung ist der Umbau nur behauptet.

### Nicht anfassen

- Kein neues State-Management-Paket.
- Keine Komponenten unter `src/chrome/` oder `src/surfaces/` in dieser Phase
  umbauen. Wenn eine Prop-Kette verschwindet, weil die Komponente jetzt direkt
  am Store hängt, ist das Teil des Commits — aber kein darüber hinausgehender
  Umbau.

---

## Phase 9 — README neu schreiben

**Ziel:** Eine README, die stimmt.

### Was an der aktuellen kaputt ist

- Zeile 2 zeigt auf `public/monocode.png`; vorhanden ist `public/wavecode.png`.
- Verlinkt `CONTRIBUTING.md` und `NOTICE` — beide existierten bis Phase 5 nicht.
- Der Download-Link zeigt auf `https://dl.usemono.dev/MonoCode.dmg`.
- Der Linux-Abschnitt beschreibt einen Build, den es nach Phase 4b nicht mehr gibt.
- Alle Build-Befehle nutzen `npm`.
- Der Screenshot `docs/screenshot.jpg` zeigt MonoCode, nicht dieses Projekt.

### Gliederung der neuen README

1. **Kopf** — Logo, Projektname, ein Satz zur Funktion.
2. **Screenshot** — muss neu aufgenommen werden.
3. **Was es ist** — Desktop-Oberfläche für Coding-Agenten. Läuft die installierten
   Provider-CLIs (Claude Code, Codex, Cursor, Grok Build, OpenCode, Pi, omp, fx)
   über die vorhandenen Abos des Nutzers. Verkauft keine Tokens.
4. **Voraussetzungen** — mindestens ein installierter und eingeloggter Provider,
   mit der Liste der Login-Befehle aus der alten README (die ist inhaltlich
   korrekt und kann übernommen werden).
5. **Installation** — macOS (Apple Silicon), `.dmg` aus den GitHub Releases.
   **Mit Hinweis auf Gatekeeper**, da unsigniert (siehe Phase 5a).
6. **Aus dem Quellcode bauen**:
   ```bash
   pnpm install
   pnpm tauri dev
   ```
   Voraussetzungen: Node 22+, pnpm, Rust stable, Xcode Command Line Tools.
7. **Projektstruktur** — eine kurze Tabelle der Verzeichnisse aus Phase 6. Das
   ist der Abschnitt, der eine Basis von einem Klon unterscheidet: wer erweitern
   will, muss wissen, wo was liegt.
8. **Entwicklung** — `pnpm check`, `pnpm test`, `pnpm format`, Hinweis auf die
   lefthook-Pre-Commit-Hooks.
9. **Beitragen** — Verweis auf `CONTRIBUTING.md`.
10. **Lizenz** — MIT, Verweis auf `LICENSE` und `NOTICE` (Provider-Marken und
    Upstream-Attribution).

### Gate

```bash
# Jeder relative Link in der README muss auf eine existierende Datei zeigen:
grep -oE '\]\(([^)h][^)]*)\)' README.md | tr -d '])(' | while read -r f; do
  [ -e "$f" ] || echo "TOTER LINK: $f"
done
```

Muss leer sein. Zusätzlich: jeden in der README genannten Befehl einmal
tatsächlich ausführen.

---

## Phase 10 — Abschluss

1. **`CLAUDE.md` / `AGENTS.md` anlegen.** Die anderen Repos dieses Nutzers haben
   das. Inhalt: Projektstruktur, `pnpm check` als Pflichtlauf, die Konventionen
   aus diesem Dokument (oxlint/oxfmt statt ESLint/Prettier, Tests unter `tests/`,
   keine jsdom-Tests, Stores über `useSyncExternalStore` statt Zustand-Paket).
2. **Verbleibende `TODO`/`FIXME` erfassen:**
   ```bash
   grep -rnE 'TODO|FIXME|XXX|HACK' src src-tauri/src tests | grep -v node_modules
   ```
   Als Issues anlegen, nicht stillschweigend löschen.
3. **Ungenutzte Exporte finden.** `knip` oder `ts-prune` einmalig laufen lassen
   (nicht als dauerhafte Dependency). Nach dem Feature-Cut in Phase 4 und der
   Barrel-Auflösung in Phase 7 wird es Treffer geben.
4. **Abhängigkeiten aktualisieren.** Erst jetzt, nicht früher — ein Update
   mitten im Umbau macht die Fehlersuche unmöglich. `pnpm outdated`,
   dann in kleinen Gruppen.
5. **Bundle-Größe messen.** `pnpm build` und die Ausgabe von Vite prüfen. Falls
   ein Chunk auffällig groß ist: `rollup-plugin-visualizer` einmalig einsetzen.
   Kandidaten für Lazy-Loading sind CodeMirror-Sprachpakete (elf Stück in den
   Dependencies), `@streamdown/mermaid` und `react-material-icon-theme` — letzteres
   wird in `src/chrome/FileTypeIcon.tsx` bereits korrekt dynamisch importiert und
   ist ein gutes Vorbild für die anderen.

---

## Was ausdrücklich nicht getan wird

Diese Punkte sind bewusst ausgeschlossen. Ein ausführender Agent greift
erfahrungsgemäß reflexhaft danach.

- **Kommentare entfernen.** Die Kommentardichte liegt bei 1,7 % und die
  vorhandenen Kommentare erklären durchweg das _Warum_, nicht das _Was_.
  Beispiele: `"Finder-launched .app bundles often omit HOME/USER/SHELL. Fall back
to the passwd database…"` (`src-tauri/src/lib.rs`), `"A refused target still
swallows the drop: the tab stays put rather than reordering into a group it
cannot join."` Das ist genau das, was gewünscht ist — nur dort kommentiert, wo
  es nötig ist. **Diese Kommentare werden nicht angetastet.** Rationale, die
  einmal gelöscht ist, lässt sich aus dem Code nicht rekonstruieren.
- **jsdom oder React Testing Library hinzufügen.** Die Testarchitektur trennt
  bewusst Logik von Rendering und testet nur die Logik.
- **Ein State-Management-Paket hinzufügen.** Siehe Phase 8.
- **Die `*Protocol.ts`-Dateien abstrahieren**, ohne vorher belegt zu haben, dass
  sie tatsächlich gemeinsame Struktur haben. Siehe Phase 7, Schritt 4.
- **Tailwind-Klassen in Komponenten extrahieren oder ein Design-System bauen.**
  Nicht Teil dieses Auftrags.
- **Rust-Code umstrukturieren.** `src-tauri/src/fs.rs` hat 4.695 Zeilen und wäre
  ein legitimes Aufteilungsziel — aber das ist ein eigener Auftrag mit eigenem
  Risikoprofil und gehört nicht in diesen Plan. Falls doch gewünscht: als
  Phase 11 nach demselben Muster (Git-Operationen, GitHub-API, Dateisystem und
  Pfad-Hilfen sind die naheliegenden Schnitte).

---

## Übersicht

| Phase | Inhalt                                     | Risiko      | Umfang                |
| ----- | ------------------------------------------ | ----------- | --------------------- |
| 0     | Toolchain, pnpm, oxlint/oxfmt/lefthook, CI | niedrig     | Konfiguration         |
| 1     | Branding, tote Verweise                    | niedrig     | 18 Fundstellen        |
| 2     | Versionen synchronisieren                  | niedrig     | 4 Dateien             |
| 3     | Tests nach `tests/`                        | mittel      | 96 Dateien            |
| 4     | Feature-Cut (Arcade, Linux, Linear)        | mittel–hoch | ~3.100 Zeilen weniger |
| 5     | Actions und Vorlagen                       | niedrig     | `.github/`            |
| 6     | `src/lib` aufteilen                        | mittel      | ~230 Dateien          |
| 7     | Harness-Duplikate                          | mittel      | ~600 Zeilen weniger   |
| 8     | `App.tsx` aufbrechen                       | hoch        | 4.513 Zeilen          |
| 9     | README                                     | niedrig     | 1 Datei               |
| 10    | Abschluss                                  | niedrig     | —                     |

Phasen 0–5 sind unabhängig voneinander umsetzbar und können bei Bedarf
umsortiert werden. Ab Phase 6 ist die Reihenfolge bindend.

---

## Stand der Umsetzung

Stand 2026-09-02. Der Branch ist `chore/repo-rework`.

| Phase | Status | Anmerkung |
| --- | --- | --- |
| 0 Toolchain | erledigt | oxlint auf 1.80.0 gepinnt; 1.81.0 war jünger als pnpms `minimumReleaseAge` und ließ `pnpm install` scheitern |
| 1 Branding | erledigt | |
| 2 Versionen | erledigt | 0.1.0 in allen vier Manifesten, CHANGELOG auf Englisch |
| 3 Tests nach `tests/` | erledigt | Nachgezogen: die Imports gehen jetzt wirklich über `@/`, vorher waren es relative Pfade zurück nach `src/` |
| 4a Arcade | erledigt | |
| 4b Linux | erledigt | |
| 4c Linear | erledigt | |
| 5 Actions/Vorlagen | erledigt | `--notes-file` schreibt jetzt in eine echte Datei; Process Substitution hätte den Exit-Code des Skripts verschluckt |
| 6 Struktur | erledigt, abweichend | siehe unten |
| 7 Harness-Duplikate | erledigt | −680 Zeilen netto |
| 8 `App.tsx` | Schritt 1 erledigt | Hilfsfunktionen extrahiert und getestet; die Stores stehen aus |
| 9 README | erledigt | |
| 10 Abschluss | teilweise | siehe unten |

### Abweichung in Phase 6

Der Plan wollte `src/lib` vollständig in `features/` und `shared/` aufteilen und
dabei unter anderem `session.ts` nach `features/session/` und `fs.ts` nach
`features/files/` legen. Der tatsächliche Importgraph spricht dagegen:

| Modul | Importeure |
| --- | --- |
| `session` | 73 |
| `fs` | 39 |
| `paths` | 31 |
| `recents` | 31 |
| `models` | 29 |
| `platform` | 22 |

Ein Modul, das von 73 der rund 250 Dateien importiert wird, ist kein
Feature-Modul, sondern das gemeinsame Vokabular. Hinter eine Feature-Grenze
gelegt, würde es den größten Teil der Codebasis zum Grenzgänger machen — die
Struktur würde also gerade die Kopplung verschleiern, die sie sichtbar machen
soll.

Umgesetzt wurde deshalb: Module mit breitem Fan-in bleiben in `src/lib`,
verschoben wurden die sieben Cluster, die sowohl namentlich als auch im
Importgraph zusammengehören (`sessions`, `workspace`, `terminal`, `files`,
`inbox`, `updates`, `project`) plus die Editor-Logik aus `surfaces/`. `src/lib`
geht damit von 85 auf 48 flache Dateien.

Ebenfalls anders als geplant: `App.tsx` und `main.tsx` bleiben liegen. Der
Umzug nach `src/app/` bringt strukturell nichts und `index.html` verweist als
reines HTML auf `/src/main.tsx` — ein vermeidbares Risiko ohne Gegenwert.
`harness/` wurde nicht weiter unterteilt; es ist bereits eine kohärente Domäne.

### Offen in Phase 8

Extrahiert und mit 33 neuen Tests abgedeckt sind die reinen Hilfsfunktionen:
`lib/equality`, `lib/workspace/titleTab`, `lib/workspace/workspaceEffects`,
`lib/sessions/sessionChoice`, `lib/harness/flush`. `App.tsx` steht bei 3.704
Zeilen (vorher 4.513).

Nicht angefasst sind die Store-Extraktionen (Schritte 2 bis 5). Das ist der
Teil, bei dem ein Fehler dem Typechecker entgeht, und ein halb migrierter
Session-Store ist schlechter als gar keiner.

**Wichtig für den nächsten Durchgang:** Das Gate dieser Phase verlangt eine
React-DevTools-Messung *vor* Beginn — was rendert alles neu, wenn man ein
Zeichen in den Composer tippt. Diese Messung wurde nicht aufgenommen und lässt
sich nicht nachholen. Sie muss vor dem ersten Store-Commit erfolgen, sonst gibt
es keinen Beleg für die Performance-Wirkung.

### Offen in Phase 10

- **Bundle.** Der Einstiegs-Chunk liegt bei 2,43 MB (774 kB gzip) und enthält
  statisch importiert: xterm, streamdown und CodeMirror. Die 379 übrigen Chunks
  sind Syntax-Grammatiken und Mermaid-Diagrammtypen, die bereits nachgeladen
  werden. Lazy-Loading der drei großen Brocken ist die nächste sinnvolle
  Maßnahme, braucht aber Suspense-Grenzen und Ladezustände — eine eigene
  Aufgabe, kein Aufräumschritt.
- **Ungenutzte Exporte.** Ein Scan findet rund 240 Exporte ohne Referenz
  außerhalb ihrer eigenen Datei. Ein großer Teil davon sind bewusst exportierte
  Typen; wahllos zu löschen wäre riskanter als der Nutzen. Sinnvoll wäre ein
  Durchgang mit `knip`, Datei für Datei bewertet.
- **Dependency-Updates.** Bewusst nicht gemacht: `pnpm outdated` meldet unter
  anderem TypeScript 7, Vite 8 und Vitest 4. Major-Sprünge gehören nicht in
  denselben Durchgang wie ein Umbau.
- **TODO/FIXME:** keine im Code.

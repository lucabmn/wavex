/**
 * Which language servers the user has turned on.
 *
 * A language server is a long-lived child process that indexes a whole
 * checkout — rust-analyzer runs `cargo check` and holds a crate graph in
 * memory. Starting one for every language a project happens to contain, the
 * first time a file of that language is opened, spends the user's machine on a
 * decision they never made.
 *
 * So nothing starts on its own. Opening a file whose language wavex has a
 * server for offers it once; the answer is remembered per profile and can be
 * changed in Settings at any time.
 */

import { profileStorage } from "../profiles/profileStorage";

export type LanguageServerChoice = "enabled" | "disabled" | "undecided";

const KEY = "wavex.languageServers";
const CHANGE_EVENT = "wavex:language-servers-changed";

type Choices = Record<string, boolean>;

let cache: Choices | null = null;
let version = 0;

function read(): Choices {
  if (cache) return cache;
  try {
    const raw = profileStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    cache =
      parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? Object.fromEntries(
            Object.entries(parsed as Record<string, unknown>)
              .filter(([, value]) => typeof value === "boolean")
              .map(([id, value]) => [id, value as boolean]),
          )
        : {};
  } catch {
    cache = {};
  }
  return cache;
}

/**
 * `undecided` is not `disabled`: it is what makes the offer appear once and
 * then never again, whichever way the user answers.
 */
export function languageServerChoice(serverId: string): LanguageServerChoice {
  const value = read()[serverId];
  if (value === undefined) return "undecided";
  return value ? "enabled" : "disabled";
}

export function isLanguageServerEnabled(serverId: string): boolean {
  return languageServerChoice(serverId) === "enabled";
}

export function setLanguageServerEnabled(serverId: string, enabled: boolean): void {
  const next = { ...read(), [serverId]: enabled };
  cache = next;
  try {
    profileStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // private mode / quota — the choice still holds for this session
  }
  emit();
}

/** Back to undecided, so the offer appears again the next time it applies. */
export function forgetLanguageServerChoice(serverId: string): void {
  const next = { ...read() };
  delete next[serverId];
  cache = next;
  try {
    profileStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // private mode / quota
  }
  emit();
}

export function subscribeLanguageServerChoices(onStoreChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(CHANGE_EVENT, onStoreChange);
  return () => window.removeEventListener(CHANGE_EVENT, onStoreChange);
}

export function languageServerChoicesSnapshot(): number {
  return version;
}

/** A profile switch swaps the store underneath; the next read re-reads it. */
export function resetLanguageServerChoices(): void {
  cache = null;
  emit();
}

function emit(): void {
  version += 1;
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
}

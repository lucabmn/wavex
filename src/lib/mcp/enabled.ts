/**
 * Which MCP servers wavex hands to an agent it starts.
 *
 * An MCP server is an arbitrary program — `npx -y something` — that the agent
 * spawns and then trusts with tool calls. Passing every server a CLI happens to
 * have configured into every session wavex starts would run those programs on a
 * decision the user never made, which is the same objection `lsp/enabled.ts`
 * answers for language servers.
 *
 * So the default is off and the answer is per profile. A CLI's own sessions are
 * unaffected either way: this only governs what wavex puts in the message it
 * composes.
 */

import { profileStorage } from "../profiles/profileStorage";

const KEY = "wavex.mcpServers";
const CHANGE_EVENT = "wavex:mcp-servers-changed";

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
              .map(([name, value]) => [name, value as boolean]),
          )
        : {};
  } catch {
    cache = {};
  }
  return cache ?? {};
}

/**
 * Keyed by name rather than by definition, because a name is what an agent
 * addresses: turning `context7` on is one answer, not one per CLI that
 * configured it.
 */
export function isMcpServerEnabled(name: string): boolean {
  return read()[name] === true;
}

export function enabledMcpServerNames(): string[] {
  return Object.entries(read())
    .filter(([, enabled]) => enabled)
    .map(([name]) => name)
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}

export function setMcpServerEnabled(name: string, enabled: boolean): void {
  const next = { ...read() };
  if (enabled) next[name] = true;
  // Off is the default, so an off server is an absent key rather than a
  // `false` that would accumulate for every server the user ever saw.
  else delete next[name];
  cache = next;
  try {
    profileStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // private mode / quota — the choice still holds for this session
  }
  emit();
}

export function subscribeMcpServerChoices(onStoreChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(CHANGE_EVENT, onStoreChange);
  return () => window.removeEventListener(CHANGE_EVENT, onStoreChange);
}

export function mcpServerChoicesSnapshot(): number {
  return version;
}

/** A profile switch swaps the store underneath; the next read re-reads it. */
export function resetMcpServerChoices(): void {
  cache = null;
  emit();
}

function emit(): void {
  version += 1;
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
}

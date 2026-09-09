import { gitBranches, gitStagedContext } from "../fs";
import type { HostId } from "../host";
import { displayPath } from "../paths";
import { peekFocusedEditorPath } from "../workspace/focusedFile";

/**
 * Placeholders a prompt template may carry. The set is closed on purpose: a
 * body is plain text that may legitimately hold `{{…}}` belonging to another
 * templating language, so a name that is not one of these is left exactly as it
 * was typed rather than silently emptied.
 */
export const TEMPLATE_VARIABLES = ["branch", "file", "diff"] as const;

export type TemplateVariable = (typeof TEMPLATE_VARIABLES)[number];

/** What each placeholder stands for, for the template editor to show. */
export const TEMPLATE_VARIABLE_HELP: Record<TemplateVariable, string> = {
  branch: "the checked-out branch",
  file: "the file the editor is on",
  diff: "staged changes, or the working tree against HEAD",
};

export type TemplateVariableContext = {
  /** The checkout the turn runs in, which is the worktree when there is one. */
  cwd: string;
  hostId?: HostId;
  /** Absent when no file is open; `{{file}}` then resolves to nothing. */
  filePath?: string | null;
};

const PLACEHOLDER = /\{\{\s*([A-Za-z][A-Za-z0-9_-]*)\s*\}\}/g;

/**
 * A patch has no upper bound, and a repository-wide one pasted into a turn is
 * cost the user did not ask for. Cut on a line so the tail is still a diff.
 */
const DIFF_MAX = 80_000;
const DIFF_TRUNCATED = "\n… diff truncated.";

const KNOWN = new Set<string>(TEMPLATE_VARIABLES);

function knownVariable(raw: string): TemplateVariable | null {
  const name = raw.toLowerCase();
  return KNOWN.has(name) ? (name as TemplateVariable) : null;
}

/** The placeholders this text actually uses, so nothing else is looked up. */
export function templateVariablesInText(text: string): Set<TemplateVariable> {
  const found = new Set<TemplateVariable>();
  if (!text.includes("{{")) return found;
  PLACEHOLDER.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = PLACEHOLDER.exec(text))) {
    const name = knownVariable(match[1] ?? "");
    if (name) found.add(name);
  }
  return found;
}

/**
 * Pure half of the expansion. A known placeholder with no value is dropped —
 * one rule for "there is no branch" and "there is no diff" alike — while an
 * unknown one survives untouched.
 */
export function substituteTemplateVariables(
  text: string,
  values: ReadonlyMap<TemplateVariable, string>,
): string {
  if (!text.includes("{{")) return text;
  return text.replace(PLACEHOLDER, (literal, raw: string) => {
    const name = knownVariable(raw);
    if (!name) return literal;
    return values.get(name) ?? literal;
  });
}

/** Ask the host only for the placeholders that appear. */
export async function resolveTemplateVariables(
  names: ReadonlySet<TemplateVariable>,
  context: TemplateVariableContext,
): Promise<Map<TemplateVariable, string>> {
  const values = new Map<TemplateVariable, string>();
  if (names.size === 0) return values;

  if (names.has("file")) {
    const path = context.filePath ?? "";
    values.set("file", path ? displayPath(path, context.cwd) : "");
  }

  let branch: string | null = null;
  if (names.has("diff")) {
    // Errors when the checkout is clean, which is a diff of nothing, not a
    // failed turn.
    const staged = await gitStagedContext(context.cwd, context.hostId).catch(() => null);
    const patch = staged ? staged.patch.trim() || staged.summary.trim() : "";
    values.set("diff", capDiff(patch));
    branch = staged?.branch ?? null;
  }

  if (names.has("branch")) {
    // The diff answered this already whenever it ran against a dirty checkout.
    const current =
      branch ??
      (await gitBranches(context.cwd, context.hostId)
        .then((listed) => listed.current)
        .catch(() => null));
    values.set("branch", current ?? "");
  }

  return values;
}

/**
 * Expand placeholders in a turn. Runs before file mentions, so `@{{file}}`
 * reaches the harness as that file's contents while a bare `{{file}}` stays the
 * path, and after template expansion, so a body inserted from the picker and
 * one typed as `/name` are treated the same.
 */
export async function applyTemplateVariablesToTurn(
  text: string,
  context: { cwd: string; hostId?: HostId },
): Promise<string> {
  const names = templateVariablesInText(text);
  if (names.size === 0) return text;
  const values = await resolveTemplateVariables(names, {
    cwd: context.cwd,
    hostId: context.hostId,
    filePath: peekFocusedEditorPath(),
  });
  return substituteTemplateVariables(text, values);
}

function capDiff(patch: string): string {
  if (patch.length <= DIFF_MAX) return patch;
  const cut = patch.lastIndexOf("\n", DIFF_MAX);
  return `${patch.slice(0, cut > 0 ? cut : DIFF_MAX)}${DIFF_TRUNCATED}`;
}

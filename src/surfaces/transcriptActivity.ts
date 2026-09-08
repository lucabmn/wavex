import {
  composeToolTitle,
  isAgentTool,
  isEditTool,
  isExecuteTool,
  isReadTool,
  isSearchTool,
  isWeakToolTitle,
} from "../lib/harness/preview";
import { leafName } from "../lib/files/fileName";
import { displayPath } from "../lib/paths";
import type { Block } from "../lib/session";

export type ToolCallState = "pending" | "accepted" | "rejected";

export type TurnItem = { type: "block"; block: Block } | { type: "activity"; blocks: Block[] };

export function needsApproval(block: Block): boolean {
  return !!block.approval && !block.approval.decided;
}

export function toolCallState(block: Block): ToolCallState {
  const status = block.tool?.status?.toLowerCase() ?? "";
  const decided = block.approval?.decided;

  if (decided === "deny") return "rejected";
  if (
    status === "failed" ||
    status === "error" ||
    status === "cancelled" ||
    status === "canceled"
  ) {
    return "rejected";
  }
  if (needsApproval(block)) return "pending";
  if (status === "completed" || status === "success") return "accepted";
  if (block.streaming || status === "in_progress" || status === "pending" || status === "running") {
    return "pending";
  }
  if (decided === "allow" || decided === "cancelled" || !status) {
    return "accepted";
  }
  return "pending";
}

export function toolCallLabel(block: Block, cwd?: string): string {
  const preview = block.tool?.preview;
  const path = preview?.path ? displayPath(preview.path, cwd) : preview?.fileName;
  return (
    composeToolTitle({
      kind: block.tool?.kind,
      title: block.text || block.tool?.title,
      path,
      query: preview?.query,
      previewKind: preview?.kind,
      cwd,
    }) || "Working"
  );
}

export function isIncompleteTool(block: Block, label: string, state: ToolCallState): boolean {
  if (state !== "pending") return false;
  const kind = block.tool?.kind?.toLowerCase();
  if (kind && kind !== "other") return false;
  if (
    block.tool?.preview?.path ||
    block.tool?.preview?.query ||
    block.tool?.preview?.lines?.length
  ) {
    return false;
  }
  return !label || isWeakToolTitle(label);
}

export function isHiddenTool(block: Block): boolean {
  if (block.role !== "tool" && block.role !== "approval") return false;
  if (isEditTool(block.tool?.kind, block.text || block.tool?.title, block.tool?.preview)) {
    return false;
  }
  const state = toolCallState(block);
  return isIncompleteTool(block, toolCallLabel(block), state);
}

/**
 * Foldable work: tool calls, thinking, and edits. An edit still awaiting
 * approval stays out — you cannot judge a diff you cannot see.
 */
export function isActivityBlock(block: Block): boolean {
  if (isThinkingBlock(block)) return true;
  if (block.role !== "tool" && block.role !== "approval") return false;
  if (
    isEditTool(block.tool?.kind, block.text || block.tool?.title, block.tool?.preview) &&
    needsApproval(block)
  ) {
    return false;
  }
  return !isHiddenTool(block);
}

/** Reasoning the agent streams while it works. */
export function isThinkingBlock(block: Block): boolean {
  return block.role === "reasoning" && !!block.text.trim();
}

export function isToolBlock(block: Block): boolean {
  return block.role === "tool" || block.role === "approval";
}

/** Assistant prose with something in it — the paragraphs between tool calls. */
export function isProseBlock(block: Block): boolean {
  return block.role === "assistant" && !!block.text.trim();
}

/**
 * Where the turn's final answer starts: the trailing run of assistant prose.
 * Everything before it folds, so the last thing the agent says is the only
 * full-size thing left. A block still streaming sits in that run, which is why
 * text renders in full as it arrives and only folds once the next tool starts.
 */
export function finalResponseStart(blocks: Block[]): number {
  let index = blocks.length;
  while (index > 0 && isProseBlock(blocks[index - 1])) index -= 1;
  return index;
}

export type SubagentStatus = "running" | "completed" | "failed" | "stopped";

/** Live state of the subagent behind an Agent call. Null when there is none. */
export function subagentStatus(block: Block, busy = false): SubagentStatus | null {
  if (!block.subagent) return null;
  const state = toolCallState(block);
  if (state === "rejected") return "failed";
  if (state === "accepted" || block.subagent.finishedAt != null) return "completed";
  const status = block.tool?.status?.toLowerCase() ?? "";
  if (
    block.streaming ||
    busy ||
    status === "in_progress" ||
    status === "pending" ||
    status === "running"
  ) {
    return "running";
  }
  return "stopped";
}

/** Newest thing the subagent did, for the parent row. */
export function subagentLatestActivity(block: Block, cwd?: string): string | null {
  const detail = block.tool?.detail?.trim();
  if (detail) return detail;
  const nested = block.subagent?.blocks;
  if (!nested || nested.length === 0) return null;
  for (let index = nested.length - 1; index >= 0; index -= 1) {
    const entry = nested[index];
    if (isHiddenTool(entry)) continue;
    if (isThinkingBlock(entry) || isProseBlock(entry)) return proseSummary(entry.text);
    if (isToolBlock(entry)) return toolCallLabel(entry, cwd);
  }
  return null;
}

/** Short clock for activity rows: 12s, 3m 4s. Null when there is nothing to show. */
export function formatElapsed(elapsedMs: number | null): string | null {
  if (elapsedMs == null) return null;
  const totalSec = Math.max(1, Math.round(elapsedMs / 1000));
  if (totalSec < 60) return `${totalSec}s`;
  const minutes = Math.floor(totalSec / 60);
  const seconds = totalSec % 60;
  return seconds ? `${minutes}m ${seconds}s` : `${minutes}m`;
}

/**
 * A live thought is rendered as markdown on every commit, and markdown costs
 * what its source costs — a wall-of-text think is one giant paragraph and a
 * bulleted one is a giant list, so capping blocks bounds neither. While the
 * thought is still streaming the open fold shows a window on its tail instead;
 * the whole trace renders once the turn settles and stops costing anything per
 * commit.
 */
export const LIVE_REASONING_WINDOW = 4096;

/**
 * How far past the window the tail may grow before it slides. Rebuilding on
 * every commit would re-cut, re-parse and relayout the whole window each time,
 * so the start only moves once — and fast reasoning appends kilobytes per
 * commit, which is why the slack is this wide rather than a few hundred bytes.
 */
export const LIVE_REASONING_WINDOW_MAX = 12_288;

/**
 * Where the visible tail of a streaming thought begins. `previous` is the start
 * this block was last rendered at; returning it unchanged is the common case
 * and the reason the window is cheap.
 */
export function liveReasoningStart(length: number, streaming: boolean, previous: number): number {
  if (!streaming || length <= LIVE_REASONING_WINDOW) return 0;
  const start = previous > length ? 0 : previous;
  if (length - start <= LIVE_REASONING_WINDOW_MAX) return start;
  return length - LIVE_REASONING_WINDOW;
}

/**
 * Where the window really begins: a line break, so a slide never lands mid-word
 * or mid-table-row — and never inside a code fence, which would open the window
 * on a stray closing fence and render the thought as one long code block. An
 * odd number of fence markers behind the cut means it fell inside one, so the
 * cut moves down to where that fence ends.
 *
 * The parity walk is O(text), so this belongs once per slide, cached beside the
 * start. Running it per render would put back exactly the whole-text cost the
 * window exists to remove.
 */
export function liveReasoningCut(text: string, start: number): number {
  if (start <= 0) return 0;
  // A think with no break left after the start is one long line; cutting at the
  // start shows a partial word, which still beats showing nothing.
  const line = text.indexOf("\n", start);
  const cut = line === -1 ? start : line + 1;
  if (fenceMarkersBefore(text, cut) % 2 === 0) return cut;
  const close = text.indexOf("```", cut);
  if (close === -1) return text.length;
  const after = text.indexOf("\n", close);
  return after === -1 ? text.length : after + 1;
}

/** The windowed tail itself. */
export function liveReasoningTail(text: string, start: number): string {
  return start <= 0 ? text : text.slice(liveReasoningCut(text, start));
}

function fenceMarkersBefore(text: string, cut: number): number {
  let count = 0;
  for (let index = text.indexOf("```"); index !== -1 && index < cut;) {
    count += 1;
    index = text.indexOf("```", index + 3);
  }
  return count;
}

/**
 * How much of a block this summary is allowed to read. Every caller renders the
 * result as one truncated line, so the first paragraph is the whole answer and
 * a window an order of magnitude wider than any line that can fit cannot change
 * what is displayed. A streaming reasoning block reaches this on every commit,
 * and the old whole-text fence pass grew with the think: ~0.05 ms per row per
 * commit at 128 KB, unbounded above that.
 */
const PROSE_SCAN_LIMIT = 4096;

/**
 * The leading window of `text` with fenced code replaced by a space, which is
 * what the paragraph split below expects. Fences are hopped with `indexOf`
 * rather than a global `/```[\s\S]*?(?:```|$)/` pass so a long code block costs
 * a scan, not regex backtracking over the whole block.
 */
function proseScanWindow(text: string): string {
  let body = "";
  let index = 0;
  while (index < text.length && body.length < PROSE_SCAN_LIMIT) {
    const fence = text.indexOf("```", index);
    if (fence !== index) {
      const plainEnd = fence === -1 ? text.length : fence;
      const end = Math.min(plainEnd, index + (PROSE_SCAN_LIMIT - body.length));
      body += text.slice(index, end);
      index = end;
      continue;
    }
    const close = text.indexOf("```", fence + 3);
    body += " ";
    index = close === -1 ? text.length : close + 3;
  }
  return body;
}

/** First paragraph of a folded prose block, stripped to one plain line. */
export function proseSummary(text: string): string {
  const body = proseScanWindow(text);
  const paragraph =
    body
      .split(/\n\s*\n/)
      .map((part) => part.trim())
      .find(Boolean) ?? "";
  return paragraph
    .replace(/^\s{0,3}(?:#{1,6}|>|[-*+]|\d+\.)\s+/gm, "")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/(\*|_)(.+?)\1/g, "$2")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Canonical verb for a write-preview row, so edits read as "Edit src/app.ts"
 * alongside "Read" and "Find". Harnesses phrase these in past tense, hence the
 * doubled-up forms.
 */
export function editVerb(label: string): string {
  const word = label.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
  if (/^(delete|deleted|remove|removed)$/.test(word)) return "Delete";
  if (/^(move|moved|rename|renamed)$/.test(word)) return "Move";
  if (/^(create|created|add|added|new)$/.test(word)) return "Create";
  if (/^(write|wrote|writing)$/.test(word)) return "Write";
  return "Edit";
}

/** User turns, with handoff dividers sitting on their own row. */
export function groupTurns(blocks: Block[]): Block[][] {
  const turns: Block[][] = [];
  let current: Block[] = [];
  for (const block of blocks) {
    if (block.role === "handoff") {
      if (current.length > 0) turns.push(current);
      turns.push([block]);
      current = [];
      continue;
    }
    if (block.role === "user" && current.length > 0) {
      turns.push(current);
      current = [];
    }
    current.push(block);
  }
  if (current.length > 0) turns.push(current);
  return turns;
}

/**
 * Fold a turn's working process — tool calls and the prose between them —
 * into one activity group, leaving the final answer standing alone.
 */
export function groupTurnItems(blocks: Block[]): TurnItem[] {
  const visible = blocks.filter((block) => !isIgnoredTurnBlock(block) && !isHiddenTool(block));
  const finalStart = finalResponseStart(visible);
  const items: TurnItem[] = [];
  let activity: Block[] = [];
  const flush = () => {
    if (activity.length > 0) {
      items.push({ type: "activity", blocks: activity });
    }
    activity = [];
  };
  visible.forEach((block, index) => {
    if (isActivityBlock(block) || (index < finalStart && isProseBlock(block))) {
      activity.push(block);
      return;
    }
    flush();
    items.push({ type: "block", block });
  });
  flush();
  return items;
}

function isIgnoredTurnBlock(block: Block): boolean {
  // Keep thinking as a step in the group, so a long think does not read as
  // the agent having stalled.
  if (block.role === "reasoning") return !block.text.trim();
  return block.role === "assistant" && !block.text.trim();
}

/** Markdown the user actually reads: assistant prose plus any plan, not tool chrome. */
export function turnCopyText(blocks: Block[]): string {
  return blocks
    .filter((block) => block.role === "assistant" || block.role === "plan")
    .map((block) => block.text.replace(/\r\n?/g, "\n").trim())
    .filter(Boolean)
    .join("\n\n");
}

/**
 * The activity group a settled turn hangs its "Worked for" line on: the last
 * one, which sits right above the final answer.
 */
export function lastActivityIndex(items: TurnItem[]): number {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (items[index].type === "activity") return index;
  }
  return -1;
}

/** True while a tool in this turn is still running or waiting on the user. */
export function activityStillRunning(blocks: Block[]): boolean {
  return blocks.some(
    (block) => (isToolBlock(block) && toolCallState(block) === "pending") || needsApproval(block),
  );
}

export function hasRunningSubagent(blocks: Block[]): boolean {
  return blocks.some(
    (block) =>
      isToolBlock(block) &&
      isAgentTool(block.tool?.kind, block.text || block.tool?.title) &&
      toolCallState(block) === "pending",
  );
}

/**
 * What a run of tool calls was for. Reads and searches are one thing — looking
 * around — so a grep followed by the file it turned up stays one group.
 */
export type ActivityWorkKind = "research" | "edit" | "run" | "agent" | "other";

/** A work kind, or a group the agent only narrated: a thought, or a note. */
export type ActivityPhaseKind = ActivityWorkKind | "think" | "note";

/**
 * One chunk of a turn: the line the agent wrote before it started ("now I need
 * to find the theme provider"), and the calls that line introduced.
 */
export type ActivityPhase = {
  id: string;
  kind: ActivityPhaseKind;
  /** The agent's own words for this run, when it wrote some. */
  headline?: Block;
  steps: Block[];
};

/** Ties break towards the kind that changed the most: an edit outranks a read. */
const WORK_KIND_ORDER: ActivityWorkKind[] = ["edit", "run", "agent", "research", "other"];

export function toolCategory(block: Block): ActivityWorkKind {
  const kind = block.tool?.kind;
  const title = block.text || block.tool?.title;
  const preview = block.tool?.preview;
  if (isAgentTool(kind, title)) return "agent";
  if (isEditTool(kind, title, preview)) return "edit";
  if (isSearchTool(kind, title, preview)) return "research";
  if (isReadTool(kind, title, preview)) return "research";
  if (isExecuteTool(kind, title)) return "run";
  return "other";
}

/**
 * Splits a turn's activity into labelled groups. Two things start a new one:
 * the agent saying what it is about to do, and it switching from one kind of
 * work to another. Everything else piles into the group already open.
 */
export function buildActivityPhases(blocks: Block[]): ActivityPhase[] {
  const phases: ActivityPhase[] = [];
  let current: ActivityPhase | undefined;

  const open = (kind: ActivityPhaseKind, headline?: Block) => {
    current = { id: headline?.id ?? "", kind, headline, steps: [] };
    phases.push(current);
    return current;
  };

  for (const block of blocks) {
    // Reasoning is a step, never a header. The agent's own words title a
    // group; the thinking behind them belongs inside it, where it reads as
    // working out rather than as another thing the agent said.
    if (isThinkingBlock(block)) {
      if (!current) current = open("think");
      current.steps.push(block);
      if (!current.id) current.id = block.id;
      continue;
    }
    if (isProseBlock(block)) {
      const narrating = current?.kind === "think" || current?.kind === "note";
      // A line after work has started is the title of what comes next, not a
      // footnote to what just happened.
      if (!current || !narrating) {
        current = open("note", block);
      } else if (!current.headline) {
        // A group that opened on a thought takes the agent's words as its
        // title, keeping the id it already has so the group is not remounted.
        current.headline = block;
        current.kind = "note";
      } else {
        current.steps.push(block);
      }
      continue;
    }
    const kind = toolCategory(block);
    if (!current) {
      current = open(kind);
    } else if (current.kind === "think" || current.kind === "note") {
      // The group the agent announced takes the shape of the work it announced.
      current.kind = kind;
    } else if (current.kind !== kind) {
      // A thought at the end of a group was about what came next: it moves
      // into the group it introduced.
      const trailing = takeTrailingNarration(current);
      current = open(kind);
      current.steps.push(...trailing);
      if (trailing[0]) current.id = trailing[0].id;
    }
    current.steps.push(block);
    if (!current.id) current.id = block.id;
  }

  return absorbStrayPhases(phases);
}

/** The run of thinking a group ends on, lifted out of it. */
function takeTrailingNarration(phase: ActivityPhase): Block[] {
  let cut = phase.steps.length;
  while (cut > 0 && !isToolBlock(phase.steps[cut - 1])) cut -= 1;
  return phase.steps.splice(cut);
}

/**
 * A single call the agent never introduced — the read wedged between two edits,
 * the test run after them — folds back into the group before it rather than
 * taking a header of its own.
 */
function absorbStrayPhases(phases: ActivityPhase[]): ActivityPhase[] {
  const kept: ActivityPhase[] = [];
  for (const phase of phases) {
    const previous = kept[kept.length - 1];
    const stray = !phase.headline && phase.steps.filter(isToolBlock).length === 1;
    if (
      previous &&
      stray &&
      previous.steps.length > 0 &&
      phase.kind !== "agent" &&
      previous.kind !== "agent"
    ) {
      previous.steps.push(...phase.steps);
      previous.kind = dominantWorkKind(previous.steps) ?? previous.kind;
      continue;
    }
    kept.push(phase);
  }
  return kept;
}

function dominantWorkKind(steps: Block[]): ActivityWorkKind | undefined {
  const counts = new Map<ActivityWorkKind, number>();
  for (const block of steps) {
    if (!isToolBlock(block)) continue;
    const kind = toolCategory(block);
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }
  return dominantCountedWorkKind(counts);
}

function dominantCountedWorkKind(
  counts: ReadonlyMap<ActivityWorkKind, number>,
): ActivityWorkKind | undefined {
  let best: ActivityWorkKind | undefined;
  for (const kind of WORK_KIND_ORDER) {
    const count = counts.get(kind) ?? 0;
    if (count > 0 && (!best || count > (counts.get(best) ?? 0))) best = kind;
  }
  return best;
}

type PhaseTally = {
  reads: Set<string>;
  edits: Set<string>;
  searches: number;
  runs: number;
  others: number;
};

function tallySteps(steps: Block[]): PhaseTally {
  const tally: PhaseTally = {
    reads: new Set(),
    edits: new Set(),
    searches: 0,
    runs: 0,
    others: 0,
  };
  for (const block of steps) {
    if (!isToolBlock(block)) continue;
    const kind = block.tool?.kind;
    const title = block.text || block.tool?.title;
    const preview = block.tool?.preview;
    const target = preview?.path ?? preview?.fileName ?? block.id;
    if (isEditTool(kind, title, preview)) tally.edits.add(target);
    else if (isSearchTool(kind, title, preview)) tally.searches += 1;
    else if (isReadTool(kind, title, preview)) tally.reads.add(target);
    else if (isExecuteTool(kind, title)) tally.runs += 1;
    else tally.others += 1;
  }
  return tally;
}

function fileLabel(paths: Set<string>): string {
  const [first] = paths;
  if (paths.size === 1 && first) return leafName(first) || first;
  return `${paths.size} files`;
}

/**
 * The group's header. The agent's own line if it wrote one, otherwise what the
 * calls add up to — in the present tense while the group is still running, so
 * "Reading 3 files" becomes "Read 3 files" the moment it folds.
 */
export function activityPhaseTitle(phase: ActivityPhase, live = false): string {
  if (phase.headline) {
    const summary = proseSummary(phase.headline.text);
    if (summary) return summary;
    return phase.headline.role === "reasoning" ? "Thinking" : "Working";
  }
  const tally = tallySteps(phase.steps);
  switch (phase.kind) {
    case "edit":
      return `${live ? "Editing" : "Edited"} ${fileLabel(tally.edits)}`;
    case "research":
      if (tally.reads.size > 0 && tally.searches === 0) {
        return `${live ? "Reading" : "Read"} ${fileLabel(tally.reads)}`;
      }
      if (tally.reads.size === 0) {
        return live ? "Searching the project" : "Searched the project";
      }
      return live ? "Exploring the project" : "Explored the project";
    case "run":
      return tally.runs === 1
        ? live
          ? "Running a command"
          : "Ran a command"
        : `${live ? "Running" : "Ran"} ${tally.runs} commands`;
    case "agent": {
      const count = phase.steps.filter(isToolBlock).length;
      return count <= 1
        ? live
          ? "Running a subagent"
          : "Ran a subagent"
        : `${live ? "Running" : "Ran"} ${count} subagents`;
    }
    case "think":
      return live ? "Thinking" : "Thought";
    default:
      return tally.others === 1
        ? live
          ? "Running a tool"
          : "Ran a tool"
        : `${live ? "Running" : "Ran"} ${tally.others} tools`;
  }
}

/** True when a nested scroller should consume this wheel, not the parent. */
export function nestedScrollAbsorbsWheel(
  el: { scrollTop: number; scrollHeight: number; clientHeight: number },
  deltaY: number,
): boolean {
  if (el.scrollHeight <= el.clientHeight + 1) return false;
  const atTop = el.scrollTop <= 0;
  const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 1;
  return (deltaY < 0 && !atTop) || (deltaY > 0 && !atBottom);
}

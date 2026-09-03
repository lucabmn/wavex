import { invoke } from "@tauri-apps/api/core";
import {
  assistantTextBlocks,
  assistantToolUses,
  isSubagentMessage,
  parseJsonLine,
  previewFromTool,
  stringField,
  toolKindFromName,
  toolResultsFromUserMessage,
  toolTitle,
} from "./claudeProtocol";
import type { HarnessEvent } from "./types";

/**
 * Recovering a turn that ran with nobody watching.
 *
 * An agent kept running across a profile switch finishes its work against a
 * webview that no longer exists, so wavex never sees the stream. Claude keeps
 * its own record of the same turn, in the same message shape the live stream
 * uses, so the turn can be rebuilt from disk rather than lost.
 *
 * This is a rebuild, not a replay: it runs once, over a turn that has already
 * ended, with no `Live` to desync and no approvals left to answer. Anything
 * that only makes sense while a turn is in flight — partial message deltas,
 * permission requests, control responses — is deliberately absent.
 */

/**
 * A subagent's own messages belong to the parent tool, not the transcript.
 * The stored record marks them `isSidechain`, where the live stream carries
 * `parent_tool_use_id`; a rebuild has to know both spellings.
 */
function isSubagentRecord(record: Record<string, unknown>): boolean {
  return isSubagentMessage(record) || record.isSidechain === true;
}

/** A stored record is only interesting if it belongs to the turn we lost. */
function recordTimestamp(record: Record<string, unknown>): number | null {
  const raw = stringField(record, "timestamp");
  if (!raw) return null;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * The events a stored transcript implies for everything from `since` onward.
 *
 * Tool results arrive in later `user` records, so a tool started inside the
 * window can be completed by one outside it; the pass tracks which calls it
 * opened and accepts results for exactly those.
 */
export function claudeTranscriptEvents(lines: string[], since: number): HarnessEvent[] {
  const events: HarnessEvent[] = [];
  const opened = new Map<string, string>();
  let text = "";

  for (const line of lines) {
    const record = parseJsonLine(line);
    if (!record) continue;
    const type = stringField(record, "type");
    if (type !== "assistant" && type !== "user") continue;
    if (isSubagentRecord(record)) continue;

    if (type === "user") {
      for (const result of toolResultsFromUserMessage(record)) {
        const title = opened.get(result.toolUseId);
        if (title === undefined) continue;
        events.push({
          type: "tool.updated",
          callId: result.toolUseId,
          title,
          status: result.isError ? "error" : "completed",
          detail: result.text || undefined,
        });
      }
      continue;
    }

    const at = recordTimestamp(record);
    if (at !== null && at < since) continue;

    text += assistantTextBlocks(record).join("");

    for (const use of assistantToolUses(record)) {
      if (opened.has(use.id)) continue;
      const title = toolTitle(use.name, use.input);
      opened.set(use.id, title);
      events.push({
        type: "tool.started",
        callId: use.id,
        title,
        kind: toolKindFromName(use.name),
        status: "in_progress",
        preview: previewFromTool(use.name, use.input),
      });
    }
  }

  if (!text && events.length === 0) return [];
  // One block for the whole answer: the deltas that produced it live only in
  // the stream, and splitting the stored text back up would invent a shape
  // the record does not have.
  return text ? [{ type: "message.delta", text }, ...events] : events;
}

/** Claude's own record of a session, newest turn included. Empty when absent. */
export async function readClaudeTranscript(
  cwd: string,
  providerSessionId: string,
): Promise<string[]> {
  return invoke<string[]>("harness_claude_transcript", { cwd, providerSessionId }).catch(
    () => [] as string[],
  );
}

/** Rebuilds the turn a session was left running, if Claude recorded one. */
export async function importClaudeDetachedTurn(input: {
  cwd: string;
  providerSessionId: string;
  since: number;
}): Promise<HarnessEvent[]> {
  const lines = await readClaudeTranscript(input.cwd, input.providerSessionId);
  if (lines.length === 0) return [];
  return claudeTranscriptEvents(lines, input.since);
}

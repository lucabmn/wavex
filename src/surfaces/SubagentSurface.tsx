import { Bot } from "../chrome/icons";
import { formatAgentType } from "../lib/harness/preview";
import { findBlockDeep, type Block, type Session } from "../lib/session";
import type { FilePaneTab } from "../lib/workspace/layout";
import { AgentTranscript } from "./AgentTranscript";
import { formatElapsed, subagentStatus } from "./transcriptActivity";

/**
 * The full transcript of one subagent run: the brief it was given, then every
 * step, rendered exactly like the parent session. Opened from a subagent card
 * in the transcript; the tab follows the parent Agent call.
 */
export function SubagentSurface({
  file,
  sessions,
  onOpenFile,
  onOpenDiff,
  visible = true,
}: {
  file: FilePaneTab;
  sessions: Session[];
  onOpenFile: (path: string) => void;
  onOpenDiff?: (path: string) => void;
  visible?: boolean;
}) {
  const source = file.subagent;
  const session = source ? sessions.find((entry) => entry.id === source.sessionId) : undefined;
  const parent = session && source ? findBlockDeep(session.blocks, source.blockId) : undefined;
  const meta = parent?.subagent;

  if (!session || !parent || !meta) {
    return (
      <div className="grid h-full place-items-center p-6 text-center">
        <p className="text-[13.5px] text-muted">This subagent is no longer in the session.</p>
      </div>
    );
  }

  const status = subagentStatus(parent, session.busy) ?? "stopped";
  const running = status === "running";
  const elapsed =
    meta.finishedAt != null ? formatElapsed(Math.max(0, meta.finishedAt - meta.startedAt)) : null;
  const headerLine = [
    meta.agentType ? formatAgentType(meta.agentType) : null,
    meta.model?.trim() || null,
    elapsed,
    `${meta.blocks.length} ${meta.blocks.length === 1 ? "step" : "steps"}`,
    meta.background ? "background" : null,
    status === "running"
      ? "Running"
      : status === "completed"
        ? "Done"
        : status === "failed"
          ? "Failed"
          : "Stopped",
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      <div className="flex min-w-0 shrink-0 items-center gap-2 border-b border-edge px-4 py-2.5">
        <Bot className="size-4 shrink-0 text-faint" strokeWidth={1.75} />
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="truncate font-sans text-sm text-content">
            {source?.title.trim() || parent.tool?.title || "Subagent"}
          </div>
          {headerLine ? (
            <div className="truncate font-sans text-xs text-faint">{headerLine}</div>
          ) : null}
        </div>
        {running ? (
          <span className="relative flex size-2 shrink-0" aria-label="Subagent running">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-60" />
            <span className="relative inline-flex size-2 rounded-full bg-accent" />
          </span>
        ) : null}
      </div>
      <div className="min-h-0 flex-1">
        <AgentTranscript
          blocks={subagentTranscript(parent)}
          busy={running}
          cwd={session.cwd}
          harness={session.harness}
          onOpenFile={onOpenFile}
          onOpenDiff={onOpenDiff}
          visible={visible}
        />
      </div>
    </div>
  );
}

/**
 * What the pane reads: the brief as the opening user turn, then the nested
 * steps. When the subagent left no steps, its result summary stands in as the
 * answer so the pane is never empty.
 */
export function subagentTranscript(parent: Block): Block[] {
  const meta = parent.subagent;
  if (!meta) return [];
  const prompt = meta.prompt?.trim();
  const out: Block[] = [
    ...(prompt ? [{ id: `${parent.id}:prompt`, role: "user" as const, text: prompt }] : []),
    ...meta.blocks,
  ];
  if (out.length === 0 || (out.length === 1 && prompt)) {
    const report = parent.tool?.detail?.trim() || parent.text.trim();
    if (report && report !== prompt) {
      out.push({ id: `${parent.id}:report`, role: "assistant", text: report });
    }
  }
  return out;
}

import type { HostId } from "../host";
import type { Attachment, RuntimeMode, ToolPreview } from "../session";
import type { UserQuestion } from "../userQuestion";

export type HarnessEvent =
  | { type: "session.started" }
  | { type: "session.ended"; code?: number | null }
  | { type: "session.error"; message: string }
  | { type: "session.providerBound"; providerSessionId: string }
  | { type: "status"; text: string }
  | { type: "message.delta"; text: string }
  | { type: "message.completed" }
  | { type: "reasoning.delta"; text: string }
  | { type: "reasoning.completed" }
  | {
      type: "tool.started";
      callId: string;
      title: string;
      kind?: string;
      status?: string;
      preview?: ToolPreview;
    }
  | {
      type: "tool.updated";
      callId: string;
      title?: string;
      kind?: string;
      status?: string;
      detail?: string;
      preview?: ToolPreview;
    }
  | {
      type: "approval.requested";
      requestId: number;
      title: string;
      kind?: string;
      callId?: string;
      preview?: ToolPreview;
    }
  | {
      type: "approval.resolved";
      requestId: number;
      /** "cancelled" = a PermissionRequest hook decided before the user could. */
      decision: "allow" | "deny" | "cancelled";
    }
  | {
      type: "question.asked";
      requestId: number;
      title?: string;
      questions: UserQuestion[];
      callId?: string;
    }
  | {
      type: "question.resolved";
      requestId: number;
      decision: "answered" | "skipped" | "cancelled";
    }
  | { type: "plan"; text: string }
  /** Metadata about the subagent behind an Agent tool call. */
  | {
      type: "subagent.updated";
      callId: string;
      agentType?: string;
      prompt?: string;
      model?: string;
      background?: boolean;
    }
  /** An event for the subagent behind an Agent tool call, in parent terms. */
  | {
      type: "subagent.event";
      callId: string;
      event: HarnessEvent;
    }
  /**
   * An image the turn produced. Adapters that can write the bytes to disk
   * should send `path`; `data` alone renders for this session but is not kept
   * in the stored transcript, which holds text and file references.
   */
  | {
      type: "image";
      mimeType: string;
      name?: string;
      data?: string;
      path?: string;
    }
  /** Context-window level after the harness's latest request. */
  | { type: "context"; used?: number; window?: number };

export type ApprovalDecision = "allow" | "deny";

export type SendTurnInput = {
  sessionId: string;
  /**
   * The machine that runs the agent. Passed rather than read off `cwd`: a
   * session working in a worktree sends that worktree's bare child path, which
   * names no host at all.
   */
  hostId?: HostId;
  cwd: string;
  model: string;
  modelSettings?: Record<string, string>;
  runtimeMode: RuntimeMode;
  text: string;
  attachments?: Attachment[];
  onEvent: (event: HarnessEvent) => void;
};

export type SteerTurnInput = {
  sessionId: string;
  hostId?: HostId;
  cwd: string;
  model: string;
  modelSettings?: Record<string, string>;
  text: string;
  attachments?: Attachment[];
};

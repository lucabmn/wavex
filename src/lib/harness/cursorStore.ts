import { getDefaultHostId, invokeOn } from "../transport";
import { type HostId } from "../host";

export type StoredCursorToolCall = {
  toolCallId: string;
  toolName: string;
  args: unknown;
};

export function readStoredCursorToolCalls(
  sessionId: string,
  toolCallIds: string[],
  hostId: HostId = getDefaultHostId(),
): Promise<StoredCursorToolCall[]> {
  return invokeOn<StoredCursorToolCall[]>(hostId, "cursor_tool_calls", {
    sessionId,
    toolCallIds,
  });
}

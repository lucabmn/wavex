import { describe, expect, it } from "vitest";
import { claudeTranscriptEvents } from "@/lib/harness/claudeTranscript";

function line(record: unknown): string {
  return JSON.stringify(record);
}

function assistant(at: string, content: unknown[]): string {
  return line({
    type: "assistant",
    timestamp: at,
    message: { role: "assistant", content },
  });
}

const TURN_START = Date.parse("2026-09-03T15:00:00.000Z");

describe("claudeTranscriptEvents", () => {
  it("rebuilds the answer a detached turn produced", () => {
    const events = claudeTranscriptEvents(
      [
        assistant("2026-09-03T15:00:01.000Z", [{ type: "text", text: "Once upon " }]),
        assistant("2026-09-03T15:00:02.000Z", [{ type: "text", text: "a time." }]),
      ],
      TURN_START,
    );
    expect(events).toEqual([{ type: "message.delta", text: "Once upon a time." }]);
  });

  it("leaves out everything the earlier turns already recorded", () => {
    const events = claudeTranscriptEvents(
      [
        assistant("2026-09-03T14:59:00.000Z", [{ type: "text", text: "old answer" }]),
        assistant("2026-09-03T15:00:01.000Z", [{ type: "text", text: "new answer" }]),
      ],
      TURN_START,
    );
    expect(events).toEqual([{ type: "message.delta", text: "new answer" }]);
  });

  it("pairs a tool call with the result that lands in a later record", () => {
    const events = claudeTranscriptEvents(
      [
        assistant("2026-09-03T15:00:01.000Z", [
          { type: "tool_use", id: "t1", name: "Read", input: { file_path: "/tmp/a.ts" } },
        ]),
        line({
          type: "user",
          timestamp: "2026-09-03T15:00:02.000Z",
          message: {
            role: "user",
            content: [{ type: "tool_result", tool_use_id: "t1", content: "ok" }],
          },
        }),
      ],
      TURN_START,
    );
    expect(events.map((event) => event.type)).toEqual(["tool.started", "tool.updated"]);
    expect(events[1]).toMatchObject({ callId: "t1", status: "completed" });
  });

  it("ignores a result for a call it never opened", () => {
    const events = claudeTranscriptEvents(
      [
        line({
          type: "user",
          timestamp: "2026-09-03T15:00:02.000Z",
          message: {
            role: "user",
            content: [{ type: "tool_result", tool_use_id: "gone", content: "ok" }],
          },
        }),
      ],
      TURN_START,
    );
    expect(events).toEqual([]);
  });

  it("skips a subagent's own messages in either spelling", () => {
    // The stored record says `isSidechain`; the live stream says
    // `parent_tool_use_id`. Both mean the parent tool owns the message.
    for (const mark of [{ isSidechain: true }, { parent_tool_use_id: "t1" }]) {
      const events = claudeTranscriptEvents(
        [
          line({
            type: "assistant",
            timestamp: "2026-09-03T15:00:01.000Z",
            ...mark,
            message: { role: "assistant", content: [{ type: "text", text: "inner" }] },
          }),
        ],
        TURN_START,
      );
      expect(events).toEqual([]);
    }
  });

  it("survives a malformed line rather than losing the turn around it", () => {
    const events = claudeTranscriptEvents(
      ["not json", assistant("2026-09-03T15:00:01.000Z", [{ type: "text", text: "kept" }])],
      TURN_START,
    );
    expect(events).toEqual([{ type: "message.delta", text: "kept" }]);
  });
});

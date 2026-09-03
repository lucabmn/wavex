import { describe, expect, it } from "vitest";
import {
  diffReviewCommand,
  hunkTargets,
  isTypingTarget,
  moveCursor,
  stepIndex,
} from "@/lib/diffReview";
import { UNIFIED_HUNK_PX, UNIFIED_LINE_PX, type DiffViewRow } from "@/lib/unifiedDiffWindow";

function key(init: Partial<KeyboardEvent> & { key: string }): KeyboardEvent {
  return {
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    isComposing: false,
    defaultPrevented: false,
    target: null,
    ...init,
  } as KeyboardEvent;
}

function line(kind: "hunk" | "add" | "context", pos?: number): DiffViewRow {
  return {
    type: "line",
    line: { kind, text: "", oldNumber: null, newNumber: null, ...(pos != null ? { pos } : {}) },
    stage: false,
    height: kind === "hunk" ? UNIFIED_HUNK_PX : UNIFIED_LINE_PX,
  };
}

describe("diffReviewCommand", () => {
  it("maps the bare review keys", () => {
    expect(diffReviewCommand(key({ key: "j" }))).toBe("next-hunk");
    expect(diffReviewCommand(key({ key: "k" }))).toBe("prev-hunk");
    expect(diffReviewCommand(key({ key: "n" }))).toBe("next-file");
    expect(diffReviewCommand(key({ key: "p" }))).toBe("prev-file");
    expect(diffReviewCommand(key({ key: "s" }))).toBe("stage");
    expect(diffReviewCommand(key({ key: "S" }))).toBe("stage-file");
    expect(diffReviewCommand(key({ key: "u" }))).toBe("unstage");
    expect(diffReviewCommand(key({ key: "d" }))).toBe("discard");
  });

  it("leaves modified and unknown keys alone", () => {
    expect(diffReviewCommand(key({ key: "j", metaKey: true }))).toBeNull();
    expect(diffReviewCommand(key({ key: "d", ctrlKey: true }))).toBeNull();
    expect(diffReviewCommand(key({ key: "s", altKey: true }))).toBeNull();
    expect(diffReviewCommand(key({ key: "x" }))).toBeNull();
  });

  it("never fires while a picker or editor already took the key", () => {
    expect(diffReviewCommand(key({ key: "j", isComposing: true }))).toBeNull();
    expect(diffReviewCommand(key({ key: "j", defaultPrevented: true }))).toBeNull();
  });
});

describe("isTypingTarget", () => {
  it("is false without an element", () => {
    expect(isTypingTarget(null)).toBe(false);
  });
});

describe("hunkTargets", () => {
  it("reports each hunk header with its offset in the body", () => {
    const rows = [line("hunk", 3), line("add"), line("context"), line("hunk", 9), line("add")];
    expect(hunkTargets(rows)).toEqual([
      { rowIndex: 0, offset: 0, pos: 3 },
      { rowIndex: 3, offset: UNIFIED_HUNK_PX + UNIFIED_LINE_PX * 2, pos: 9 },
    ]);
  });

  it("omits a position the diff could not stage", () => {
    expect(hunkTargets([line("hunk")])).toEqual([{ rowIndex: 0, offset: 0 }]);
  });
});

describe("stepIndex", () => {
  it("clamps instead of wrapping", () => {
    expect(stepIndex(3, 0, -1)).toBe(0);
    expect(stepIndex(3, 2, 1)).toBe(2);
    expect(stepIndex(3, 1, 1)).toBe(2);
    expect(stepIndex(0, 0, 1)).toBe(0);
  });
});

describe("moveCursor", () => {
  it("walks hunks across file boundaries", () => {
    const counts = [2, 0, 1];
    expect(moveCursor({ fileIndex: 0, hunkIndex: 0 }, counts, "next-hunk")).toEqual({
      fileIndex: 0,
      hunkIndex: 1,
    });
    expect(moveCursor({ fileIndex: 0, hunkIndex: 1 }, counts, "next-hunk")).toEqual({
      fileIndex: 2,
      hunkIndex: 0,
    });
    expect(moveCursor({ fileIndex: 2, hunkIndex: 0 }, counts, "next-hunk")).toEqual({
      fileIndex: 2,
      hunkIndex: 0,
    });
  });

  it("walks back into the last hunk of an earlier file", () => {
    expect(moveCursor({ fileIndex: 2, hunkIndex: 0 }, [2, 0, 1], "prev-hunk")).toEqual({
      fileIndex: 0,
      hunkIndex: 1,
    });
  });

  it("moves whole files and lands on their first hunk", () => {
    expect(moveCursor({ fileIndex: 0, hunkIndex: 1 }, [2, 3], "next-file")).toEqual({
      fileIndex: 1,
      hunkIndex: 0,
    });
    expect(moveCursor({ fileIndex: 0, hunkIndex: 1 }, [2, 3], "prev-file")).toEqual({
      fileIndex: 0,
      hunkIndex: 0,
    });
  });

  it("survives an empty file list", () => {
    expect(moveCursor({ fileIndex: 4, hunkIndex: 2 }, [], "next-hunk")).toEqual({
      fileIndex: 0,
      hunkIndex: 0,
    });
  });
});

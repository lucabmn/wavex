import { describe, expect, it } from "vitest";
import type { Session } from "@/lib/session";
import { newSession } from "@/lib/session";
import {
  buildRacePrompt,
  canRace,
  newRaceGroup,
  raceOfSession,
  raceRunnerElapsed,
  raceRunnerStatus,
  raceSessions,
  removeRaceSessions,
  validateRaceRunners,
} from "@/lib/race";

const installed = (id: string) => id === "claude" || id === "codex";

describe("validateRaceRunners", () => {
  it("needs at least two runners", () => {
    expect(
      validateRaceRunners([{ harness: "claude", model: "claude:sonnet-5" }], {
        installed,
        probed: true,
      }),
    ).toMatch(/at least 2/);
  });

  it("holds at most three runners", () => {
    const runners = ["claude", "codex", "cursor", "grok"].map((harness) => ({
      harness: harness as "claude",
      model: "m",
    }));
    expect(validateRaceRunners(runners, { installed, probed: false })).toMatch(/at most 3/);
  });

  it("rejects the same provider twice", () => {
    expect(
      validateRaceRunners(
        [
          { harness: "claude", model: "a" },
          { harness: "claude", model: "b" },
        ],
        { installed, probed: false },
      ),
    ).toMatch(/own provider/);
  });

  it("rejects missing models and uninstalled providers", () => {
    expect(
      validateRaceRunners(
        [
          { harness: "claude", model: "" },
          { harness: "codex", model: "b" },
        ],
        { installed, probed: false },
      ),
    ).toMatch(/model/);
    expect(
      validateRaceRunners(
        [
          { harness: "claude", model: "a" },
          { harness: "pi", model: "b" },
        ],
        { installed, probed: true },
      ),
    ).toMatch(/not installed/);
  });

  it("accepts two distinct installed providers", () => {
    expect(
      validateRaceRunners(
        [
          { harness: "claude", model: "a" },
          { harness: "codex", model: "b" },
        ],
        { installed, probed: true },
      ),
    ).toBeNull();
  });
});

describe("canRace", () => {
  it("degrades to an empty state with a single CLI", () => {
    const gated = canRace(1, true);
    expect(gated.ok).toBe(false);
    expect(gated.emptyState).toMatch(/needs 2/);
  });

  it("passes before the first probe and with two CLIs", () => {
    expect(canRace(0, false).ok).toBe(true);
    expect(canRace(2, true)).toEqual({ ok: true, emptyState: null });
  });
});

describe("buildRacePrompt", () => {
  it("sends the same prompt with shared-copy context", () => {
    const prompt = buildRacePrompt("  Fix the bug\n", 2);
    expect(prompt).toContain("Fix the bug");
    expect(prompt).toContain("shared working copy");
  });
});

describe("raceRunnerStatus", () => {
  it("walks working, waiting, done, and idle", () => {
    expect(raceRunnerStatus(undefined)).toBe("idle");
    const working = { ...newSession("claude", "/tmp/a"), busy: true };
    expect(raceRunnerStatus(working)).toBe("working");
    const waiting: Session = {
      ...newSession("claude", "/tmp/a"),
      blocks: [{ id: "q", role: "approval", text: "", approval: { requestId: 1 } }],
    };
    expect(raceRunnerStatus(waiting)).toBe("waiting");
    const done: Session = {
      ...newSession("claude", "/tmp/a"),
      blocks: [
        { id: "u", role: "user", text: "go" },
        { id: "a", role: "assistant", text: "did it" },
      ],
    };
    expect(raceRunnerStatus(done)).toBe("done");
    expect(raceRunnerStatus(newSession("codex", "/tmp/a"))).toBe("idle");
  });
});

describe("raceRunnerElapsed", () => {
  it("prefers finished durations over the live clock", () => {
    const done: Session = {
      ...newSession("claude", "/tmp/a"),
      blocks: [{ id: "u", role: "user", text: "go", startedAt: 1000, durationMs: 4200 }],
    };
    expect(raceRunnerElapsed(done, 9999)).toBe(4200);
    const live: Session = {
      ...newSession("claude", "/tmp/a"),
      blocks: [{ id: "u", role: "user", text: "go", startedAt: 1000 }],
    };
    expect(raceRunnerElapsed(live, 2500)).toBe(1500);
  });
});

describe("race grouping", () => {
  it("maps runners back to sessions and finds a race by session", () => {
    const a = newSession("claude", "/tmp/a");
    const b = newSession("codex", "/tmp/a");
    const race = newRaceGroup({
      sourceId: "source",
      cwd: "/tmp/a",
      prompt: "go",
      runners: [
        { harness: "claude", model: a.model },
        { harness: "codex", model: b.model },
      ],
      runnerIds: [a.id, b.id],
    });
    expect(raceSessions(race, [a, b])).toEqual([a, b]);
    expect(raceOfSession([race], b.id)?.id).toBe(race.id);
    expect(raceOfSession([race], "nope")).toBeUndefined();
  });

  it("drops closed sessions and empty races", () => {
    const race = newRaceGroup({
      sourceId: "source",
      cwd: "/tmp/a",
      prompt: "go",
      runners: [{ harness: "claude", model: "a" }],
      runnerIds: ["one", "two"],
    });
    expect(removeRaceSessions([race], new Set(["one"]))).toEqual([
      expect.objectContaining({ runnerIds: ["two"] }),
    ]);
    expect(removeRaceSessions([race], new Set(["one", "two"]))).toEqual([]);
  });
});

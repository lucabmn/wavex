import { describe, expect, it } from "vitest";
import { INTERRUPT_MESSAGE } from "@/lib/inFlight";
import { newSession, type HarnessId, type Session } from "@/lib/session";
import {
  newRaceGroup,
  raceOfSession,
  raceProgressLabels,
  raceRunnerElapsed,
  raceRunnersError,
  raceRunnerStatus,
  raceSessionTitle,
  raceSessions,
  raceTargets,
  removeRaceSessions,
} from "@/lib/race/race";

const targetOptions = (installed: HarnessId[], probed: boolean) => ({
  installed: (id: HarnessId) => installed.includes(id),
  visible: () => true,
  live: (id: HarnessId) => id !== "fx",
  probed,
});

describe("raceTargets", () => {
  it("keeps every installed agent, the session's own included", () => {
    const targets = raceTargets(targetOptions(["claude", "codex"], true));
    expect(targets).toContain("claude");
    expect(targets).toContain("codex");
  });

  it("drops uninstalled providers once the probe has run, and nothing before", () => {
    expect(raceTargets(targetOptions(["claude"], true))).toEqual(["claude"]);
    expect(raceTargets(targetOptions(["claude"], false)).length).toBeGreaterThan(1);
  });

  it("never offers a harness that is not live", () => {
    expect(raceTargets(targetOptions(["claude", "fx"], true))).not.toContain("fx");
  });

  it("respects the model picker's hidden providers", () => {
    const targets = raceTargets({
      ...targetOptions(["claude", "codex"], true),
      visible: (id) => id !== "codex",
    });
    expect(targets).toEqual(["claude"]);
  });
});

describe("raceRunnersError", () => {
  it("needs at least two runners", () => {
    expect(raceRunnersError([{ harness: "claude", model: "a" }])).toMatch(/2 or more/);
  });

  it("holds at most three runners", () => {
    const runners = ["claude", "codex", "cursor", "grok"].map((harness, index) => ({
      harness: harness as HarnessId,
      model: `m${index}`,
    }));
    expect(raceRunnersError(runners)).toMatch(/at most 3/);
  });

  it("rejects a runner with no model", () => {
    expect(
      raceRunnersError([
        { harness: "claude", model: "" },
        { harness: "codex", model: "b" },
      ]),
    ).toMatch(/model/);
  });

  it("rejects the same agent twice, whatever the models", () => {
    expect(
      raceRunnersError([
        { harness: "claude", model: "a" },
        { harness: "claude", model: "b" },
      ]),
    ).toMatch(/its own agent/);
  });

  it("accepts two distinct agents", () => {
    expect(
      raceRunnersError([
        { harness: "claude", model: "a" },
        { harness: "codex", model: "b" },
      ]),
    ).toBeNull();
  });
});

describe("raceSessionTitle", () => {
  it("takes the first line and elides a long one", () => {
    expect(raceSessionTitle("  Fix the bug\nand tidy up  ")).toBe("Race · Fix the bug");
    expect(raceSessionTitle("x".repeat(80))).toBe(`Race · ${"x".repeat(47)}…`);
    expect(raceSessionTitle("   ")).toBe("Race · prompt");
  });
});

describe("raceRunnerStatus", () => {
  it("reads the shared in-flight vocabulary rather than transcript text", () => {
    expect(raceRunnerStatus(undefined)).toBe("idle");

    const working: Session = { ...newSession("claude", "/tmp/a"), busy: true };
    expect(raceRunnerStatus(working)).toBe("working");

    const waiting: Session = {
      ...newSession("claude", "/tmp/a"),
      blocks: [{ id: "q", role: "approval", text: "", approval: { requestId: 1 } }],
    };
    expect(raceRunnerStatus(waiting)).toBe("waiting");

    const stopped: Session = {
      ...newSession("claude", "/tmp/a"),
      blocks: [
        { id: "u", role: "user", text: "go" },
        { id: "s", role: "system", text: INTERRUPT_MESSAGE },
      ],
    };
    expect(raceRunnerStatus(stopped)).toBe("stopped");

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

  it("does not call an assistant answer about an error a failed runner", () => {
    const talkingAboutErrors: Session = {
      ...newSession("claude", "/tmp/a"),
      blocks: [
        { id: "u", role: "user", text: "go" },
        { id: "s", role: "system", text: "Could not connect to the error tracker." },
      ],
    };
    expect(raceRunnerStatus(talkingAboutErrors)).toBe("done");
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
  const group = (runnerIds: string[]) =>
    newRaceGroup({
      sourceId: "source",
      cwd: "/tmp/a",
      prompt: "go",
      runners: runnerIds.map(() => ({ harness: "claude" as HarnessId, model: "a" })),
      runnerIds,
    });

  it("maps runners back to sessions and finds a race by session", () => {
    const a = newSession("claude", "/tmp/a");
    const b = newSession("codex", "/tmp/a");
    const race = group([a.id, b.id]);
    expect(raceSessions(race, [a, b])).toEqual([a, b]);
    expect(raceOfSession([race], b.id)?.id).toBe(race.id);
    expect(raceOfSession([race], "source")?.id).toBe(race.id);
    expect(raceOfSession([race], "nope")).toBeUndefined();
  });

  it("drops closed sessions and empty races", () => {
    const race = group(["one", "two"]);
    expect(removeRaceSessions([race], new Set(["one"]))).toEqual([
      expect.objectContaining({ runnerIds: ["two"] }),
    ]);
    expect(removeRaceSessions([race], new Set(["one", "two"]))).toEqual([]);
    expect(removeRaceSessions([race], new Set(["other"]))).toEqual([race]);
  });
});

describe("raceProgressLabels", () => {
  it("labels the runners and leaves the source free to race again", () => {
    const a = { ...newSession("claude", "/tmp/a"), id: "a", busy: true };
    const b: Session = {
      ...newSession("codex", "/tmp/a"),
      id: "b",
      blocks: [
        { id: "u", role: "user", text: "go" },
        { id: "r", role: "assistant", text: "done" },
      ],
    };
    const race = newRaceGroup({
      sourceId: "source",
      cwd: "/tmp/a",
      prompt: "go",
      runners: [
        { harness: "claude", model: "a" },
        { harness: "codex", model: "b" },
      ],
      runnerIds: ["a", "b"],
    });
    const labels = raceProgressLabels([race], [a, b]);
    expect(labels).toEqual({ a: "1/2 done", b: "1/2 done" });
  });

  it("counts a stopped runner as finished so the label can reach the total", () => {
    const stopped: Session = {
      ...newSession("claude", "/tmp/a"),
      id: "a",
      blocks: [
        { id: "u", role: "user", text: "go" },
        { id: "s", role: "system", text: INTERRUPT_MESSAGE },
      ],
    };
    const race = newRaceGroup({
      sourceId: "source",
      cwd: "/tmp/a",
      prompt: "go",
      runners: [{ harness: "claude", model: "a" }],
      runnerIds: ["a"],
    });
    expect(raceProgressLabels([race], [stopped]).a).toBe("1/1 done");
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Automation, AutomationRun } from "@/lib/automations/automation";

const host = vi.hoisted(() => ({
  automations: [] as Automation[],
  runs: [] as AutomationRun[],
  allPaused: false,
  claims: [] as { automationId: string; dueAt: number; manual: boolean }[],
  /** Set to false to make the next claim look like another window won it. */
  claimSucceeds: true,
  finished: [] as { runId: string; status: string }[],
  state: [] as { id: string; enabled: boolean; nextDueAt: number | null; pausedReason: string }[],
  reconciled: 0,
  heartbeats: [] as string[][],
}));

vi.mock("@/lib/automations/automationsHost", () => ({
  listAutomations: async () => host.automations,
  listAutomationRuns: async () => host.runs,
  readAllAutomationsPaused: async () => host.allPaused,
  reconcileAutomationRuns: async () => {
    host.reconciled += 1;
    return 0;
  },
  heartbeatAutomationRuns: async (runIds: string[]) => {
    host.heartbeats.push(runIds);
  },
  saveAutomation: async (input: Automation) => input,
  removeAutomation: async () => undefined,
  setAllAutomationsPaused: async (paused: boolean) => {
    host.allPaused = paused;
    return paused;
  },
  setAutomationState: async (input: {
    id: string;
    enabled: boolean;
    nextDueAt: number | null;
    pausedReason: string;
  }) => {
    host.state.push(input);
    host.automations = host.automations.map((entry) =>
      entry.id === input.id
        ? {
            ...entry,
            enabled: input.enabled,
            nextDueAt: input.nextDueAt,
            pausedReason: input.pausedReason as Automation["pausedReason"],
          }
        : entry,
    );
    return host.automations.find((entry) => entry.id === input.id) ?? null;
  },
  startAutomationRun: async (input: {
    automationId: string;
    runId: string;
    dueAt: number;
    manual: boolean;
  }) => {
    host.claims.push({
      automationId: input.automationId,
      dueAt: input.dueAt,
      manual: input.manual,
    });
    if (!host.claimSucceeds) return null;
    return {
      id: input.runId,
      automationId: input.automationId,
      sessionId: null,
      dueAt: input.dueAt,
      startedAt: input.dueAt,
      finishedAt: null,
      status: "running",
    } satisfies AutomationRun;
  },
  attachRunSession: async () => undefined,
  finishAutomationRun: async (input: { runId: string; status: string }) => {
    host.finished.push({ runId: input.runId, status: input.status });
    return null;
  },
}));

const runner = vi.hoisted(() => ({
  result: { status: "success" } as { status: string; error?: string; summary?: string },
  /** Set to hold the run open, so a stop can land while it is in flight. */
  hold: false,
  release: null as null | (() => void),
}));

vi.mock("@/lib/automations/runner", () => ({
  executeAutomationRun: async (
    _automation: unknown,
    hooks: { onSession?: (session: { id: string }) => void },
  ) => {
    hooks.onSession?.({ id: "session-1" });
    if (runner.hold) await new Promise<void>((resolve) => (runner.release = resolve));
    return runner.result;
  },
}));

vi.mock("@/lib/harness", () => ({ cancelHarnessTurn: async () => undefined }));

vi.mock("@/lib/sounds", () => ({ playCue: () => undefined }));

const {
  getAutomationsState,
  loadAutomations,
  pauseAllAutomations,
  resetAutomationStore,
  runAutomationNow,
  stopAutomationRun,
  updateAutomation,
  tickAutomations,
} = await import("@/lib/automations/automationStore");

const NOW = Date.UTC(2025, 0, 1, 12, 0);

/**
 * The tick starts a run without awaiting it — a turn can take an hour, and the
 * rest of the schedule still has to be looked at — so a test that cares about
 * the outcome waits for the run rather than for the tick.
 */
function settled(count = 1) {
  return vi.waitFor(() => expect(host.finished).toHaveLength(count));
}

function automation(overrides: Partial<Automation> = {}): Automation {
  return {
    id: "a1",
    name: "Nightly triage",
    prompt: "Triage new issues",
    projectRef: "/repo",
    cwd: "/repo",
    hostId: "local",
    harness: "claude",
    model: "",
    runtimeMode: "supervised",
    schedule: { kind: "interval", every: 4, unit: "hours", anchorMs: Date.UTC(2025, 0, 1, 0, 0) },
    timeZone: "UTC",
    dstPolicy: "shift",
    overlapPolicy: "skip",
    missedPolicy: "once",
    notify: false,
    enabled: true,
    nextDueAt: null,
    runCount: 0,
    pausedReason: "",
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

/** The settings half of a record, as the editor hands it back. */
function toDraft(source: Automation) {
  const {
    id: _id,
    nextDueAt: _next,
    lastRunAt: _last,
    runCount: _count,
    pausedReason: _reason,
    createdAt: _created,
    updatedAt: _updated,
    ...settings
  } = source;
  return settings;
}

beforeEach(() => {
  resetAutomationStore();
  host.automations = [];
  host.runs = [];
  host.allPaused = false;
  host.claims = [];
  host.claimSucceeds = true;
  host.finished = [];
  host.state = [];
  host.reconciled = 0;
  host.heartbeats = [];
  runner.result = { status: "success" };
  runner.hold = false;
  runner.release = null;
});

describe("tickAutomations", () => {
  it("books a first occurrence without running anything", async () => {
    host.automations = [automation()];
    await tickAutomations(NOW);
    expect(host.claims).toEqual([]);
    expect(host.state).toEqual([
      { id: "a1", enabled: true, nextDueAt: Date.UTC(2025, 0, 1, 16, 0), pausedReason: "" },
    ]);
  });

  it("runs a due occurrence and books the next one", async () => {
    host.automations = [automation({ nextDueAt: Date.UTC(2025, 0, 1, 12, 0) })];
    await tickAutomations(NOW + 1_000);
    await settled();
    expect(host.claims).toEqual([
      { automationId: "a1", dueAt: Date.UTC(2025, 0, 1, 12, 0), manual: false },
    ]);
    expect(host.finished).toEqual([{ runId: expect.any(String), status: "success" }]);
    expect(host.state[0].nextDueAt).toBe(Date.UTC(2025, 0, 1, 16, 0));
  });

  it("leaves a disabled automation alone", async () => {
    host.automations = [automation({ enabled: false, nextDueAt: NOW - 1 })];
    await tickAutomations(NOW);
    expect(host.claims).toEqual([]);
    expect(host.state).toEqual([]);
  });

  it("stops everything while the global pause is on", async () => {
    host.allPaused = true;
    host.automations = [automation({ nextDueAt: NOW - 1 })];
    await tickAutomations(NOW);
    expect(host.claims).toEqual([]);
    expect(getAutomationsState().allPaused).toBe(true);
  });

  it("does nothing further when another window has already claimed the occurrence", async () => {
    host.claimSucceeds = false;
    host.automations = [automation({ nextDueAt: NOW - 1 })];
    await tickAutomations(NOW);
    expect(host.claims).toHaveLength(1);
    expect(host.finished).toEqual([]);
  });

  it("parks an automation that has reached its run limit", async () => {
    host.automations = [automation({ runCount: 5, maxRuns: 5, nextDueAt: NOW - 1 })];
    await tickAutomations(NOW);
    expect(host.claims).toEqual([]);
    expect(host.state).toEqual([
      { id: "a1", enabled: false, nextDueAt: null, pausedReason: "max-runs" },
    ]);
  });

  it("parks an automation that has passed its final date", async () => {
    host.automations = [automation({ endAtMs: NOW - 1, nextDueAt: NOW - 1 })];
    await tickAutomations(NOW);
    expect(host.state[0].pausedReason).toBe("end-date");
  });

  it("parks an automation after repeated failures and says why", async () => {
    runner.result = { status: "failed" };
    host.runs = [1, 2, 3].map((n) => ({
      id: `r${n}`,
      automationId: "a1",
      sessionId: null,
      dueAt: n,
      startedAt: n,
      finishedAt: n,
      status: "failed" as const,
    }));
    host.automations = [automation({ nextDueAt: NOW - 1 })];
    await tickAutomations(NOW);
    await settled();
    expect(host.finished).toEqual([{ runId: expect.any(String), status: "failed" }]);
    await vi.waitFor(() => expect(host.state.at(-1)?.pausedReason).toBe("failures"));
    expect(host.state.at(-1)).toEqual({
      id: "a1",
      enabled: false,
      nextDueAt: null,
      pausedReason: "failures",
    });
  });

  it("does not park an automation whose runs stopped for an approval", async () => {
    runner.result = { status: "needs-attention" };
    host.runs = [1, 2, 3].map((n) => ({
      id: `r${n}`,
      automationId: "a1",
      sessionId: null,
      dueAt: n,
      startedAt: n,
      finishedAt: n,
      status: "needs-attention" as const,
    }));
    host.automations = [automation({ nextDueAt: NOW - 1 })];
    await tickAutomations(NOW);
    await settled();
    expect(host.state.every((entry) => entry.enabled)).toBe(true);
  });
});

describe("runAutomationNow", () => {
  it("claims the occurrence as a manual one", async () => {
    host.automations = [automation({ enabled: false })];
    await loadAutomations(true);
    await runAutomationNow("a1");
    expect(host.claims[0].manual).toBe(true);
    expect(host.finished).toEqual([{ runId: expect.any(String), status: "success" }]);
  });

  it("ignores an id that is not there", async () => {
    await loadAutomations(true);
    await runAutomationNow("gone");
    expect(host.claims).toEqual([]);
  });
});

describe("the run lease", () => {
  it("renews the runs this window drives and settles the ones nobody does", async () => {
    runner.hold = true;
    host.automations = [automation({ nextDueAt: NOW - 1 })];
    const tick = tickAutomations(NOW);
    await vi.waitFor(() => expect(runner.release).not.toBeNull());
    // A tick with a run in flight names it, so another window does not settle
    // a run that is still going.
    host.heartbeats = [];
    await tickAutomations(NOW);
    expect(host.heartbeats.at(-1)).toEqual([expect.any(String)]);
    runner.release?.();
    await tick;
    await settled();
    // Once it is over the lease is dropped, so a stalled row is another
    // window's to reclaim.
    host.heartbeats = [];
    await tickAutomations(NOW);
    expect(host.heartbeats.at(-1)).toEqual([]);
  });

  it("settles abandoned runs on every tick, not only at startup", async () => {
    host.automations = [automation({ enabled: false })];
    await tickAutomations(NOW);
    await tickAutomations(NOW);
    expect(host.reconciled).toBe(2);
  });
});

describe("updateAutomation", () => {
  it("keeps why a parked automation is parked when the edit leaves it off", async () => {
    host.automations = [automation({ enabled: false, pausedReason: "failures", nextDueAt: null })];
    await loadAutomations(true);
    const saved = await updateAutomation(
      "a1",
      { ...toDraft(host.automations[0]), enabled: false },
      NOW,
    );
    expect(saved.pausedReason).toBe("failures");
  });

  it("clears the reason when the edit turns it back on", async () => {
    host.automations = [automation({ enabled: false, pausedReason: "failures", nextDueAt: null })];
    await loadAutomations(true);
    const saved = await updateAutomation(
      "a1",
      { ...toDraft(host.automations[0]), enabled: true },
      NOW,
    );
    expect(saved.pausedReason).toBe("");
    expect(saved.nextDueAt).toBe(Date.UTC(2025, 0, 1, 16, 0));
  });
});

describe("pauseAllAutomations", () => {
  it("flips the global stop and keeps each automation's own flag", async () => {
    host.automations = [automation({ nextDueAt: NOW - 1 })];
    await loadAutomations(true);
    await pauseAllAutomations(true);
    await tickAutomations(NOW);
    expect(host.claims).toEqual([]);
    expect(getAutomationsState().automations[0].enabled).toBe(true);

    await pauseAllAutomations(false);
    await tickAutomations(NOW);
    expect(host.claims).toHaveLength(1);
  });
});

describe("stopAutomationRun", () => {
  it("settles a stopped run as cancelled rather than as a failure", async () => {
    runner.hold = true;
    host.automations = [automation({ nextDueAt: NOW - 1 })];
    const tick = tickAutomations(NOW);
    // Held open, which is what a turn still in flight looks like.
    await vi.waitFor(() => expect(runner.release).not.toBeNull());
    await stopAutomationRun("a1");
    runner.release?.();
    await tick;
    await settled();
    expect(host.finished).toEqual([{ runId: expect.any(String), status: "cancelled" }]);
  });
});

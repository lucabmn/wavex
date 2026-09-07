import { afterEach, describe, expect, it } from "vitest";
import { newRaceGroup } from "@/lib/race/race";
import {
  closeRaceView,
  getRaceViewSnapshot,
  getRacesSnapshot,
  pruneRaces,
  resetRaces,
  startRaceGroup,
  subscribeRaces,
  viewRaceOfSession,
} from "@/lib/race/raceStore";
import { newSession, type Session } from "@/lib/session";

const race = (sourceId: string, runnerIds: string[]) =>
  newRaceGroup({
    sourceId,
    cwd: "/tmp/a",
    prompt: "go",
    runners: runnerIds.map(() => ({ harness: "claude" as const, model: "a" })),
    runnerIds,
  });

const sessionsWith = (ids: string[]): Session[] =>
  ids.map((id) => ({ ...newSession("claude", "/tmp/a"), id }));

afterEach(() => resetRaces());

describe("raceStore", () => {
  it("starts empty and keeps one snapshot identity while nothing changes", () => {
    expect(getRacesSnapshot()).toEqual([]);
    expect(getRacesSnapshot()).toBe(getRacesSnapshot());
    expect(getRaceViewSnapshot()).toBeNull();
  });

  it("opens the compare view on the race it just started", () => {
    const started = race("source", ["a", "b"]);
    startRaceGroup(started);
    expect(getRacesSnapshot()).toEqual([started]);
    expect(getRaceViewSnapshot()).toBe(started.id);
  });

  it("reopens a race from any session it touches, source included", () => {
    const started = race("source", ["a", "b"]);
    startRaceGroup(started);
    closeRaceView();
    expect(getRaceViewSnapshot()).toBeNull();
    viewRaceOfSession("b");
    expect(getRaceViewSnapshot()).toBe(started.id);
    closeRaceView();
    viewRaceOfSession("source");
    expect(getRaceViewSnapshot()).toBe(started.id);
    closeRaceView();
    viewRaceOfSession("unrelated");
    expect(getRaceViewSnapshot()).toBeNull();
  });

  it("forgets closed runners and the races left with none", () => {
    const started = race("source", ["a", "b"]);
    startRaceGroup(started);
    pruneRaces(sessionsWith(["a"]));
    expect(getRacesSnapshot()).toEqual([expect.objectContaining({ runnerIds: ["a"] })]);
    expect(getRaceViewSnapshot()).toBe(started.id);
    pruneRaces([]);
    expect(getRacesSnapshot()).toEqual([]);
    expect(getRaceViewSnapshot()).toBeNull();
  });

  it("notifies subscribers only when something moved", () => {
    let notified = 0;
    const unsubscribe = subscribeRaces(() => {
      notified += 1;
    });
    pruneRaces([]);
    expect(notified).toBe(0);

    const started = race("source", ["a"]);
    startRaceGroup(started);
    expect(notified).toBe(1);

    pruneRaces(sessionsWith(["a"]));
    expect(notified).toBe(1);

    viewRaceOfSession("a");
    expect(notified).toBe(1);

    closeRaceView();
    expect(notified).toBe(2);
    closeRaceView();
    expect(notified).toBe(2);

    unsubscribe();
    startRaceGroup(race("other", ["z"]));
    expect(notified).toBe(2);
  });
});

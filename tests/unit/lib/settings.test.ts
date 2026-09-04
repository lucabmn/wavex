import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  COMPOSER_RUNNER_DEFAULT,
  DIFF_VIEWER_DEFAULT,
  FOLLOW_UP_BEHAVIOR_DEFAULT,
  LIVE_AGENTS_ENABLED_DEFAULT,
  loadComposerRunner,
  loadDiffViewer,
  loadFollowUpBehavior,
  loadLiveAgentsEnabled,
  loadNotesEnabled,
  NOTES_ENABLED_DEFAULT,
  saveComposerRunner,
  saveDiffViewer,
  saveFollowUpBehavior,
  saveLiveAgentsEnabled,
  saveNotesEnabled,
} from "@/lib/settings";

const KEY = "wavex.composerRunner";
const NOTES_KEY = "wavex.notesEnabled";
const LIVE_AGENTS_KEY = "wavex.liveAgentsEnabled";
const DIFF_VIEWER_KEY = "wavex.diffViewer";
const FOLLOW_UP_BEHAVIOR_KEY = "wavex.followUpBehavior";

function mockLocalStorage() {
  const data = new Map<string, string>();
  const storage = {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
    removeItem: (key: string) => {
      data.delete(key);
    },
    clear: () => {
      data.clear();
    },
    key: (index: number) => [...data.keys()][index] ?? null,
    get length() {
      return data.size;
    },
  };
  Object.defineProperty(globalThis, "localStorage", {
    value: storage,
    configurable: true,
  });
}

describe("composer runner setting", () => {
  beforeEach(mockLocalStorage);
  afterEach(() => {
    localStorage.removeItem(KEY);
  });

  it("defaults to on", () => {
    expect(COMPOSER_RUNNER_DEFAULT).toBe(true);
    expect(loadComposerRunner()).toBe(true);
  });

  it("persists an off switch", () => {
    saveComposerRunner(false);
    expect(localStorage.getItem(KEY)).toBe("0");
    expect(loadComposerRunner()).toBe(false);
    saveComposerRunner(true);
    expect(loadComposerRunner()).toBe(true);
  });
});

describe("notes enabled setting", () => {
  beforeEach(mockLocalStorage);
  afterEach(() => {
    localStorage.removeItem(NOTES_KEY);
  });

  it("defaults to on", () => {
    expect(NOTES_ENABLED_DEFAULT).toBe(true);
    expect(loadNotesEnabled()).toBe(true);
  });

  it("persists an off switch", () => {
    saveNotesEnabled(false);
    expect(localStorage.getItem(NOTES_KEY)).toBe("0");
    expect(loadNotesEnabled()).toBe(false);
    saveNotesEnabled(true);
    expect(loadNotesEnabled()).toBe(true);
  });
});

describe("live agents enabled setting", () => {
  beforeEach(mockLocalStorage);
  afterEach(() => {
    localStorage.removeItem(LIVE_AGENTS_KEY);
  });

  it("defaults to on", () => {
    expect(LIVE_AGENTS_ENABLED_DEFAULT).toBe(true);
    expect(loadLiveAgentsEnabled()).toBe(true);
  });

  it("persists an off switch", () => {
    saveLiveAgentsEnabled(false);
    expect(localStorage.getItem(LIVE_AGENTS_KEY)).toBe("0");
    expect(loadLiveAgentsEnabled()).toBe(false);
    saveLiveAgentsEnabled(true);
    expect(loadLiveAgentsEnabled()).toBe(true);
  });
});

describe("diff viewer setting", () => {
  beforeEach(mockLocalStorage);
  afterEach(() => {
    localStorage.removeItem(DIFF_VIEWER_KEY);
  });

  it("defaults to the editor layout", () => {
    expect(DIFF_VIEWER_DEFAULT).toBe("editor");
    expect(loadDiffViewer()).toBe("editor");
  });

  it("persists the unified layout", () => {
    saveDiffViewer("unified");
    expect(localStorage.getItem(DIFF_VIEWER_KEY)).toBe("unified");
    expect(loadDiffViewer()).toBe("unified");
    saveDiffViewer("editor");
    expect(loadDiffViewer()).toBe("editor");
  });

  it("ignores unknown stored values", () => {
    localStorage.setItem(DIFF_VIEWER_KEY, "split");
    expect(loadDiffViewer()).toBe("editor");
  });
});

describe("follow-up behavior setting", () => {
  beforeEach(mockLocalStorage);
  afterEach(() => {
    localStorage.removeItem(FOLLOW_UP_BEHAVIOR_KEY);
  });

  it("defaults to queue", () => {
    expect(FOLLOW_UP_BEHAVIOR_DEFAULT).toBe("queue");
    expect(loadFollowUpBehavior()).toBe("queue");
  });

  it("persists steer behavior", () => {
    saveFollowUpBehavior("steer");
    expect(loadFollowUpBehavior()).toBe("steer");
  });

  it("ignores unknown stored values", () => {
    localStorage.setItem(FOLLOW_UP_BEHAVIOR_KEY, "interrupt");
    expect(loadFollowUpBehavior()).toBe("queue");
  });
});

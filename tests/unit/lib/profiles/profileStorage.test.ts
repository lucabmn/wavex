import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  activeProfileId,
  clearProfileStorage,
  DEFAULT_PROFILE_ID,
  isProfileId,
  profileKey,
  profileStorage,
  setActiveProfileId,
} from "@/lib/profiles/profileStorage";

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
  return data;
}

let data: Map<string, string>;

beforeEach(() => {
  data = mockLocalStorage();
});

afterEach(() => {
  Reflect.deleteProperty(globalThis, "localStorage");
});

describe("profileKey", () => {
  it("leaves the default profile on the keys an older install already wrote", () => {
    expect(profileKey("wavex.recentProjects", DEFAULT_PROFILE_ID)).toBe("wavex.recentProjects");
  });

  it("namespaces every other profile", () => {
    expect(profileKey("wavex.recentProjects", "work")).toBe("@work:wavex.recentProjects");
  });
});

describe("activeProfileId", () => {
  it("falls back to the default profile when nothing is stored", () => {
    expect(activeProfileId()).toBe(DEFAULT_PROFILE_ID);
  });

  it("ignores an id that could escape its directory", () => {
    data.set("wavex.activeProfile", "../escape");
    expect(activeProfileId()).toBe(DEFAULT_PROFILE_ID);
  });

  it("reads back what was written", () => {
    setActiveProfileId("work");
    expect(activeProfileId()).toBe("work");
  });
});

describe("profileStorage", () => {
  it("keeps two profiles' values apart under one key", () => {
    profileStorage.setItem("wavex.recentProjects", "default value");
    setActiveProfileId("work");
    expect(profileStorage.getItem("wavex.recentProjects")).toBeNull();
    profileStorage.setItem("wavex.recentProjects", "work value");
    setActiveProfileId(DEFAULT_PROFILE_ID);
    expect(profileStorage.getItem("wavex.recentProjects")).toBe("default value");
  });
});

describe("clearProfileStorage", () => {
  it("drops only the deleted profile's keys", () => {
    profileStorage.setItem("wavex.recentProjects", "default value");
    setActiveProfileId("work");
    profileStorage.setItem("wavex.recentProjects", "work value");
    profileStorage.setItem("wavex.sounds", "1");

    clearProfileStorage("work");

    setActiveProfileId(DEFAULT_PROFILE_ID);
    expect(profileStorage.getItem("wavex.recentProjects")).toBe("default value");
    expect([...data.keys()].some((key) => key.startsWith("@work:"))).toBe(false);
  });

  it("never clears the default profile, which shares the install's own keys", () => {
    profileStorage.setItem("wavex.recentProjects", "default value");
    clearProfileStorage(DEFAULT_PROFILE_ID);
    expect(profileStorage.getItem("wavex.recentProjects")).toBe("default value");
  });
});

describe("isProfileId", () => {
  it("accepts generated ids and rejects path characters", () => {
    expect(isProfileId("pm5x1-2")).toBe(true);
    expect(isProfileId("../x")).toBe(false);
    expect(isProfileId("a/b")).toBe(false);
    expect(isProfileId("")).toBe(false);
  });
});

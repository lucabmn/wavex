import { describe, expect, it } from "vitest";
import {
  addProfile,
  canDeleteProfile,
  DEFAULT_PROFILE_ID,
  defaultProfile,
  newProfileId,
  nextProfileColor,
  normalizeProfileName,
  normalizeProfiles,
  PROFILE_COLORS,
  profileInitial,
  recolorProfile,
  removeProfile,
  renameProfile,
  resolveProfile,
  uniqueProfileName,
  type Profile,
} from "@/lib/profiles/profile";

function profile(id: string, name: string, color = 0): Profile {
  return { id, name, color, createdAt: 1 };
}

describe("normalizeProfiles", () => {
  it("always yields the default profile first, even from nothing", () => {
    expect(normalizeProfiles(null)).toEqual([defaultProfile()]);
  });

  it("keeps the stored default rather than replacing it", () => {
    const stored = [profile(DEFAULT_PROFILE_ID, "Work", 3)];
    expect(normalizeProfiles(stored)[0]).toEqual(stored[0]);
  });

  it("drops entries that could not address a directory", () => {
    const stored = [
      { id: "../escape", name: "Escape", color: 0, createdAt: 0 },
      { id: "ok", name: "Fine", color: 0, createdAt: 0 },
      { id: "ok", name: "Duplicate", color: 0, createdAt: 0 },
      { id: "blank", name: "   ", color: 0, createdAt: 0 },
    ];
    expect(normalizeProfiles(stored).map((item) => item.id)).toEqual([DEFAULT_PROFILE_ID, "ok"]);
  });

  it("clamps a color that no longer exists in the palette", () => {
    const stored = [profile("x", "X", PROFILE_COLORS.length + 2)];
    const [, restored] = normalizeProfiles(stored);
    expect(restored.color).toBeLessThan(PROFILE_COLORS.length);
  });
});

describe("resolveProfile", () => {
  it("falls back to the default when the active profile is gone", () => {
    const profiles = normalizeProfiles([profile("work", "Work")]);
    expect(resolveProfile(profiles, "deleted").id).toBe(DEFAULT_PROFILE_ID);
  });
});

describe("addProfile", () => {
  it("gives every profile a distinct id, name, and color", () => {
    const first = addProfile([defaultProfile()], "Work", { now: 1 });
    const second = addProfile(first, "Work", { now: 1 });
    expect(second[1].id).not.toBe(second[2].id);
    expect(second[2].name).toBe("Work 2");
    expect(second[1].color).not.toBe(second[2].color);
  });

  it("takes the color the dialog chose", () => {
    expect(addProfile([defaultProfile()], "Work", { color: 4, now: 1 })[1].color).toBe(4);
  });
});

describe("newProfileId", () => {
  it("never reuses an id, even at the same millisecond", () => {
    const taken = [profile("p1", "One")];
    const id = newProfileId(taken, 1);
    expect(taken.some((item) => item.id === id)).toBe(false);
  });
});

describe("renameProfile", () => {
  it("keeps names unique but leaves an unchanged name alone", () => {
    const profiles = [profile("a", "Work"), profile("b", "Personal")];
    expect(renameProfile(profiles, "b", "Work")[1].name).toBe("Work 2");
    expect(renameProfile(profiles, "b", "Personal")[1].name).toBe("Personal");
  });

  it("ignores a name that is only whitespace", () => {
    const profiles = [profile("a", "Work")];
    expect(renameProfile(profiles, "a", "   ")[0].name).toBe("Work");
  });
});

describe("recolorProfile", () => {
  it("wraps a color index into the palette", () => {
    const profiles = [profile("a", "Work")];
    expect(recolorProfile(profiles, "a", PROFILE_COLORS.length).at(0)?.color).toBe(0);
  });
});

describe("removeProfile", () => {
  it("refuses to delete the default profile, which owns the install's own data", () => {
    const profiles = normalizeProfiles([profile("work", "Work")]);
    expect(canDeleteProfile(DEFAULT_PROFILE_ID)).toBe(false);
    expect(removeProfile(profiles, DEFAULT_PROFILE_ID)).toEqual(profiles);
    expect(removeProfile(profiles, "work").map((item) => item.id)).toEqual([DEFAULT_PROFILE_ID]);
  });
});

describe("names and colors", () => {
  it("collapses whitespace and caps the length", () => {
    expect(normalizeProfileName("  Work    Laptop  ")).toBe("Work Laptop");
    expect(normalizeProfileName("x".repeat(80))).toHaveLength(32);
  });

  it("reads the avatar letter off the name", () => {
    expect(profileInitial("work")).toBe("W");
    expect(profileInitial("  ")).toBe("?");
  });

  it("picks the least-used color for a new profile", () => {
    const profiles = [profile("a", "A", 0), profile("b", "B", 0), profile("c", "C", 1)];
    expect(nextProfileColor(profiles)).toBe(2);
  });

  it("keeps a suffixed name inside the length cap", () => {
    const long = "x".repeat(32);
    const profiles = [profile("a", long)];
    expect(uniqueProfileName(profiles, long)).toHaveLength(32);
  });
});

import { describe, expect, it } from "vitest";
import { defaultOpenWithApp, groupOpenWithApps, type OpenWithApp } from "@/lib/project/openWith";

const app = (id: string, kind: OpenWithApp["kind"]): OpenWithApp => ({
  id,
  name: id,
  kind,
  icon: null,
});

describe("groupOpenWithApps", () => {
  it("puts the file manager first and keeps the host's order inside a section", () => {
    const groups = groupOpenWithApps([
      app("files", "files"),
      app("vscode", "editor"),
      app("zed", "editor"),
      app("ghostty", "terminal"),
    ]);

    expect(groups.map((group) => group.kind)).toEqual(["files", "editor", "terminal"]);
    expect(groups[1]?.apps.map((entry) => entry.id)).toEqual(["vscode", "zed"]);
  });

  it("drops a section nothing was found for", () => {
    const groups = groupOpenWithApps([app("files", "files"), app("cursor", "editor")]);

    expect(groups.map((group) => group.label)).toEqual(["Files", "Editors"]);
  });

  it("answers with nothing when the host found nothing", () => {
    expect(groupOpenWithApps([])).toEqual([]);
  });
});

describe("defaultOpenWithApp", () => {
  it("takes VS Code over anything else installed", () => {
    const apps = [app("files", "files"), app("zed", "editor"), app("vscode", "editor")];

    expect(defaultOpenWithApp(apps)?.id).toBe("vscode");
  });

  it("falls through the preferred editors in order", () => {
    const apps = [app("files", "files"), app("zed", "editor"), app("cursor", "editor")];

    expect(defaultOpenWithApp(apps)?.id).toBe("cursor");
  });

  it("takes any editor before the file manager", () => {
    const apps = [app("files", "files"), app("xcode", "editor")];

    expect(defaultOpenWithApp(apps)?.id).toBe("xcode");
  });

  it("lands on the file manager when no editor is installed", () => {
    const apps = [app("files", "files"), app("ghostty", "terminal")];

    expect(defaultOpenWithApp(apps)?.id).toBe("files");
  });

  it("has no default when the host found nothing", () => {
    expect(defaultOpenWithApp([])).toBeNull();
  });
});

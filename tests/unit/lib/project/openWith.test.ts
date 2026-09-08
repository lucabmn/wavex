import { describe, expect, it } from "vitest";
import { groupOpenWithApps, type OpenWithApp } from "@/lib/project/openWith";

const app = (id: string, kind: OpenWithApp["kind"]): OpenWithApp => ({ id, name: id, kind });

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

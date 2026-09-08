import { describe, expect, it } from "vitest";
import { leaf, newTab, newTerminalFile } from "@/lib/workspace/layout";
import {
  addTerminalToDock,
  applyDockGridStyle,
  clampDockSize,
  clampDocksToViewport,
  closeTerminalInDock,
  createProjectDock,
  dockGridStyle,
  findProjectDock,
  mapProjectDock,
  nextDockTerminalTitle,
  patchProjectDocks,
  dockTerminalFileIds,
  selectDockTerminal,
  splitProjectDocksForMove,
  withDockOpen,
  withDockSide,
  withDockSurface,
} from "@/lib/workspace/projectDock";
import { EMPTY_BROWSER_HISTORY } from "@/lib/workspace/browserHistory";
import type { Session } from "@/lib/session";

function chat(id: string, cwd: string): Session {
  return {
    id,
    cwd,
    harness: "cursor",
    title: "",
    blocks: [],
    busy: false,
    model: "",
    modelSettings: {},
    runtimeMode: "supervised",
  };
}

describe("createProjectDock", () => {
  it("opens a bottom dock with the first terminal focused", () => {
    const file = newTerminalFile("/tmp/a");
    const dock = createProjectDock("/tmp/a/", { file });
    expect(dock.projectPath).toBe("/tmp/a");
    expect(dock.side).toBe("bottom");
    expect(dock.open).toBe(true);
    expect(dock.pane.files).toEqual([file]);
    expect(dock.pane.activeFileId).toBe(file.id);
  });
});

describe("addTerminalToDock", () => {
  it("appends a tab, focuses it, and reveals a hidden dock", () => {
    const first = newTerminalFile("/tmp/a", "a");
    const second = newTerminalFile("/tmp/a", "a 2");
    const dock = withDockOpen(createProjectDock("/tmp/a", { file: first }), false);
    const next = addTerminalToDock(dock, second);
    expect(next.open).toBe(true);
    expect(next.pane.files.map((file) => file.id)).toEqual([first.id, second.id]);
    expect(next.pane.activeFileId).toBe(second.id);
    expect(nextDockTerminalTitle(next, "/tmp/a")).toBe("a 3");
  });
});

describe("closeTerminalInDock", () => {
  it("puts the dock away when the last terminal closes", () => {
    const file = newTerminalFile("/tmp/a");
    const dock = createProjectDock("/tmp/a", { file });
    const next = closeTerminalInDock(dock, file.id);
    expect(next.pane.files).toEqual([]);
    expect(next.open).toBe(false);
  });

  it("keeps a dock whose browser is the surface showing", () => {
    const file = newTerminalFile("/tmp/a");
    const dock = withDockSurface(createProjectDock("/tmp/a", { file }), "browser");
    const next = closeTerminalInDock(dock, file.id);
    expect(next.pane.files).toEqual([]);
    expect(next.open).toBe(true);
  });

  it("focuses a neighbor after closing one of several terminals", () => {
    const first = newTerminalFile("/tmp/a", "one");
    const second = newTerminalFile("/tmp/a", "two");
    const dock = addTerminalToDock(createProjectDock("/tmp/a", { file: first }), second);
    const next = closeTerminalInDock(dock, second.id);
    expect(next?.pane.files.map((file) => file.id)).toEqual([first.id]);
    expect(next?.pane.activeFileId).toBe(first.id);
  });
});

describe("dock surfaces", () => {
  it("opens on the browser when nothing asked for a terminal", () => {
    const dock = createProjectDock("/tmp/a", { surface: "browser" });
    expect(dock.surface).toBe("browser");
    expect(dock.side).toBe("right");
    expect(dock.pane.files).toEqual([]);
    expect(dock.browser).toEqual(EMPTY_BROWSER_HISTORY);
  });

  it("keeps a terminal at the bottom, where it has always been", () => {
    const dock = createProjectDock("/tmp/a", { file: newTerminalFile("/tmp/a") });
    expect(dock.surface).toBe("terminal");
    expect(dock.side).toBe("bottom");
  });

  it("shows the terminals a new one was just added to", () => {
    const dock = withDockSurface(createProjectDock("/tmp/a", { surface: "files" }), "files");
    const next = addTerminalToDock(dock, newTerminalFile("/tmp/a"));
    expect(next.surface).toBe("terminal");
    expect(next.open).toBe(true);
  });

  it("leaves the side where the user put it when the surface changes", () => {
    const dock = createProjectDock("/tmp/a", { file: newTerminalFile("/tmp/a") });
    expect(withDockSurface(dock, "browser").side).toBe("bottom");
    expect(withDockSurface(dock, "terminal")).toBe(dock);
  });
});

describe("mapProjectDock", () => {
  it("updates only the matching project", () => {
    const alpha = createProjectDock("/tmp/a", { file: newTerminalFile("/tmp/a") });
    const beta = createProjectDock("/tmp/b", { file: newTerminalFile("/tmp/b") });
    const docks = [alpha, beta];
    expect(findProjectDock(docks, "/tmp/a/")?.pane.id).toBe(alpha.pane.id);

    const hidden = mapProjectDock(docks, "/tmp/a", (dock) => withDockOpen(dock, false));
    expect(hidden[0]?.open).toBe(false);
    expect(hidden[1]?.open).toBe(true);

    expect(mapProjectDock(docks, "/tmp/nowhere", (dock) => withDockOpen(dock, false))).toBe(docks);
  });
});

describe("patchProjectDocks", () => {
  it("renames a terminal by id without touching other docks", () => {
    const file = newTerminalFile("/tmp/a", "zsh");
    const other = newTerminalFile("/tmp/b", "other");
    const docks = [
      createProjectDock("/tmp/a", { file }),
      createProjectDock("/tmp/b", { file: other }),
    ];
    const next = patchProjectDocks(docks, file.id, {
      title: "npm",
      cwd: "/tmp/a/app",
    });
    expect(next[0]?.pane.files[0]).toMatchObject({
      path: "npm",
      cwd: "/tmp/a/app",
    });
    expect(next[1]?.pane.files[0]?.path).toBe("other");
    expect(selectDockTerminal(next[0]!, other.id)).toBe(next[0]);
  });

  it("records a foreground process without renaming other docks", () => {
    const file = newTerminalFile("/tmp/a", "zsh");
    const docks = [createProjectDock("/tmp/a", { file })];
    const next = patchProjectDocks(docks, file.id, {
      title: "vite",
      foreground: "vite",
    });
    expect(next[0]?.pane.files[0]).toMatchObject({
      path: "vite",
      foreground: "vite",
    });
    expect(
      patchProjectDocks(next, file.id, { foreground: null })[0]?.pane.files[0]?.foreground,
    ).toBeUndefined();
  });
});

describe("clampDockSize", () => {
  it("clamps to the axis min and 70% of the viewport", () => {
    expect(clampDockSize("bottom", 10, { width: 1000, height: 400 })).toBe(88);
    expect(clampDockSize("left", 900, { width: 1000, height: 400 })).toBe(700);
  });
});

describe("withDockSide", () => {
  it("keeps size when the axis stays the same", () => {
    const dock = { ...createProjectDock("/tmp/a", { file: newTerminalFile("/tmp/a") }), size: 200 };
    expect(withDockSide(dock, "top").size).toBe(200);
    expect(withDockSide(dock, "top").side).toBe("top");
  });
});

describe("clampDocksToViewport", () => {
  it("gives size back only from the docks a smaller window no longer fits", () => {
    const wide = { ...createProjectDock("/tmp/a", { surface: "browser" as const }), size: 600 };
    const narrow = { ...createProjectDock("/tmp/b", { surface: "browser" as const }), size: 200 };
    const next = clampDocksToViewport([wide, narrow], { width: 800, height: 600 });
    expect(next[0]?.size).toBe(560);
    expect(next[1]).toBe(narrow);
  });

  it("leaves the docks alone when they all still fit", () => {
    const docks = [createProjectDock("/tmp/a", { surface: "browser" as const })];
    expect(clampDocksToViewport(docks, { width: 1600, height: 1000 })).toBe(docks);
  });
});

describe("dockGridStyle", () => {
  it("collapses to a single main area when hidden", () => {
    expect(dockGridStyle(null, 220).gridTemplateAreas).toBe('"main"');
  });

  it("places the dock on the requested edge", () => {
    expect(dockGridStyle("bottom", 220).gridTemplateAreas).toBe('"main" "dock"');
    expect(dockGridStyle("top", 220).gridTemplateAreas).toBe('"dock" "main"');
    expect(dockGridStyle("left", 360).gridTemplateAreas).toBe('"dock main"');
    expect(dockGridStyle("right", 360).gridTemplateAreas).toBe('"main dock"');
  });

  it("writes the same template onto an element", () => {
    const el = { style: {} } as unknown as HTMLElement;
    applyDockGridStyle(el, "left", 300);
    expect(el.style.gridTemplateAreas).toBe('"dock main"');
    expect(el.style.gridTemplateColumns).toBe("300px minmax(0, 1fr)");
  });
});

describe("dockTerminalFileIds", () => {
  it("lists every terminal in every dock", () => {
    const a = newTerminalFile("/tmp/a");
    const b = newTerminalFile("/tmp/b");
    expect(
      dockTerminalFileIds([
        createProjectDock("/tmp/a", { file: a }),
        createProjectDock("/tmp/b", { file: b }),
      ]),
    ).toEqual([a.id, b.id]);
  });
});

describe("splitProjectDocksForMove", () => {
  it("moves a dock only when every tab of that project is leaving", () => {
    const a1 = newTab("s1");
    const a2 = newTab("s2");
    const b1 = { ...newTab("s3"), layout: leaf("s3") };
    const sessions = [chat("s1", "/tmp/a"), chat("s2", "/tmp/a"), chat("s3", "/tmp/b")];
    const docks = [
      createProjectDock("/tmp/a", { file: newTerminalFile("/tmp/a") }),
      createProjectDock("/tmp/b", { file: newTerminalFile("/tmp/b") }),
    ];

    const partial = splitProjectDocksForMove(docks, [a1], [a2, b1], sessions);
    expect(partial.moving).toEqual([]);
    expect(partial.remaining.map((dock) => dock.projectPath)).toEqual(["/tmp/a", "/tmp/b"]);

    const allA = splitProjectDocksForMove(docks, [a1, a2], [b1], sessions);
    expect(allA.moving.map((dock) => dock.projectPath)).toEqual(["/tmp/a"]);
    expect(allA.remaining.map((dock) => dock.projectPath)).toEqual(["/tmp/b"]);
  });
});

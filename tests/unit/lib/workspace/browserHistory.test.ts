import { describe, expect, it } from "vitest";
import {
  EMPTY_BROWSER_HISTORY,
  browserBack,
  browserForward,
  browserVisit,
  canGoBack,
  canGoForward,
  browserHistoryUrl,
  normalizeBrowserUrl,
  sanitizeBrowserHistory,
} from "@/lib/workspace/browserHistory";

describe("normalizeBrowserUrl", () => {
  it("keeps an explicit http(s) origin", () => {
    expect(normalizeBrowserUrl("https://example.com/a?b=1")).toBe("https://example.com/a?b=1");
    expect(normalizeBrowserUrl("  http://example.com  ")).toBe("http://example.com/");
  });

  it("sends loopback names to http, not https", () => {
    expect(normalizeBrowserUrl("localhost:5173")).toBe("http://localhost:5173/");
    expect(normalizeBrowserUrl("127.0.0.1:8080/app")).toBe("http://127.0.0.1:8080/app");
    expect(normalizeBrowserUrl("[::1]:3000")).toBe("http://[::1]:3000/");
    expect(normalizeBrowserUrl("localhost")).toBe("http://localhost/");
  });

  it("reads a bare port as the local dev server it almost always is", () => {
    expect(normalizeBrowserUrl("3000")).toBe("http://localhost:3000/");
    expect(normalizeBrowserUrl(":5173")).toBe("http://localhost:5173/");
    expect(normalizeBrowserUrl("0")).toBeNull();
    expect(normalizeBrowserUrl("99999")).toBeNull();
  });

  it("defaults a bare host to https", () => {
    expect(normalizeBrowserUrl("example.com")).toBe("https://example.com/");
    expect(normalizeBrowserUrl("example.com/docs")).toBe("https://example.com/docs");
  });

  it("refuses what a frame cannot load", () => {
    expect(normalizeBrowserUrl("")).toBeNull();
    expect(normalizeBrowserUrl("   ")).toBeNull();
    expect(normalizeBrowserUrl("file:///etc/passwd")).toBeNull();
    expect(normalizeBrowserUrl("javascript:alert(1)")).toBeNull();
    expect(normalizeBrowserUrl("data:text/html,<b>x</b>")).toBeNull();
    expect(normalizeBrowserUrl("not a url")).toBeNull();
    expect(normalizeBrowserUrl("hello")).toBeNull();
  });
});

describe("dock browser history", () => {
  it("starts empty", () => {
    expect(browserHistoryUrl(EMPTY_BROWSER_HISTORY)).toBeNull();
    expect(canGoBack(EMPTY_BROWSER_HISTORY)).toBe(false);
    expect(canGoForward(EMPTY_BROWSER_HISTORY)).toBe(false);
  });

  it("pushes visits and walks back and forward", () => {
    let state = browserVisit(EMPTY_BROWSER_HISTORY, "example.com");
    state = browserVisit(state, "localhost:3000");
    expect(browserHistoryUrl(state)).toBe("http://localhost:3000/");
    expect(canGoBack(state)).toBe(true);
    expect(canGoForward(state)).toBe(false);

    state = browserBack(state);
    expect(browserHistoryUrl(state)).toBe("https://example.com/");
    expect(canGoForward(state)).toBe(true);

    state = browserForward(state);
    expect(browserHistoryUrl(state)).toBe("http://localhost:3000/");
  });

  it("drops the forward trail on a new visit", () => {
    let state = browserVisit(EMPTY_BROWSER_HISTORY, "a.com");
    state = browserVisit(state, "b.com");
    state = browserBack(state);
    state = browserVisit(state, "c.com");
    expect(state.entries).toEqual(["https://a.com/", "https://c.com/"]);
    expect(canGoForward(state)).toBe(false);
  });

  it("ignores a visit it cannot normalize and re-visiting the current page", () => {
    const first = browserVisit(EMPTY_BROWSER_HISTORY, "a.com");
    expect(browserVisit(first, "not a url")).toBe(first);
    expect(browserVisit(first, "https://a.com/")).toBe(first);
  });

  it("stays put when there is nowhere to walk to", () => {
    const state = browserVisit(EMPTY_BROWSER_HISTORY, "a.com");
    expect(browserBack(state)).toBe(state);
    expect(browserForward(state)).toBe(state);
  });

  it("caps the history so a long session cannot grow without bound", () => {
    let state = EMPTY_BROWSER_HISTORY;
    for (let index = 0; index < 120; index++) {
      state = browserVisit(state, `host${index}.com`);
    }
    expect(state.entries.length).toBe(100);
    expect(state.entries[state.entries.length - 1]).toBe("https://host119.com/");
    expect(state.index).toBe(99);
  });
});

describe("sanitizeBrowserHistory", () => {
  it("keeps a well-formed persisted browser", () => {
    expect(
      sanitizeBrowserHistory({
        entries: ["https://a.com/", "http://localhost:3000/"],
        index: 1,
      }),
    ).toEqual({
      entries: ["https://a.com/", "http://localhost:3000/"],
      index: 1,
    });
  });

  it("falls back to empty for anything else", () => {
    expect(sanitizeBrowserHistory(undefined)).toEqual(EMPTY_BROWSER_HISTORY);
    expect(sanitizeBrowserHistory({ entries: "nope" })).toEqual(EMPTY_BROWSER_HISTORY);
    expect(sanitizeBrowserHistory({ entries: ["file:///x"], index: 0 })).toEqual(
      EMPTY_BROWSER_HISTORY,
    );
  });

  it("clamps an index that no longer points at an entry", () => {
    const state = sanitizeBrowserHistory({ entries: ["https://a.com/"], index: 9 });
    expect(state.index).toBe(0);
    expect(browserHistoryUrl(state)).toBe("https://a.com/");
  });
});

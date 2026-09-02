import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MenuBarApp } from "@/surfaces/MenuBarApp";

describe("MenuBarApp", () => {
  it("renders an accessible two-tab status surface with a useful idle state", () => {
    const markup = renderToStaticMarkup(createElement(MenuBarApp));

    expect(markup).toContain('role="tablist"');
    expect(markup.match(/role="tab"/g)).toHaveLength(2);
    expect(markup).toContain('aria-selected="true"');
    expect(markup).toContain('role="tabpanel"');
    expect(markup).toContain("No agents are working");
    expect(markup).toContain("Open wavex");
  });
});

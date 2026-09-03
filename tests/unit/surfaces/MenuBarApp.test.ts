import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { LiveAgent } from "@/lib/liveAgents";
import { ApprovalCard, MenuBarApp } from "@/surfaces/MenuBarApp";

function waitingAgent(approval: LiveAgent["approval"]): LiveAgent {
  return {
    id: "s1",
    cwd: "/tmp/wavex",
    title: "Fix the sidebar",
    harness: "claude",
    activity: "Edited src/App.tsx",
    startedAt: 1_000,
    needsApproval: true,
    approval,
    done: false,
  };
}

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

describe("ApprovalCard", () => {
  it("offers both in-window answers with the session's own context", () => {
    const markup = renderToStaticMarkup(
      createElement(ApprovalCard, {
        agent: waitingAgent({
          requestId: 7,
          kind: "approval",
          label: "Edited src/App.tsx",
          answerable: true,
        }),
      }),
    );

    expect(markup).toContain("Fix the sidebar");
    expect(markup).toContain("Edited src/App.tsx");
    expect(markup).toContain('aria-label="Allow: Edited src/App.tsx"');
    expect(markup).toContain('aria-label="Deny: Edited src/App.tsx"');
    expect(markup).not.toContain("Open session to answer");
  });

  it("falls back to opening the session when the request cannot be answered here", () => {
    const markup = renderToStaticMarkup(
      createElement(ApprovalCard, {
        agent: waitingAgent({
          requestId: 4,
          kind: "question",
          label: "Which file?",
          answerable: false,
        }),
      }),
    );

    expect(markup).toContain("Which file?");
    expect(markup).toContain("Open session to answer");
    expect(markup).not.toContain('aria-label="Allow');
  });
});

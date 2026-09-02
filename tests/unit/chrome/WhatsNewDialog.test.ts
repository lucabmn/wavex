import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { WhatsNewBody } from "../../../src/chrome/WhatsNewDialog";

describe("WhatsNewBody", () => {
  it("renders the version notes without the changelog heading", () => {
    const markup = renderToStaticMarkup(createElement(WhatsNewBody, { version: "0.1.0" }));

    expect(markup).toContain("whats-new-md");
    expect(markup).toContain("What&#x27;s new in wavex 0.1.0");
    expect(markup).not.toContain("## [0.1.0]");
  });
});

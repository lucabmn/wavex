import { describe, expect, it } from "vitest";
import {
  buildImagePrompt,
  extractGeneratedSvg,
  generatedImageName,
  harnessGeneratesImages,
  sanitizeSvg,
} from "@/lib/harness/imageGeneration";

describe("harnessGeneratesImages", () => {
  it("offers generation where the harness can follow an output shape", () => {
    expect(harnessGeneratesImages("claude")).toBe(true);
    expect(harnessGeneratesImages("codex")).toBe(true);
  });

  it("withholds it from the reduced ACP harnesses", () => {
    expect(harnessGeneratesImages("fx")).toBe(false);
    expect(harnessGeneratesImages("grok")).toBe(false);
  });
});

describe("buildImagePrompt", () => {
  it("carries the request and asks for one fenced svg", () => {
    const prompt = buildImagePrompt("  a red circle  ");
    expect(prompt).toContain("a red circle");
    expect(prompt).toContain("```svg");
    expect(prompt).toContain("No <script>");
  });
});

describe("extractGeneratedSvg", () => {
  it("reads a fenced block", () => {
    const svg = extractGeneratedSvg('Here you go:\n```svg\n<svg viewBox="0 0 1 1"></svg>\n```\n');
    expect(svg).toBe('<svg viewBox="0 0 1 1"></svg>');
  });

  it("reads a bare element", () => {
    expect(extractGeneratedSvg('<svg viewBox="0 0 2 2"><rect /></svg>')).toBe(
      '<svg viewBox="0 0 2 2"><rect /></svg>',
    );
  });

  it("returns null when the reply is prose", () => {
    expect(extractGeneratedSvg("I can't draw that.")).toBeNull();
  });

  it("returns null for an unterminated element", () => {
    expect(extractGeneratedSvg('```svg\n<svg viewBox="0 0 1 1">\n```')).toBeNull();
  });
});

describe("sanitizeSvg", () => {
  /** The file is written to disk, so it has to be inert outside an <img> too. */
  it("strips scripts and event handlers", () => {
    const cleaned = sanitizeSvg(
      '<svg viewBox="0 0 1 1"><script>alert(1)</script><rect onclick="steal()" /></svg>',
    );
    expect(cleaned).not.toContain("script");
    expect(cleaned).not.toContain("onclick");
    expect(cleaned).toContain("<rect");
  });

  it("strips anything that reaches the network", () => {
    const cleaned = sanitizeSvg(
      '<svg viewBox="0 0 1 1"><image href="https://example.com/x.png" /><a xlink:href="https://evil"><rect /></a></svg>',
    );
    expect(cleaned).not.toContain("https://");
    expect(cleaned).not.toContain("<image");
  });

  it("rejects markup that is no longer an svg after stripping", () => {
    expect(sanitizeSvg("<rect />")).toBeNull();
  });
});

describe("generatedImageName", () => {
  it("slugs the request", () => {
    expect(generatedImageName("A red Circle, please!")).toBe("a-red-circle-please.svg");
  });

  it("falls back when nothing survives slugging", () => {
    expect(generatedImageName("!!!")).toBe("image.svg");
  });

  it("caps a long request", () => {
    expect(generatedImageName("word ".repeat(40)).length).toBeLessThanOrEqual(44);
  });
});

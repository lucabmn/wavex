/**
 * Image generation, within wavex's product boundary.
 *
 * There is no wavex backend and no wavex-held provider credentials, so an
 * image cannot be fetched from a hosted model. What every installed coding CLI
 * *can* do is write markup, so a generated image here is an SVG the agent
 * composes in its own turn. That keeps generation inside the harness where
 * authentication already lives, and produces a real, resolution-independent
 * image file the transcript can render and the user can save.
 *
 * Rendering is via `<img src="data:image/svg+xml;...">`. Script and external
 * references never execute in an `<img>` context, and the sanitiser below
 * strips them anyway so a saved file is inert too.
 */

import type { HarnessId } from "../session";

export const GENERATED_IMAGE_MIME = "image/svg+xml";

/**
 * Whether this harness can be asked for an image.
 *
 * fx and Grok Build run a reduced ACP surface that already rejects image
 * blocks and answers poorly to output-shape instructions; offering the control
 * there would produce a prose apology instead of a picture.
 */
export function harnessGeneratesImages(id: HarnessId): boolean {
  return id !== "fx" && id !== "grok";
}

const INSTRUCTIONS = `Produce a single SVG image and nothing else.

Rules:
- Reply with exactly one \`\`\`svg fenced code block. No prose before or after it.
- The block must contain one <svg> root element with a viewBox and explicit width and height.
- Use only shapes, paths, text, and gradients. No <script>, no <foreignObject>, no external
  references (no href to http, no <image>, no @import, no web fonts).
- Do not call tools or read files. Compose the image from the request alone.`;

export function buildImagePrompt(request: string): string {
  const trimmed = request.trim();
  return `${INSTRUCTIONS}\n\nImage to draw:\n${trimmed}`;
}

/** A filename for the saved image, derived from what was asked for. */
export function generatedImageName(request: string): string {
  const slug = request
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "");
  return `${slug || "image"}.svg`;
}

const FENCED_SVG = /```(?:svg|xml|html)?\s*\n([\s\S]*?)```/i;

/**
 * Pull the SVG out of a reply. Models fence it most of the time and sometimes
 * answer with the bare element, so both are accepted.
 */
export function extractGeneratedSvg(reply: string): string | null {
  const fenced = FENCED_SVG.exec(reply)?.[1];
  const candidate = svgElement(fenced ?? reply);
  if (!candidate) return null;
  return sanitizeSvg(candidate);
}

function svgElement(text: string): string | null {
  const start = text.search(/<svg[\s>]/i);
  if (start < 0) return null;
  const end = text.toLowerCase().lastIndexOf("</svg>");
  if (end < start) return null;
  return text.slice(start, end + "</svg>".length).trim();
}

const SCRIPTABLE_TAGS = /<\s*(script|foreignObject|iframe|object|embed|use|image)\b[\s\S]*?>/gi;
const CLOSING_SCRIPTABLE_TAGS = /<\s*\/\s*(script|foreignObject|iframe|object|embed)\s*>/gi;
const EVENT_HANDLERS = /\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi;
const REMOTE_REFS = /\s(?:xlink:href|href|src)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi;

/**
 * Remove anything that could reach the network or run code. An `<img>` already
 * refuses to run scripts, but the file is also written to disk and may be
 * opened somewhere that does not.
 */
export function sanitizeSvg(svg: string): string | null {
  const cleaned = svg
    .replace(SCRIPTABLE_TAGS, "")
    .replace(CLOSING_SCRIPTABLE_TAGS, "")
    .replace(EVENT_HANDLERS, "")
    .replace(REMOTE_REFS, "")
    .trim();
  // The stripping can leave a fragment that is no longer an image.
  return /^<svg[\s>][\s\S]*<\/svg>$/i.test(cleaned) ? cleaned : null;
}

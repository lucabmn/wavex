/**
 * Hover and signature help.
 *
 * Hover is pull-based: CodeMirror asks after the pointer has rested, so there
 * is nothing to debounce. Signature help is push-based — it follows the cursor
 * while typing arguments — so it is debounced and its in-flight request is
 * cancelled whenever the cursor moves again.
 */

import { StateEffect, StateField, type Extension } from "@codemirror/state";
import {
  EditorView,
  hoverTooltip,
  showTooltip,
  type Tooltip,
  type ViewUpdate,
} from "@codemirror/view";
import { ViewPlugin } from "@codemirror/view";
import { isCancelled } from "../lsp/connection";
import { markedText, markupText } from "../lsp/markup";
import { offsetToPosition, rangeToOffsets } from "../lsp/positions";
import type { LspHover, LspSignatureHelp } from "../lsp/types";
import type { LspSessionRef } from "./editorLspSession";

/** Long enough that moving through an argument list doesn't ask on every key. */
const SIGNATURE_DEBOUNCE_MS = 120;

export function editorLspHover(path: string, session: LspSessionRef): Extension {
  return hoverTooltip(async (view, pos) => {
    const client = session.current?.client;
    if (!client) return null;

    const answer = await client
      .hover(path, offsetToPosition(view.state.doc, pos))
      .catch((error: unknown) => {
        if (isCancelled(error)) return null;
        throw error;
      });
    const text = hoverText(answer);
    if (!text) return null;

    const range = answer?.range ? rangeToOffsets(view.state.doc, answer.range) : null;
    return {
      pos: range?.from ?? pos,
      end: range?.to,
      above: true,
      create: () => ({ dom: panel(text) }),
    };
  });
}

const setSignature = StateEffect.define<Tooltip | null>();

const signatureTooltip = StateField.define<Tooltip | null>({
  create: () => null,
  update(tooltip, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setSignature)) return effect.value;
    }
    // Any edit or cursor move invalidates the signature; the next request puts
    // one back. Clearing it here rather than from the view plugin keeps the
    // transition inside the transaction that caused it — a plugin cannot
    // dispatch from its own `update`.
    return transaction.docChanged || transaction.selection ? null : tooltip;
  },
  provide: (field) => showTooltip.from(field),
});

export function editorLspSignatureHelp(path: string, session: LspSessionRef): Extension {
  return [
    signatureTooltip,
    ViewPlugin.define((view) => new SignatureHelpPlugin(view, path, session)),
    signatureTheme,
  ];
}

class SignatureHelpPlugin {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private inFlight: AbortController | null = null;

  constructor(
    private readonly view: EditorView,
    private readonly path: string,
    private readonly session: LspSessionRef,
  ) {}

  update(update: ViewUpdate) {
    if (!update.docChanged && !update.selectionSet) return;
    // A superseded request is cancelled rather than left to arrive late and
    // paint a signature for a cursor position the user has already left.
    this.inFlight?.abort();
    this.inFlight = null;
    clearTimeout(this.timer);

    const client = this.session.current?.client;
    if (!client || !update.state.selection.main.empty) return;
    this.timer = setTimeout(() => this.request(), SIGNATURE_DEBOUNCE_MS);
  }

  destroy() {
    clearTimeout(this.timer);
    this.inFlight?.abort();
  }

  private async request() {
    const client = this.session.current?.client;
    if (!client) return;
    const controller = new AbortController();
    this.inFlight = controller;
    const pos = this.view.state.selection.main.head;

    let help: LspSignatureHelp | null = null;
    try {
      help = await client.signatureHelp(
        this.path,
        offsetToPosition(this.view.state.doc, pos),
        controller.signal,
      );
    } catch (error) {
      if (!isCancelled(error)) throw error;
      return;
    }
    if (controller.signal.aborted) return;

    const text = signatureText(help);
    // The field has already cleared the old tooltip on the transaction that
    // triggered this request, so there is nothing to take down.
    if (!text) return;
    this.view.dispatch({
      effects: setSignature.of({
        pos,
        above: true,
        create: () => ({ dom: panel(text) }),
      }),
    });
  }
}

function signatureText(help: LspSignatureHelp | null): string {
  const signatures = help?.signatures ?? [];
  if (signatures.length === 0) return "";
  const active = signatures[help?.activeSignature ?? 0] ?? signatures[0];
  const documentation = markupText(active.documentation);
  return documentation ? `${active.label}\n\n${documentation}` : active.label;
}

function hoverText(hover: LspHover | null): string {
  if (!hover) return "";
  const contents = hover.contents;
  if (Array.isArray(contents)) return contents.map(markedText).filter(Boolean).join("\n\n").trim();
  if (typeof contents === "string") return contents.trim();
  if ("kind" in contents) return contents.value.trim();
  return markedText(contents).trim();
}

/**
 * Plain text, not rendered Markdown. Server documentation is arbitrary text
 * from the project's own dependencies, and a tooltip is not worth an HTML
 * sanitiser in the one surface that shows a file the agent may just have
 * written.
 */
function panel(text: string): HTMLElement {
  const element = document.createElement("div");
  element.className = "cm-lsp-tooltip";
  element.textContent = text;
  return element;
}

const signatureTheme = EditorView.theme({
  ".cm-lsp-tooltip": {
    fontFamily: "var(--font-mono)",
    fontSize: "11.5px",
    lineHeight: "1.5",
    maxWidth: "42rem",
    maxHeight: "18rem",
    overflow: "auto",
    padding: "6px 8px",
    whiteSpace: "pre-wrap",
  },
  ".cm-lsp-info": {
    fontFamily: "var(--font-mono)",
    fontSize: "11px",
    lineHeight: "1.5",
    maxWidth: "32rem",
    whiteSpace: "pre-wrap",
  },
});

/**
 * Semantic completion from the language server.
 *
 * The server's items replace the language grammar's own suggestions wherever a
 * server is running: a half-typed name completes to a symbol that exists
 * rather than to a word that happens to be somewhere in the buffer.
 *
 * Every request is abortable. CodeMirror aborts a completion the moment the
 * next keystroke arrives, which sends `$/cancelRequest` and frees the server
 * to work on the query the user actually ended up typing.
 */

import {
  autocompletion,
  insertCompletionText,
  pickedCompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
  type CompletionSource,
} from "@codemirror/autocomplete";
import { ChangeSet, type Extension } from "@codemirror/state";
import type { LspClient } from "../lsp/client";
import { isCancelled } from "../lsp/connection";
import { markupText } from "../lsp/markup";
import { offsetToPosition, rangeToOffsets } from "../lsp/positions";
import {
  LSP_COMPLETION_KIND,
  type LspCompletionItem,
  type LspCompletionList,
  type LspTextEdit,
} from "../lsp/types";
import type { LspSessionRef } from "./editorLspSession";

/**
 * A server can answer with thousands of items — rust-analyzer offers every
 * symbol in scope. CodeMirror filters and sorts them all on the main thread on
 * every keystroke, so the list is cut before it gets there.
 */
const MAX_ITEMS = 300;

export function lspAutocomplete(path: string, session: LspSessionRef): Extension {
  return autocompletion({
    activateOnTyping: true,
    selectOnOpen: true,
    defaultKeymap: true,
    // `override` rather than an extra source: where a server answers, the
    // grammar's buffer-word suggestions are noise next to real symbols.
    override: [completionSource(path, session)],
  });
}

function completionSource(path: string, session: LspSessionRef): CompletionSource {
  return async (context: CompletionContext): Promise<CompletionResult | null> => {
    const client = session.current?.client;
    if (!client) return null;

    const trigger = triggerFor(context, client.triggerCharacters);
    if (!trigger) return null;

    const signal = abortSignalFor(context);
    let answer: LspCompletionList | LspCompletionItem[] | null;
    try {
      answer = await client.completion(
        path,
        offsetToPosition(context.state.doc, context.pos),
        trigger,
        signal,
      );
    } catch (error) {
      if (isCancelled(error)) return null;
      throw error;
    }
    if (!answer) return null;

    const list = Array.isArray(answer) ? answer : answer.items;
    const isIncomplete = Array.isArray(answer) ? false : answer.isIncomplete;
    if (list.length === 0) return null;

    const word = context.matchBefore(/[\w$]*/);
    const from = word?.from ?? context.pos;
    const options = list.slice(0, MAX_ITEMS).map((item) => toCompletion(item, client));

    return {
      from,
      options,
      // An incomplete list is the server saying "ask me again once you know
      // more"; a complete one can be filtered locally without another round trip.
      validFor: isIncomplete ? undefined : /^[\w$]*$/,
    };
  };
}

/**
 * Whether to ask at all, and what to tell the server about why.
 *
 * Trigger kinds are 1 (typing), 2 (a trigger character such as `.`), and 3 (an
 * incomplete list being refined).
 */
function triggerFor(
  context: CompletionContext,
  triggerCharacters: string[],
): { triggerKind: 1 | 2 | 3; triggerCharacter?: string } | null {
  const before = context.state.sliceDoc(Math.max(0, context.pos - 1), context.pos);
  if (triggerCharacters.includes(before)) {
    return { triggerKind: 2, triggerCharacter: before };
  }
  if (context.explicit) return { triggerKind: 1 };
  // Otherwise only inside a word: firing on every space would ask the server
  // for the whole scope on every keystroke.
  return context.matchBefore(/[\w$]+$/) ? { triggerKind: 1 } : null;
}

function toCompletion(item: LspCompletionItem, client: LspClient): Completion {
  const edit = textEditOf(item);
  return {
    label: item.label,
    detail: item.detail,
    type: item.kind ? LSP_COMPLETION_KIND[item.kind] : undefined,
    // The server has already ranked the list; boosting by prefix match alone
    // would put the wrong symbol first.
    boost: item.preselect ? 1 : 0,
    info: () => documentationFor(item, client),
    apply: (view, completion, from, to) => {
      const state = view.state;
      const insert = edit?.newText ?? item.insertText ?? item.label;
      const range = edit ? rangeToOffsets(state.doc, edit.range) : { from, to };
      const extra = item.additionalTextEdits ?? [];
      if (extra.length === 0) {
        view.dispatch(insertCompletionText(state, insert, range.from, range.to));
        return;
      }

      // Auto-imports and the like. Every range the server sent — the completion
      // itself and these — addresses the document as it is now, so they go out
      // in one transaction. Applying them afterwards would read pre-insertion
      // offsets against a document that had already moved under them.
      const changes = ChangeSet.of(
        [
          { from: range.from, to: range.to, insert },
          ...extra.map((additional) => {
            const at = rangeToOffsets(state.doc, additional.range);
            return { from: at.from, to: at.to, insert: additional.newText };
          }),
        ],
        state.doc.length,
      );
      view.dispatch({
        changes,
        // The end of the inserted text, mapped through the other edits: an
        // import added above the cursor moves every offset below it.
        selection: { anchor: changes.mapPos(range.to, 1) },
        annotations: pickedCompletion.of(completion),
        userEvent: "input.complete",
        scrollIntoView: true,
      });
    },
  };
}

/**
 * Documentation is fetched only for the item the user has highlighted.
 * Resolving the whole list up front is what makes a large completion popup
 * stutter.
 */
async function documentationFor(item: LspCompletionItem, client: LspClient): Promise<Node | null> {
  const resolved = await client.resolveCompletion(item).catch(() => item);
  const text = [resolved.detail, markupText(resolved.documentation)]
    .filter(Boolean)
    .join("\n\n")
    .trim();
  if (!text) return null;
  const element = document.createElement("div");
  element.className = "cm-lsp-info";
  element.textContent = text;
  return element;
}

function textEditOf(item: LspCompletionItem): LspTextEdit | null {
  const edit = item.textEdit;
  if (!edit) return null;
  if ("range" in edit) return edit;
  // An `InsertReplaceEdit`. wavex always replaces: completing in the middle of
  // an identifier should replace it, not leave its tail behind.
  return { range: edit.replace, newText: edit.newText };
}

/** CodeMirror's own abort signal for a superseded completion query. */
function abortSignalFor(context: CompletionContext): AbortSignal {
  const controller = new AbortController();
  context.addEventListener("abort", () => controller.abort());
  return controller.signal;
}

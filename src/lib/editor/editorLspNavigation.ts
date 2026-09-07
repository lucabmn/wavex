/**
 * Go to definition, find references, and rename, from the keyboard.
 *
 * The extension asks the server and hands the answer to the workspace; where a
 * result opens — which pane, which tab, how Go Back unwinds it — is a workspace
 * decision and is made in `App`, not here.
 */

import { EditorSelection, type Extension } from "@codemirror/state";
import { EditorView, keymap, type Command } from "@codemirror/view";
import { isCancelled } from "../lsp/connection";
import { toCodeTargets, type CodeTarget } from "../lsp/locations";
import { offsetToPosition } from "../lsp/positions";
import type { LspWorkspaceEdit } from "../lsp/types";
import type { CodeLocation } from "./codeNavigation";
import type { LspSessionRef } from "./editorLspSession";

/**
 * What the workspace does with a result.
 *
 * Where a jump lands, and what Go Back unwinds, are layout decisions — they
 * live in `App`, which owns the panes and the history.
 */
export type LspWorkspaceCommands = {
  /** Open one result. The origin is where Go Back returns to. */
  goToTarget: (target: CodeTarget, origin: CodeLocation) => void;
  /** Show a result list. An empty list is shown as such, not dropped. */
  showReferences: (symbol: string, targets: CodeTarget[]) => void;
  /**
   * Carry out a rename. Resolves to a reason when it did not happen — an
   * unsaved file in the way, an edit that no longer applies — and to `null`
   * when it did.
   */
  applyWorkspaceEdit: (symbol: string, edit: LspWorkspaceEdit) => Promise<string | null>;
};

export type LspNavigationCommands = LspWorkspaceCommands & {
  /** Ask for the new name. Resolves to `null` when the user cancels. */
  promptRename: (current: string) => Promise<string | null>;
  /** Anything the user needs to know: no definition, rename unsupported, … */
  report: (message: string) => void;
};

/**
 * The commands, read at the moment one runs.
 *
 * The extension is built once with the view; the callbacks behind it are React
 * props that change on every render. A ref is what keeps a keypress from
 * reaching the closure that was current when the file opened.
 */
export type LspCommandsRef = { readonly current: LspNavigationCommands | null };

export function editorLspNavigation(
  path: string,
  session: LspSessionRef,
  commands: LspCommandsRef,
): Extension {
  const goToDefinition = definitionCommand(path, session, commands);
  return [
    keymap.of([
      { key: "F12", run: goToDefinition, preventDefault: true },
      { key: "Mod-F12", run: goToDefinition, preventDefault: true },
      {
        key: "Shift-F12",
        run: referencesCommand(path, session, commands),
        preventDefault: true,
      },
      { key: "F2", run: renameCommand(path, session, commands), preventDefault: true },
    ]),
    EditorView.domEventHandlers({
      mousedown: (event, view) => {
        if (!(event.metaKey || event.ctrlKey) || event.button !== 0) return false;
        if (!session.current) return false;
        const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
        if (pos === null) return false;
        // The click has to move the cursor first: the request is about the
        // position under the pointer, not wherever the caret happened to be.
        view.dispatch({ selection: EditorSelection.cursor(pos) });
        goToDefinition(view);
        event.preventDefault();
        return true;
      },
    }),
  ];
}

function definitionCommand(
  path: string,
  session: LspSessionRef,
  commands: LspCommandsRef,
): Command {
  return (view) => {
    const client = session.current?.client;
    if (!client) return false;
    const origin = originOf(view, path);
    void (async () => {
      const answer = await guard(() =>
        client.definition(path, offsetToPosition(view.state.doc, view.state.selection.main.head)),
      );
      const targets = toCodeTargets(answer);
      if (targets.length === 0) {
        commands.current?.report("No definition found");
        return;
      }
      if (targets.length === 1) {
        commands.current?.goToTarget(targets[0], origin);
        return;
      }
      // Several declarations — an overload set, or a trait and its impls. A
      // list is the honest answer; picking the first would hide the others.
      commands.current?.showReferences(symbolAt(view) || "definition", targets);
    })();
    return true;
  };
}

function referencesCommand(
  path: string,
  session: LspSessionRef,
  commands: LspCommandsRef,
): Command {
  return (view) => {
    const client = session.current?.client;
    if (!client) return false;
    const symbol = symbolAt(view);
    void (async () => {
      const answer = await guard(() =>
        client.references(path, offsetToPosition(view.state.doc, view.state.selection.main.head)),
      );
      commands.current?.showReferences(symbol || "references", toCodeTargets(answer));
    })();
    return true;
  };
}

function renameCommand(path: string, session: LspSessionRef, commands: LspCommandsRef): Command {
  return (view) => {
    const client = session.current?.client;
    if (!client) return false;
    if (!client.canRename) {
      commands.current?.report(`${client.server.name} cannot rename symbols`);
      return true;
    }
    const symbol = symbolAt(view);
    if (!symbol) return true;
    const position = offsetToPosition(view.state.doc, view.state.selection.main.head);
    void (async () => {
      const newName = await commands.current?.promptRename(symbol);
      if (!newName || newName === symbol) return;
      const edit = await guard(() => client.rename(path, position, newName));
      if (!edit) {
        commands.current?.report(`Couldn’t rename ${symbol}`);
        return;
      }
      const problem = await commands.current?.applyWorkspaceEdit(symbol, edit);
      if (problem) commands.current?.report(problem);
    })();
    return true;
  };
}

/** A cancelled request is the next keystroke winning, not a failure. */
async function guard<T>(run: () => Promise<T | null>): Promise<T | null> {
  try {
    return await run();
  } catch (error) {
    if (isCancelled(error)) return null;
    throw error;
  }
}

function originOf(view: EditorView, path: string): CodeLocation {
  const head = view.state.selection.main.head;
  const line = view.state.doc.lineAt(head);
  return { path, line: line.number, column: head - line.from + 1 };
}

/** The identifier under the cursor, for labelling a result list or a rename. */
function symbolAt(view: EditorView): string {
  const head = view.state.selection.main.head;
  const line = view.state.doc.lineAt(head);
  const offset = head - line.from;
  const before = /[\w$]*$/.exec(line.text.slice(0, offset))?.[0] ?? "";
  const after = /^[\w$]*/.exec(line.text.slice(offset))?.[0] ?? "";
  return `${before}${after}`;
}

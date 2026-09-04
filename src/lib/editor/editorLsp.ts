/**
 * Everything the editor gains from a language server, as one extension.
 *
 * Installed for every file wavex knows a server for, whether or not one turns
 * out to be running: each capability reads through the session reference and
 * does nothing while it is empty. A missing, crashed, or still-starting server
 * therefore costs the editor nothing but the extension itself.
 */

import type { Extension } from "@codemirror/state";
import { editorLspDiagnostics } from "./editorLspDiagnostics";
import { editorLspHover, editorLspSignatureHelp } from "./editorLspHover";
import {
  editorLspNavigation,
  type LspCommandsRef,
  type LspNavigationCommands,
  type LspWorkspaceCommands,
} from "./editorLspNavigation";
import type { LspSessionRef } from "./editorLspSession";

export function editorLsp(
  path: string,
  session: LspSessionRef,
  commands: LspCommandsRef,
): Extension {
  return [
    editorLspDiagnostics(path),
    editorLspHover(path, session),
    editorLspSignatureHelp(path, session),
    editorLspNavigation(path, session, commands),
  ];
}

export type { LspCommandsRef, LspNavigationCommands, LspWorkspaceCommands };

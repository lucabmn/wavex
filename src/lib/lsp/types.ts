/**
 * The slice of the language server protocol wavex speaks.
 *
 * Hand-written rather than pulled from `vscode-languageserver-protocol`: only
 * these members are ever sent or read, and the full package brings a
 * dependency graph and a URI implementation that would compete with
 * `lib/lsp/uri.ts` for the one boundary that has to stay single.
 */

export type LspPosition = { line: number; character: number };
export type LspRange = { start: LspPosition; end: LspPosition };
export type LspLocation = { uri: string; range: LspRange };

export type LspLocationLink = {
  targetUri: string;
  targetRange: LspRange;
  targetSelectionRange?: LspRange;
};

export type LspTextEdit = { range: LspRange; newText: string };

/**
 * A text edit against one file, or a `CreateFile` / `RenameFile` / `DeleteFile`
 * resource operation — which carries a `kind` and no `textDocument`.
 */
export type LspDocumentChange = {
  kind?: "create" | "rename" | "delete";
  textDocument?: { uri: string; version?: number | null };
  edits?: LspTextEdit[];
};

export type LspWorkspaceEdit = {
  changes?: Record<string, LspTextEdit[]>;
  documentChanges?: LspDocumentChange[];
};

/** 1 error, 2 warning, 3 information, 4 hint. */
export type LspDiagnosticSeverity = 1 | 2 | 3 | 4;

export type LspDiagnostic = {
  range: LspRange;
  severity?: LspDiagnosticSeverity;
  code?: string | number;
  source?: string;
  message: string;
  relatedInformation?: Array<{ location: LspLocation; message: string }>;
};

export type LspPublishDiagnostics = {
  uri: string;
  version?: number;
  diagnostics: LspDiagnostic[];
};

export type LspMarkupContent = { kind: "plaintext" | "markdown"; value: string };
export type LspMarkedString = string | { language: string; value: string };

export type LspHover = {
  contents: LspMarkupContent | LspMarkedString | LspMarkedString[];
  range?: LspRange;
};

export type LspCompletionItem = {
  label: string;
  kind?: number;
  detail?: string;
  documentation?: string | LspMarkupContent;
  sortText?: string;
  filterText?: string;
  insertText?: string;
  /** 1 plain text, 2 snippet. */
  insertTextFormat?: 1 | 2;
  textEdit?: LspTextEdit | { replace: LspRange; insert: LspRange; newText: string };
  additionalTextEdits?: LspTextEdit[];
  data?: unknown;
  preselect?: boolean;
  deprecated?: boolean;
  tags?: number[];
};

export type LspCompletionList = { isIncomplete: boolean; items: LspCompletionItem[] };

export type LspParameterInformation = {
  label: string | [number, number];
  documentation?: string | LspMarkupContent;
};

export type LspSignatureInformation = {
  label: string;
  documentation?: string | LspMarkupContent;
  parameters?: LspParameterInformation[];
  activeParameter?: number;
};

export type LspSignatureHelp = {
  signatures: LspSignatureInformation[];
  activeSignature?: number | null;
  activeParameter?: number | null;
};

export type LspDocumentSymbol = {
  name: string;
  detail?: string;
  kind: number;
  range: LspRange;
  selectionRange: LspRange;
  children?: LspDocumentSymbol[];
};

export type LspSymbolInformation = {
  name: string;
  kind: number;
  containerName?: string;
  location: LspLocation;
};

/** 1 full text, 2 incremental. 0 means the server wants no sync at all. */
export type LspTextDocumentSyncKind = 0 | 1 | 2;

export type LspContentChange = { range: LspRange; text: string } | { text: string };

export type LspServerCapabilities = {
  positionEncoding?: string;
  textDocumentSync?:
    | LspTextDocumentSyncKind
    | { change?: LspTextDocumentSyncKind; openClose?: boolean };
  completionProvider?: {
    triggerCharacters?: string[];
    resolveProvider?: boolean;
  };
  signatureHelpProvider?: { triggerCharacters?: string[]; retriggerCharacters?: string[] };
  hoverProvider?: boolean | object;
  definitionProvider?: boolean | object;
  referencesProvider?: boolean | object;
  renameProvider?: boolean | { prepareProvider?: boolean };
  documentSymbolProvider?: boolean | object;
  workspaceSymbolProvider?: boolean | object;
  documentFormattingProvider?: boolean | object;
};

/** Symbol kinds, for the icons a result list shows. */
export const LSP_SYMBOL_KIND: Record<number, string> = {
  1: "file",
  2: "module",
  3: "namespace",
  4: "package",
  5: "class",
  6: "method",
  7: "property",
  8: "field",
  9: "constructor",
  10: "enum",
  11: "interface",
  12: "function",
  13: "variable",
  14: "constant",
  15: "string",
  16: "number",
  17: "boolean",
  18: "array",
  19: "object",
  20: "key",
  21: "null",
  22: "enum-member",
  23: "struct",
  24: "event",
  25: "operator",
  26: "type-parameter",
};

/** Completion kinds, mapped to the CodeMirror completion type names. */
export const LSP_COMPLETION_KIND: Record<number, string> = {
  1: "text",
  2: "method",
  3: "function",
  4: "function",
  5: "property",
  6: "variable",
  7: "class",
  8: "interface",
  9: "namespace",
  10: "property",
  11: "type",
  12: "enum",
  13: "enum",
  14: "keyword",
  15: "text",
  16: "text",
  17: "text",
  18: "text",
  19: "text",
  20: "enum",
  21: "constant",
  22: "class",
  23: "interface",
  24: "keyword",
  25: "type",
};

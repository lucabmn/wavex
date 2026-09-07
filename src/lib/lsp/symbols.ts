/**
 * Symbols from a server, flattened for a picker.
 *
 * `textDocument/documentSymbol` answers with a tree; `workspace/symbol`
 * answers with a flat list carrying a container name. Both become the same
 * row: a name, what contains it, and somewhere to jump to.
 */

import { positionToLineColumn } from "./positions";
import { LSP_SYMBOL_KIND, type LspDocumentSymbol, type LspSymbolInformation } from "./types";
import { uriToPath } from "./uri";

export type CodeSymbol = {
  name: string;
  /** Enclosing class, module, or file — shown beside the name. */
  container: string;
  kind: string;
  path: string;
  line: number;
  column: number;
};

export function flattenDocumentSymbols(
  symbols: LspDocumentSymbol[] | null,
  path: string,
): CodeSymbol[] {
  const out: CodeSymbol[] = [];
  const walk = (nodes: LspDocumentSymbol[], container: string) => {
    for (const node of nodes) {
      out.push({
        name: node.name,
        container,
        kind: LSP_SYMBOL_KIND[node.kind] ?? "",
        path,
        ...positionToLineColumn(node.selectionRange.start),
      });
      if (node.children?.length) {
        walk(node.children, container ? `${container}.${node.name}` : node.name);
      }
    }
  };
  walk(symbols ?? [], "");
  return out;
}

export function toWorkspaceSymbols(symbols: LspSymbolInformation[] | null): CodeSymbol[] {
  const out: CodeSymbol[] = [];
  for (const symbol of symbols ?? []) {
    const path = uriToPath(symbol.location.uri);
    if (!path) continue;
    out.push({
      name: symbol.name,
      container: symbol.containerName ?? "",
      kind: LSP_SYMBOL_KIND[symbol.kind] ?? "",
      path,
      ...positionToLineColumn(symbol.location.range.start),
    });
  }
  return out;
}

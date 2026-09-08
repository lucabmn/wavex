/**
 * Asks whether a page will agree to be shown in the panel's frame.
 *
 * The frame itself cannot be asked: a refused one fires no event the WebView
 * reports, and WebKit throws on its location exactly as it throws on a page
 * that really loaded, so from script a refusal and a success look the same.
 * The answer is in the response headers, and Rust reads them.
 *
 * This is the drawing machine's question, so it goes over local IPC and is not
 * reachable through a connection. A client without a native shell has no Rust
 * to ask and gets `null` — the panel then shows the page and lets a blank one
 * speak for itself, which is the behaviour it has without this.
 */
import { invokeLocal } from "./transport";
import { IS_TAURI } from "./clientRuntime";

export type FramePreflight = {
  /** Whether anything answered at all. */
  reachable: boolean;
  /** Whether what answered allows itself to be framed. */
  embeddable: boolean;
  /** The header that refused, for the panel to quote. */
  refusedBy: string | null;
};

export async function preflightFrame(url: string): Promise<FramePreflight | null> {
  if (!IS_TAURI) return null;
  try {
    const probe = await invokeLocal<FramePreflight>("probe_frame", { url });
    return {
      reachable: !!probe.reachable,
      embeddable: !!probe.embeddable,
      refusedBy: probe.refusedBy ?? null,
    };
  } catch {
    return null;
  }
}

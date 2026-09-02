import { invoke } from "@tauri-apps/api/core";
import { IS_MAC } from "./platform";
import type { LiveAgent } from "./liveAgents";

export const MENU_BAR_AGENTS_CHANGED = "menu_bar_agents_changed";
export const MENU_BAR_FOCUS_SESSION = "focus_session_from_menu_bar";

let lastSnapshot = "";

/** Publish only meaningful row changes, not every streamed transcript token. */
export function publishMenuBarAgents(agents: LiveAgent[]): void {
  if (!IS_MAC) return;
  const snapshot = JSON.stringify(agents);
  if (snapshot === lastSnapshot) return;
  lastSnapshot = snapshot;
  void invoke("menu_bar_update_agents", { agents }).catch(() => {
    // The menu-bar integration is optional at runtime; the main app must keep
    // working if the native status item could not be installed.
  });
}

import { invoke } from "@tauri-apps/api/core";
import { IS_MAC } from "./platform";
import type { LiveAgent } from "./liveAgents";

export const MENU_BAR_AGENTS_CHANGED = "menu_bar_agents_changed";
export const MENU_BAR_FOCUS_SESSION = "focus_session_from_menu_bar";
/**
 * Clicking an agent left running in another profile. The popover cannot switch
 * under the app: the profile being left may have running chats of its own, and
 * the app owns that conversation.
 */
export const MENU_BAR_SWITCH_PROFILE = "switch_profile_from_menu_bar";

let lastSnapshot = "";

/** Publish only meaningful row changes, not every streamed transcript token. */
/**
 * Hands the native status item the agents this window is leaving behind. They
 * outlive the reload that the window itself does not, so they cannot stay in
 * the window-keyed source `publishMenuBarAgents` writes.
 */
export function publishDetachedAgents(agents: LiveAgent[]): Promise<void> {
  if (!IS_MAC || agents.length === 0) return Promise.resolve();
  return invoke<void>("menu_bar_detach_agents", { agents }).catch(() => undefined);
}

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

import { createPortal } from "react-dom";
import type { Profile } from "../lib/profiles/profile";
import { ProfileAvatar } from "./ProfileAvatar";

/**
 * Covers the workspace for the length of a profile switch.
 *
 * Persisting every window takes real time, and the reload that follows tears
 * the document down. Without a shade over both, the app looks frozen and then
 * blank. This paints opaque so it also hides the gap between the two
 * documents, and `#boot-splash` in `index.html` picks the shade up on the
 * other side.
 */
export function ProfileSwitchOverlay({ target }: { target: Profile }) {
  return createPortal(
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-0 grid place-content-center justify-items-center gap-3 bg-background-base"
      // Above every layer in `LAYER`: nothing may sit over a switch, including
      // the toasts and dialogs that were on screen when it started.
      style={{ zIndex: 1000 }}
    >
      <ProfileAvatar profile={target} size="md" />
      <p className="text-[12px] text-content/55">Switching to {target.name}…</p>
    </div>,
    document.body,
  );
}

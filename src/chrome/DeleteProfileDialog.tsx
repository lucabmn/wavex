import { useRef } from "react";
import { createPortal } from "react-dom";
import { LAYER } from "../lib/layers";
import type { Profile } from "../lib/profiles/profile";
import { useDialogFocus } from "../hooks/useDialogFocus";

type Props = {
  profile: Profile;
  onCancel: () => void;
  onConfirm: () => void;
};

/**
 * Deleting a profile drops wavex's own copy of its state. Repositories and
 * worktrees live outside the app data folder and are never touched, so nothing
 * uncommitted can be lost here.
 */
export function DeleteProfileDialog({ profile, onCancel, onConfirm }: Props) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useDialogFocus<HTMLDivElement>({
    onClose: onCancel,
    initialFocusRef: cancelRef,
  });

  return createPortal(
    <div className="fixed inset-0" style={{ zIndex: LAYER.dialog }}>
      <div className="absolute inset-0 bg-black/30" onMouseDown={onCancel} />
      <div
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
        aria-modal="true"
        aria-label={`Delete ${profile.name}`}
        onMouseDown={(event) => event.stopPropagation()}
        className="absolute left-1/2 top-[22%] flex w-[min(420px,calc(100vw-24px))] -translate-x-1/2 flex-col gap-3 rounded-lg border border-content/10 bg-content/5 p-4 shadow-xl backdrop-blur-xl"
      >
        <div className="flex flex-col gap-1">
          <h2 className="text-[13px] font-medium leading-tight text-content">
            Delete “{profile.name}”?
          </h2>
          <p className="text-[12px] leading-snug text-content/55">
            Its projects, chats, agents, and workspace are removed from wavex. This cannot be
            undone.
          </p>
          <p className="text-[12px] leading-snug text-content/45">
            Your folders on disk stay exactly as they are — no repository, worktree, or uncommitted
            change is touched.
          </p>
        </div>

        <div className="flex justify-end gap-2">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            className="rounded-md px-3 py-1.5 text-[12px] text-content/70 hover:bg-content/8 hover:text-content"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="rounded-md bg-red-500/20 px-3 py-1.5 text-[12px] font-medium text-red-300 hover:bg-red-500/30"
          >
            Delete profile
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

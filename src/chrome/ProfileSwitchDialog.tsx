import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { LAYER } from "../lib/layers";
import { profileSwitchWhileBusyMessage } from "../lib/inFlight";
import type { Profile } from "../lib/profiles/profile";
import { ProfileAvatar } from "./ProfileAvatar";

type Props = {
  target: Profile;
  runningCount: number;
  onCancel: () => void;
  onConfirm: (keepAgents: boolean) => void;
};

/**
 * What should happen to the chats still running before the app leaves this
 * profile. Neither answer keeps them on screen: the adapter that owns a turn
 * lives in this webview and dies with the reload the switch performs. The
 * choice is whether their CLIs finish the work they already started.
 */
export function ProfileSwitchDialog({ target, runningCount, onCancel, onConfirm }: Props) {
  const keepRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    keepRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onCancel();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onCancel]);

  return createPortal(
    <div className="fixed inset-0" style={{ zIndex: LAYER.dialog }}>
      <div className="absolute inset-0 bg-black/30" onMouseDown={onCancel} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Switch to ${target.name}`}
        onMouseDown={(event) => event.stopPropagation()}
        className="absolute left-1/2 top-[22%] flex w-[min(440px,calc(100vw-24px))] -translate-x-1/2 flex-col gap-3 rounded-lg border border-content/10 bg-content/5 p-4 shadow-xl backdrop-blur-xl"
      >
        <div className="flex items-start gap-2.5">
          <ProfileAvatar profile={target} size="md" />
          <div className="flex min-w-0 flex-col gap-1">
            <h2 className="text-[13px] font-medium leading-tight text-content">
              Switch to “{target.name}”?
            </h2>
            <p className="text-[12px] leading-snug text-content/55">
              {profileSwitchWhileBusyMessage(runningCount)} wavex stops following them either way —
              their transcripts pick up again when you switch back.
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <button
            ref={keepRef}
            type="button"
            onClick={() => onConfirm(true)}
            className="flex flex-col items-start gap-0.5 rounded-md border border-content/10 bg-content/5 px-3 py-2 text-left hover:bg-content/10 focus-visible:outline-2 focus-visible:outline-accent"
          >
            <span className="text-[12px] font-medium text-content">Keep running</span>
            <span className="text-[11px] leading-snug text-content/50">
              The agents finish the work they started. You will not see progress until you come
              back.
            </span>
          </button>
          <button
            type="button"
            onClick={() => onConfirm(false)}
            className="flex flex-col items-start gap-0.5 rounded-md border border-content/10 px-3 py-2 text-left hover:bg-content/10 focus-visible:outline-2 focus-visible:outline-accent"
          >
            <span className="text-[12px] font-medium text-content">Pause</span>
            <span className="text-[11px] leading-snug text-content/50">
              Stop them now and offer Continue when you switch back.
            </span>
          </button>
        </div>

        <div className="flex justify-end">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md px-3 py-1.5 text-[12px] text-content/70 hover:bg-content/8 hover:text-content"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

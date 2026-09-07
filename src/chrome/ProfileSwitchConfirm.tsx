import { HarnessIcon } from "./HarnessIcon";
import { Modal } from "./Modal";
import { basename } from "../lib/fs";
import { sessionDisplayTitle, type Session } from "../lib/session";
import type { Profile } from "../lib/profiles/profile";

type Props = {
  /** The profile the user picked. Null renders nothing. */
  target: Profile | null;
  /** Live in-flight sessions of the profile being left, in tab order. */
  running: Session[];
  /** Open terminal tabs, which stop with the switch. */
  terminalCount: number;
  onCancel: () => void;
  onConfirm: () => void;
};

function sessionState(session: Session): string {
  if (session.busy) return "Running";
  if (session.pendingQuestion != null) return "Waiting for your answer";
  return "Waiting for approval";
}

/**
 * Names what a profile switch pauses. The previous native sheet quoted a bare
 * count; agents stop with the switch, so the dialog lists them — harness,
 * title, and project — plus open terminals, which stop unconditionally.
 */
export function ProfileSwitchConfirm({
  target,
  running,
  terminalCount,
  onCancel,
  onConfirm,
}: Props) {
  if (!target) return null;
  const chatWord = running.length === 1 ? "chat" : "chats";
  return (
    <Modal
      size="sm"
      title={`Switch to ${target.name}?`}
      description={`${running.length} ${chatWord} still running — they stop now and offer Continue when you switch back.`}
      onClose={onCancel}
    >
      <div className="flex flex-col gap-3 px-4 pb-4 pt-3">
        <ul className="flex max-h-56 flex-col gap-1 overflow-y-auto overscroll-none">
          {running.map((session) => (
            <li
              key={session.id}
              className="flex items-center gap-2 rounded-md border border-content/10 bg-content/5 px-2.5 py-1.5"
            >
              <HarnessIcon harness={session.harness} className="size-4 shrink-0" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12.5px] text-content">
                  {sessionDisplayTitle(session.title, session.harness)}
                </span>
                <span className="block truncate text-[11px] text-content/45">
                  {sessionState(session)} · {basename(session.cwd)}
                </span>
              </span>
            </li>
          ))}
        </ul>
        {terminalCount > 0 ? (
          <p className="text-[12px] leading-snug text-content/55">
            {terminalCount} open terminal{terminalCount === 1 ? "" : "s"} will also stop.
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md px-3 py-1.5 text-[12px] text-content/70 hover:bg-content/5 hover:text-content"
          >
            Stay here
          </button>
          <button
            type="button"
            // oxlint-disable-next-line jsx-a11y/no-autofocus -- the dialog exists to decide this
            autoFocus
            onClick={onConfirm}
            className="rounded-md bg-content px-3 py-1.5 text-[12px] font-medium text-background-base hover:bg-content/80"
          >
            Switch to {target.name}
          </button>
        </div>
      </div>
    </Modal>
  );
}

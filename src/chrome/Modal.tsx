import { X } from "./icons";
import { useId, useRef, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { useLockOverscroll } from "../hooks/useLockOverscroll";
import { LAYER } from "../lib/layers";
import { useOverlayPresence } from "../hooks/useOverlayPresence";
import { useDialogFocus } from "../hooks/useDialogFocus";

export type ModalSize = "sm" | "md" | "lg";

const WIDTH: Record<ModalSize, string> = {
  sm: "w-[min(420px,calc(100vw-24px))]",
  md: "w-[min(560px,calc(100vw-24px))]",
  lg: "w-[min(1040px,calc(100vw-32px))]",
};

const TOP: Record<ModalSize, string> = {
  sm: "top-[22%]",
  md: "top-[10%]",
  lg: "top-[6%]",
};

type Props = {
  onClose: () => void;
  title: string;
  description?: string;
  size?: ModalSize;
  /** Extra classes on the panel (fixed height, etc). */
  className?: string;
  /** Preferred first control. Defaults to the close action. */
  initialFocusRef?: RefObject<HTMLElement | null>;
  /** Keep the modal present while an irreversible action is in flight. */
  closeDisabled?: boolean;
  children: ReactNode;
};

export function ModalPanel({
  onClose,
  title,
  description,
  size = "md",
  className,
  initialFocusRef,
  closeDisabled = false,
  children,
}: Props) {
  useOverlayPresence();
  const closeRef = useRef<HTMLButtonElement>(null);
  const lockOverscroll = useLockOverscroll<HTMLDivElement>();
  const uid = useId();
  const titleId = `${uid}-title`;
  const descriptionId = description ? `${uid}-desc` : undefined;
  const dialogRef = useDialogFocus<HTMLDivElement>({
    onClose,
    initialFocusRef: initialFocusRef ?? closeRef,
    escapeDisabled: closeDisabled,
  });

  return (
    <div className={`absolute left-1/2 ${TOP[size]} ${WIDTH[size]} -translate-x-1/2`}>
      <div
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        onMouseDown={(event) => event.stopPropagation()}
        className={`modal-panel halo-overlay flex flex-col overflow-hidden rounded-2xl ${className ?? ""}`}
      >
        <header className="flex shrink-0 items-start gap-2 px-5 pt-4">
          <div className="min-w-0 flex-1 pt-0.5">
            <h2
              id={titleId}
              className="text-[19px] font-semibold leading-tight tracking-[-0.015em] text-content"
            >
              {title}
            </h2>
            {description ? (
              <p
                id={descriptionId}
                className="mt-1 truncate text-[12px] leading-snug text-content/45"
              >
                {description}
              </p>
            ) : null}
          </div>
          <button
            ref={closeRef}
            type="button"
            aria-label="Close"
            disabled={closeDisabled}
            onClick={onClose}
            className="halo-focus grid size-7 shrink-0 place-items-center rounded-lg text-content/40 transition-colors hover:bg-content/8 hover:text-content disabled:cursor-default disabled:opacity-30 disabled:hover:bg-transparent"
          >
            <X className="size-3.5" strokeWidth={1.75} />
          </button>
        </header>
        <div
          ref={lockOverscroll}
          className="halo-scroll min-h-0 flex-1 overflow-y-auto overscroll-none"
        >
          {children}
        </div>
      </div>
    </div>
  );
}

export function Modal(props: Props) {
  return createPortal(
    <div className="fixed inset-0" style={{ zIndex: LAYER.dialog }}>
      <div
        className="modal-backdrop absolute inset-0 bg-[color-mix(in_srgb,var(--shade)_58%,transparent)] backdrop-blur-[2px]"
        onMouseDown={() => {
          if (!props.closeDisabled) props.onClose();
        }}
      />
      <ModalPanel {...props} />
    </div>,
    document.body,
  );
}

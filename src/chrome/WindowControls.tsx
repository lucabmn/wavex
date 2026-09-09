import { nativeWindow } from "../lib/native";
import { Copy, Minus, Square, X } from "./icons";
import { useEffect, useState } from "react";

export function WindowControls() {
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let mounted = true;

    const win = nativeWindow();
    void win
      ?.isMaximized()
      .then((max) => {
        if (mounted) setIsMaximized(max);
      })
      .catch(() => {});

    void win
      ?.onResized(async () => {
        try {
          const max = await win.isMaximized();
          if (mounted) setIsMaximized(max);
        } catch {}
      })
      .then((unlistenFn) => {
        if (mounted) {
          unlisten = unlistenFn;
        } else {
          unlistenFn();
        }
      })
      .catch(() => {});

    return () => {
      mounted = false;
      unlisten?.();
    };
  }, []);

  const handleMinimize = () => {
    try {
      void nativeWindow()?.minimize();
    } catch {}
  };

  const handleToggleMaximize = () => {
    try {
      void nativeWindow()?.toggleMaximize();
    } catch {}
  };

  const handleClose = () => {
    try {
      void nativeWindow()?.close();
    } catch {}
  };

  return (
    <div
      className="flex h-full shrink-0 items-stretch border-l border-edge"
      data-tauri-drag-region="false"
    >
      <button
        type="button"
        title="Minimize"
        aria-label="Minimize window"
        data-tauri-drag-region="false"
        onClick={handleMinimize}
        className="flex w-10 items-center justify-center text-muted transition-colors hover:bg-hover hover:text-content"
      >
        <Minus className="size-3.5" strokeWidth={1.75} />
      </button>
      <button
        type="button"
        title={isMaximized ? "Restore" : "Maximize"}
        aria-label={isMaximized ? "Restore window" : "Maximize window"}
        data-tauri-drag-region="false"
        onClick={handleToggleMaximize}
        className="flex w-10 items-center justify-center text-muted transition-colors hover:bg-hover hover:text-content"
      >
        {isMaximized ? (
          <Copy className="size-3" strokeWidth={1.75} />
        ) : (
          <Square className="size-3" strokeWidth={1.75} />
        )}
      </button>
      <button
        type="button"
        title="Close"
        aria-label="Close window"
        data-tauri-drag-region="false"
        onClick={handleClose}
        className="flex w-10 items-center justify-center text-muted transition-colors hover:bg-red-600 hover:text-white"
      >
        <X className="size-3.5" strokeWidth={1.75} />
      </button>
    </div>
  );
}

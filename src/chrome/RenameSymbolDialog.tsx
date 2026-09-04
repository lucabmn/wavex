import { useEffect, useRef, useState } from "react";
import { Modal } from "./Modal";

type Props = {
  symbol: string;
  onCancel: () => void;
  onRename: (newName: string) => void;
};

/**
 * The new name for a rename the language server will carry out.
 *
 * The rename itself edits files across the project, so it is worth a dialog
 * rather than an inline field: the user should see what they are renaming and
 * have somewhere unambiguous to cancel.
 */
export function RenameSymbolDialog({ symbol, onCancel, onRename }: Props) {
  const [name, setName] = useState(symbol);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    input.select();
  }, []);

  const trimmed = name.trim();
  const submit = () => {
    if (!trimmed || trimmed === symbol) {
      onCancel();
      return;
    }
    onRename(trimmed);
  };

  return (
    <Modal onClose={onCancel} title="Rename symbol" description={symbol} size="sm">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
        className="flex flex-col gap-3 px-4 pt-3 pb-4"
      >
        <input
          ref={inputRef}
          value={name}
          spellCheck={false}
          autoComplete="off"
          aria-label="New name"
          onChange={(event) => setName(event.target.value)}
          className="h-8 w-full rounded-md border border-content/12 bg-content/5 px-2.5 font-mono text-[12.5px] text-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        />
        <p className="text-[11.5px] leading-snug text-content/45">
          Every reference is rewritten on disk. Save any file with unsaved changes first.
        </p>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="h-7 rounded-md px-2.5 text-[12px] text-content/70 hover:bg-content/8 hover:text-content"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!trimmed || trimmed === symbol}
            className="h-7 rounded-md bg-accent px-2.5 text-[12px] font-medium text-white disabled:opacity-40"
          >
            Rename
          </button>
        </div>
      </form>
    </Modal>
  );
}

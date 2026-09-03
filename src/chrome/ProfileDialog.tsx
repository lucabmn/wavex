import { useEffect, useRef, useState } from "react";
import { Modal } from "./Modal";
import { PROFILE_COLORS, PROFILE_NAME_MAX, normalizeProfileName } from "../lib/profiles/profile";

type Props = {
  title: string;
  description: string;
  confirmLabel: string;
  initialName?: string;
  initialColor?: number;
  onCancel: () => void;
  onConfirm: (name: string, color: number) => void;
};

/** Create or rename a profile: the two fields that give it an identity. */
export function ProfileDialog({
  title,
  description,
  confirmLabel,
  initialName = "",
  initialColor = 0,
  onCancel,
  onConfirm,
}: Props) {
  const [name, setName] = useState(initialName);
  const [color, setColor] = useState(initialColor);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.select();
  }, []);

  const clean = normalizeProfileName(name);

  const submit = () => {
    if (!clean) return;
    onConfirm(clean, color);
  };

  return (
    <Modal title={title} description={description} size="sm" onClose={onCancel}>
      <form
        className="flex flex-col gap-4 px-4 pb-4 pt-3"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <label className="flex flex-col gap-1.5">
          <span className="text-[12px] font-medium text-content/60">Name</span>
          <input
            ref={inputRef}
            value={name}
            maxLength={PROFILE_NAME_MAX}
            placeholder="Work"
            onChange={(event) => setName(event.target.value)}
            className="h-9 rounded-lg border border-content/10 bg-content/5 px-3 text-[13px] text-content outline-none placeholder:text-content/30 focus:border-accent/60"
          />
        </label>

        <fieldset className="flex flex-col gap-2">
          <legend className="text-[12px] font-medium text-content/60">Color</legend>
          <div className="flex flex-wrap gap-2">
            {PROFILE_COLORS.map((value, index) => (
              <button
                key={value}
                type="button"
                aria-label={`Color ${index + 1}`}
                aria-pressed={index === color}
                onClick={() => setColor(index)}
                style={{ backgroundColor: value }}
                className={`size-7 rounded-lg transition-transform ${
                  index === color
                    ? "ring-2 ring-content/70 ring-offset-2 ring-offset-background-base"
                    : "hover:scale-110"
                }`}
              />
            ))}
          </div>
        </fieldset>

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md px-3 py-1.5 text-[12px] text-content/70 hover:bg-content/8 hover:text-content"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!clean}
            className="rounded-md bg-accent px-3 py-1.5 text-[12px] font-medium text-white disabled:opacity-40"
          >
            {confirmLabel}
          </button>
        </div>
      </form>
    </Modal>
  );
}

import { useEffect, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { LAYER } from "../lib/layers";
import { prettyCwd } from "../lib/paths";
import {
  deletePromptTemplate,
  isValidTemplateName,
  savePromptTemplate,
  slugTemplateName,
  type PromptTemplate,
  type PromptTemplateDraft,
} from "../lib/project/promptTemplates";

type Props = {
  draft: PromptTemplateDraft;
  /** Set when editing, so the dialog can offer deletion. */
  existing: PromptTemplate | null;
  onClose: () => void;
  onSaved: (template: PromptTemplate) => void;
  onDeleted: (template: PromptTemplate) => void;
};

/**
 * Editor for one project prompt template. The body is plain text: whatever is
 * typed here is what lands in the composer, `@file` mentions included.
 */
export function PromptTemplateDialog({ draft, existing, onClose, onSaved, onDeleted }: Props) {
  const nameRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const [name, setName] = useState(draft.name);
  const [description, setDescription] = useState(draft.description);
  const [body, setBody] = useState(draft.body);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    const field = draft.name ? bodyRef.current : nameRef.current;
    field?.focus();
    if (field === nameRef.current) nameRef.current?.select();
  }, [draft.name]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const slug = slugTemplateName(name);
  const valid = isValidTemplateName(slug) && body.trim().length > 0;

  const save = (event: FormEvent) => {
    event.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    void savePromptTemplate({ ...draft, name: slug, description: description.trim(), body })
      .then(onSaved)
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => setBusy(false));
  };

  const remove = () => {
    if (!existing || busy) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setBusy(true);
    setError(null);
    void deletePromptTemplate(existing)
      .then(() => onDeleted(existing))
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => setBusy(false));
  };

  return createPortal(
    <div data-prompt-template-dialog className="fixed inset-0" style={{ zIndex: LAYER.dialog }}>
      <div className="absolute inset-0 bg-black/30" onMouseDown={onClose} />
      <form
        role="dialog"
        aria-modal="true"
        aria-label={existing ? `Edit template ${existing.name}` : "New prompt template"}
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={save}
        className="absolute left-1/2 top-[12%] flex w-[min(560px,calc(100vw-24px))] -translate-x-1/2 flex-col gap-3 rounded-lg border border-content/10 bg-content/5 p-4 shadow-xl backdrop-blur-xl"
      >
        <div className="flex flex-col gap-1">
          <h2 className="text-[13px] font-medium leading-tight text-content">
            {existing ? "Edit prompt template" : "New prompt template"}
          </h2>
          <p className="text-[12px] leading-snug text-content/55">
            Saved with this project and inserted from the composer with{" "}
            <span className="font-mono text-content/70">/</span>. It is plain text, so{" "}
            <span className="font-mono text-content/70">@file</span> mentions work the same as when
            you type them.
          </p>
          <p className="truncate text-[11px] leading-tight text-content/40">
            {prettyCwd(draft.projectPath)}
          </p>
        </div>

        <label className="flex flex-col gap-1">
          <span className="text-[11px] uppercase tracking-wide text-content/45">Name</span>
          <input
            ref={nameRef}
            value={name}
            spellCheck={false}
            placeholder="review-diff"
            disabled={busy}
            maxLength={64}
            onChange={(event) => setName(event.target.value)}
            onBlur={() => setName((value) => slugTemplateName(value))}
            className="w-full rounded-md bg-content/10 px-2 py-1.5 font-mono text-[13px] text-content outline-none placeholder:text-content/40"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[11px] uppercase tracking-wide text-content/45">
            Description <span className="normal-case tracking-normal">(optional)</span>
          </span>
          <input
            value={description}
            placeholder="What this prompt is for"
            disabled={busy}
            maxLength={200}
            onChange={(event) => setDescription(event.target.value)}
            className="w-full rounded-md bg-content/10 px-2 py-1.5 text-[13px] text-content outline-none placeholder:text-content/40"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[11px] uppercase tracking-wide text-content/45">Prompt</span>
          <textarea
            ref={bodyRef}
            value={body}
            spellCheck={false}
            rows={8}
            placeholder={"Review @src for our conventions, then list what you would change."}
            disabled={busy}
            onChange={(event) => setBody(event.target.value)}
            className="max-h-[40vh] min-h-32 w-full resize-y rounded-md bg-content/10 px-2 py-1.5 font-mono text-[12px] leading-5 text-content outline-none placeholder:text-content/40"
          />
        </label>

        {error ? (
          <p className="text-[12px] leading-snug text-content/70">{error}</p>
        ) : name.trim() && !isValidTemplateName(slug) ? (
          <p className="text-[12px] leading-snug text-content/50">
            Use lowercase letters, numbers, and hyphens.
          </p>
        ) : null}

        <div className="flex items-center justify-end gap-2">
          {existing ? (
            <button
              type="button"
              disabled={busy}
              onClick={remove}
              onBlur={() => setConfirmDelete(false)}
              className="mr-auto rounded-md px-3 py-1.5 text-[12px] text-content/60 hover:bg-content/8 hover:text-content disabled:opacity-40"
            >
              {confirmDelete ? "Click again to delete" : "Delete"}
            </button>
          ) : null}
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="rounded-md px-3 py-1.5 text-[12px] text-content/70 hover:bg-content/8 hover:text-content"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!valid || busy}
            className="rounded-md bg-content/20 px-3 py-1.5 text-[12px] text-content hover:bg-content/25 disabled:opacity-40"
          >
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </div>,
    document.body,
  );
}

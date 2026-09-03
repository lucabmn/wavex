import { Pencil, Plus } from "./icons";
import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { looksLikeProject } from "../lib/recents";
import { pickerEntryKey, type ComposerPickerEntry } from "../lib/composerPicker";
import { templatePreview, type PromptTemplate } from "../lib/project/promptTemplates";
import { isValidSkillName, slugSkillName, type Skill } from "../lib/skills";
import { useLockOverscroll } from "../hooks/useLockOverscroll";
import { IS_MAC } from "../lib/platform";

const EDIT_SHORTCUT = IS_MAC ? "⌥↵" : "Alt+Enter";

type Props = {
  entries: ComposerPickerEntry[];
  query: string;
  active: number;
  creating: boolean;
  cwd: string;
  /** Templates need a project to belong to; work chats have none. */
  templatesEnabled: boolean;
  error?: string | null;
  busy?: boolean;
  onActive: (index: number) => void;
  onPick: (entry: ComposerPickerEntry) => void;
  onNewTemplate: () => void;
  onEditTemplate: (template: PromptTemplate) => void;
  onStartCreate: () => void;
  onCancelCreate: () => void;
  onCreate: (name: string, scope: "project" | "user") => void;
};

/** The composer's `/` picker: this project's prompt templates, then harness skills. */
export function SkillPicker({
  entries,
  query,
  active,
  creating,
  cwd,
  templatesEnabled,
  error,
  busy,
  onActive,
  onPick,
  onNewTemplate,
  onEditTemplate,
  onStartCreate,
  onCancelCreate,
  onCreate,
}: Props) {
  return (
    <div
      data-skill-picker
      className="overflow-hidden rounded-lg border border-content/10 bg-content/5 backdrop-blur-xl"
    >
      {creating ? (
        <CreateSkillForm
          query={query}
          cwd={cwd}
          error={error}
          busy={busy}
          onCancel={onCancelCreate}
          onCreate={onCreate}
        />
      ) : (
        <>
          <PickerList
            entries={entries}
            query={query}
            active={active}
            onActive={onActive}
            onPick={onPick}
            onEditTemplate={onEditTemplate}
          />
          <div className="flex items-center gap-1 border-t border-content/10 px-1 py-1">
            <FooterAction
              label="New template"
              disabled={!templatesEnabled}
              title={
                templatesEnabled
                  ? "Save a prompt with this project"
                  : "Open a project to save templates"
              }
              onClick={onNewTemplate}
            />
            <FooterAction label="New skill" onClick={onStartCreate} />
            {entries[active]?.kind === "template" ? (
              <span className="shrink-0 px-1.5 text-[11px] text-content/40">
                {EDIT_SHORTCUT} edit
              </span>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}

function FooterAction({
  label,
  disabled,
  title,
  onClick,
}: {
  label: string;
  disabled?: boolean;
  title?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      title={title}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className="flex flex-1 items-center gap-2 rounded-md px-1.5 py-1.5 text-left text-[12px] text-content/70 hover:bg-content/10 hover:text-content disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-content/70"
    >
      <Plus className="size-3.5 shrink-0" strokeWidth={1.75} />
      {label}
    </button>
  );
}

function PickerList({
  entries,
  query,
  active,
  onActive,
  onPick,
  onEditTemplate,
}: {
  entries: ComposerPickerEntry[];
  query: string;
  active: number;
  onActive: (index: number) => void;
  onPick: (entry: ComposerPickerEntry) => void;
  onEditTemplate: (template: PromptTemplate) => void;
}) {
  const lockOverscroll = useLockOverscroll<HTMLDivElement>();
  const activeRef = useRef<HTMLDivElement>(null);
  const pointer = useRef({ x: Number.NaN, y: Number.NaN, allow: false });
  const fromPointer = useRef(false);

  useEffect(() => {
    pointer.current.allow = false;
  }, [entries]);

  useEffect(() => {
    if (fromPointer.current) {
      fromPointer.current = false;
      return;
    }
    pointer.current.allow = false;
    activeRef.current?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const onListMouseMove = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (e.clientX === pointer.current.x && e.clientY === pointer.current.y) {
      return;
    }
    pointer.current = { x: e.clientX, y: e.clientY, allow: true };
  };

  const onRowEnter = (index: number) => {
    if (!pointer.current.allow) return;
    fromPointer.current = true;
    onActive(index);
  };

  if (entries.length === 0) {
    return (
      <p className="px-3 py-2.5 text-[12px] text-content/50">
        {query.trim() ? "No matching templates or skills" : "No templates or skills yet"}
      </p>
    );
  }

  return (
    <div
      ref={lockOverscroll}
      role="listbox"
      aria-label="Prompt templates and skills"
      onMouseMove={onListMouseMove}
      className="max-h-[min(240px,40vh)] overflow-y-auto overscroll-none px-1 py-1"
    >
      {entries.map((entry, index) => {
        const highlighted = index === active;
        const row =
          entry.kind === "template"
            ? {
                template: entry.template,
                name: entry.template.name,
                detail: templatePreview(entry.template),
                badge: "template",
              }
            : {
                template: null,
                name: entry.skill.invocation,
                detail: entry.skill.description,
                badge: scopeLabel(entry.skill),
              };
        const template = row.template;
        return (
          <div
            key={pickerEntryKey(entry)}
            role="presentation"
            className="group relative"
            onMouseEnter={() => onRowEnter(index)}
          >
            <div
              ref={highlighted ? activeRef : undefined}
              role="option"
              aria-selected={highlighted}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onPick(entry)}
              className={`flex w-full cursor-default flex-col gap-0.5 rounded-md px-2 py-1.5 text-left text-content ${
                highlighted ? (template ? "bg-template/15" : "bg-skill/15") : ""
              }`}
            >
              <span className="flex min-w-0 items-baseline gap-2 pr-6">
                <span
                  className={`truncate font-mono text-[13px] ${
                    highlighted
                      ? template
                        ? "font-medium text-template"
                        : "font-medium text-skill"
                      : ""
                  }`}
                >
                  /{row.name}
                </span>
                <span
                  className={`shrink-0 text-[10px] uppercase tracking-wide ${
                    template ? "text-template/70" : "text-content/40"
                  }`}
                >
                  {row.badge}
                </span>
              </span>
              {row.detail ? (
                <span className="line-clamp-2 pr-6 text-[11px] leading-4 text-content/50">
                  {row.detail}
                </span>
              ) : null}
            </div>
            {template ? (
              <button
                type="button"
                tabIndex={-1}
                title={`Edit template (${EDIT_SHORTCUT})`}
                aria-label={`Edit template ${template.name}`}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => onEditTemplate(template)}
                className={`absolute right-1.5 top-1.5 grid size-5 place-items-center rounded text-content/50 hover:bg-content/15 hover:text-content ${
                  highlighted ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                }`}
              >
                <Pencil className="size-3" strokeWidth={1.75} />
              </button>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function CreateSkillForm({
  query,
  cwd,
  error,
  busy,
  onCancel,
  onCreate,
}: {
  query: string;
  cwd: string;
  error?: string | null;
  busy?: boolean;
  onCancel: () => void;
  onCreate: (name: string, scope: "project" | "user") => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const project = looksLikeProject(cwd);
  const [name, setName] = useState(() => slugSkillName(query));
  const [scope, setScope] = useState<"project" | "user">(project ? "project" : "user");

  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);

  const slug = slugSkillName(name);
  const valid = isValidSkillName(slug);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!valid || busy) return;
    onCreate(slug, project ? scope : "user");
  };

  return (
    <form onSubmit={submit} className="px-2.5 py-2">
      <p className="mb-2 text-[11px] text-content/50">Writes a starter SKILL.md you can edit.</p>
      <input
        ref={input}
        value={name}
        spellCheck={false}
        placeholder="skill-name"
        aria-label="Skill name"
        disabled={busy}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== "Escape") return;
          e.preventDefault();
          onCancel();
        }}
        className="mb-2 w-full rounded-md bg-content/10 px-2 py-1.5 font-mono text-[13px] text-content outline-none placeholder:text-content/40"
      />
      <div className="mb-2 flex gap-1">
        <ScopeButton
          label="Project"
          hint=".agents/skills"
          selected={scope === "project"}
          disabled={!project || busy}
          onClick={() => setScope("project")}
        />
        <ScopeButton
          label="Personal"
          hint="~/.agents/skills"
          selected={scope === "user"}
          disabled={busy}
          onClick={() => setScope("user")}
        />
      </div>
      {error ? (
        <p className="mb-2 text-[12px] text-content/70">{error}</p>
      ) : !name.trim() || valid ? null : (
        <p className="mb-2 text-[12px] text-content/50">
          Use lowercase letters, numbers, and hyphens.
        </p>
      )}
      <div className="flex items-center justify-end gap-1">
        <button
          type="button"
          disabled={busy}
          onClick={onCancel}
          className="rounded-md px-2 py-1 text-[12px] text-content/50 hover:bg-content/10 hover:text-content"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={!valid || busy}
          className="rounded-md bg-content/20 px-2 py-1 text-[12px] text-content disabled:opacity-40"
        >
          {busy ? "Creating…" : "Create"}
        </button>
      </div>
    </form>
  );
}

function ScopeButton({
  label,
  hint,
  selected,
  disabled,
  onClick,
}: {
  label: string;
  hint: string;
  selected: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`flex min-w-0 flex-1 flex-col rounded-md px-2 py-1.5 text-left ${
        selected ? "bg-content/20 text-content" : "bg-content/10 text-content/70"
      } disabled:opacity-40`}
    >
      <span className="text-[12px]">{label}</span>
      <span className="truncate font-mono text-[10px] text-content/40">{hint}</span>
    </button>
  );
}

function scopeLabel(skill: Skill): string {
  if (skill.kind === "native") return skill.source;
  if (skill.kind === "builtin") return "wavex";
  if (skill.scope === "user") return "personal";
  if (skill.source !== "agents" && skill.source !== "wavex") return skill.source;
  return "project";
}

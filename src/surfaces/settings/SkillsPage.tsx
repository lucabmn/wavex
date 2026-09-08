import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AgentMarkdown } from "../AgentMarkdown";
import { InstallSkillDialog } from "../../chrome/InstallSkillDialog";
import { Copy, Cube, FolderOpen, Loader, Pencil, Plus, Search, Trash2 } from "../../chrome/icons";
import { Toggle } from "../../chrome/SettingsRow";
import { copyText } from "../../lib/clipboard";
import { invalidateProjectFiles } from "../../lib/files/fileIndex";
import { readTextFile, revealPath, writeTextFile } from "../../lib/fs";
import type { HostId } from "../../lib/host";
import { LAYER } from "../../lib/layers";
import { prettyCwd } from "../../lib/paths";
import { invalidateSkills } from "../../lib/skills";
import {
  deleteSkills,
  formatSkillBytes,
  formatSkillUpdated,
  groupSkillDetails,
  listSkillDetails,
  matchesSkillFilter,
  parseSkillFilter,
  rankSkillDetails,
  setSkillEnabled,
  skillFilterOptions,
  skillHostId,
  skillManagedBy,
  skillSourceLabel,
  skillSubtitle,
  type SkillDetail,
} from "../../lib/skillLibrary";
import { useDialogFocus } from "../../hooks/useDialogFocus";
import { useLockOverscroll } from "../../hooks/useLockOverscroll";

/**
 * The installed skill library: what every agent CLI on this machine can load,
 * where each skill lives, and the three things that can be done to one —
 * switch it off, edit its `SKILL.md`, delete it.
 *
 * It is the one settings page that is a list beside a detail rather than a
 * column of rows, so it opts out of the shared page frame.
 */
export function SkillsPage({ cwd }: { cwd: string }) {
  const hostId = useMemo(() => skillHostId(cwd), [cwd]);
  const [details, setDetails] = useState<SkillDetail[] | null>(null);
  const [query, setQuery] = useState("");
  const [filterValue, setFilterValue] = useState("all");
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [installing, setInstalling] = useState(false);

  const refresh = useCallback(async () => {
    const next = await listSkillDetails(cwd, hostId).catch(() => []);
    setDetails(next);
  }, [cwd, hostId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const filter = useMemo(() => parseSkillFilter(filterValue), [filterValue]);
  const filterOptions = useMemo(() => skillFilterOptions(details ?? []), [details]);
  const visible = useMemo(() => {
    const matching = (details ?? []).filter((detail) => matchesSkillFilter(detail, filter));
    return rankSkillDetails(matching, query);
  }, [details, filter, query]);
  const groups = useMemo(() => groupSkillDetails(visible), [visible]);
  const selected = useMemo(
    () => visible.find((detail) => detail.name === selectedName) ?? visible[0] ?? null,
    [visible, selectedName],
  );

  const onChanged = useCallback(async () => {
    invalidateSkills({ cwd });
    invalidateProjectFiles(cwd);
    await refresh();
  }, [cwd, refresh]);

  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <SkillList
        groups={groups}
        count={visible.length}
        loading={details === null}
        query={query}
        onQuery={setQuery}
        filterValue={filterValue}
        filterOptions={filterOptions}
        onFilter={setFilterValue}
        selectedName={selected?.name ?? null}
        onSelect={setSelectedName}
        onAdd={() => setInstalling(true)}
      />
      {selected ? (
        <SkillDetailPane
          key={selected.name}
          cwd={cwd}
          skill={selected}
          hostId={hostId}
          onChanged={onChanged}
        />
      ) : (
        <div className="flex min-w-0 flex-1 items-center justify-center px-8 text-[13.5px] text-content/40">
          {details === null ? "Reading skill folders…" : "No skill matches."}
        </div>
      )}
      {installing ? (
        <InstallSkillDialog
          cwd={cwd}
          onCancel={() => setInstalling(false)}
          onInstalled={() => void onChanged()}
        />
      ) : null}
    </div>
  );
}

function SkillList({
  groups,
  count,
  loading,
  query,
  onQuery,
  filterValue,
  filterOptions,
  onFilter,
  selectedName,
  onSelect,
  onAdd,
}: {
  groups: { scope: string; label: string; skills: SkillDetail[] }[];
  count: number;
  loading: boolean;
  query: string;
  onQuery: (value: string) => void;
  filterValue: string;
  filterOptions: { value: string; label: string }[];
  onFilter: (value: string) => void;
  selectedName: string | null;
  onSelect: (name: string) => void;
  onAdd: () => void;
}) {
  const lockOverscroll = useLockOverscroll<HTMLDivElement>();

  return (
    <div className="flex w-64 shrink-0 flex-col border-r border-edge">
      <div className="flex shrink-0 flex-col gap-2 p-2">
        <div className="flex items-center gap-1.5 rounded-md border border-edge bg-content/5 px-2 py-1.5 focus-within:border-edge-strong">
          <Search className="size-3.5 shrink-0 text-content/35" strokeWidth={1.75} />
          <input
            value={query}
            onChange={(event) => onQuery(event.target.value)}
            spellCheck={false}
            placeholder="Search skills…"
            aria-label="Search skills"
            className="min-w-0 flex-1 bg-transparent text-[12.5px] text-content outline-none placeholder:text-content/35"
          />
        </div>
        <div className="flex items-center gap-1.5">
          <select
            aria-label="Filter skills"
            value={filterValue}
            onChange={(event) => onFilter(event.target.value)}
            className="h-7 min-w-0 flex-1 rounded-md border border-edge bg-content/5 px-2 text-[12.5px] text-content outline-none hover:border-edge-strong"
          >
            {filterOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={onAdd}
            aria-label="Add a skill"
            title="Add a skill"
            className="flex size-7 shrink-0 items-center justify-center rounded-md border border-edge bg-content/5 text-content/60 hover:text-content"
          >
            <Plus className="size-3.5" strokeWidth={1.75} />
          </button>
        </div>
      </div>

      <div
        ref={lockOverscroll}
        className="min-h-0 flex-1 overflow-y-auto overscroll-none px-2 pb-2"
      >
        {groups.map((group) => (
          <div key={group.scope} className="flex flex-col gap-px pb-2">
            <div className="flex items-baseline gap-1.5 px-2 pb-1 pt-2">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-content/40">
                {group.label}
              </span>
              <span className="text-[10px] text-content/30">{group.skills.length}</span>
            </div>
            {group.skills.map((skill) => (
              <button
                key={skill.name}
                type="button"
                aria-current={skill.name === selectedName ? "true" : undefined}
                onClick={() => onSelect(skill.name)}
                className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left ${
                  skill.name === selectedName ? "bg-content/10" : "hover:bg-hover"
                }`}
              >
                <Cube
                  className={`size-4 shrink-0 ${skill.enabled ? "text-content/50" : "text-content/25"}`}
                  strokeWidth={1.75}
                />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span
                    className={`truncate text-[12.5px] leading-tight ${
                      skill.enabled ? "text-content" : "text-content/40 line-through"
                    }`}
                  >
                    {skill.name}
                  </span>
                  <span className="truncate text-[11.5px] leading-tight text-content/40">
                    {skill.description || "No description"}
                  </span>
                </span>
              </button>
            ))}
          </div>
        ))}
      </div>

      <div className="shrink-0 border-t border-edge px-3 py-2 text-center text-[11.5px] text-content/35">
        {loading ? "Reading…" : count === 1 ? "1 skill" : `${count} skills`}
      </div>
    </div>
  );
}

function SkillDetailPane({
  cwd,
  skill,
  hostId,
  onChanged,
}: {
  cwd: string;
  skill: SkillDetail;
  hostId: HostId;
  onChanged: () => Promise<void>;
}) {
  const lockOverscroll = useLockOverscroll<HTMLDivElement>();
  const [body, setBody] = useState<string | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const source = skill.installs[0];
  const managedBy = skillManagedBy(skill);

  useEffect(() => {
    if (!source) return;
    let cancelled = false;
    setBody(null);
    readTextFile(source.path, hostId).then(
      (text) => {
        if (!cancelled) setBody(text);
      },
      () => {
        if (!cancelled) setBody("");
      },
    );
    return () => {
      cancelled = true;
    };
  }, [source, hostId]);

  const dirs = useMemo(() => skill.installs.map((install) => install.dir), [skill]);

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const onToggle = (next: boolean) =>
    void run(async () => {
      await setSkillEnabled(cwd, dirs, next, hostId);
      await onChanged();
    });

  const onSave = () =>
    void run(async () => {
      if (draft === null || !source) return;
      await writeTextFile(source.path, draft, hostId);
      setBody(draft);
      setDraft(null);
      await onChanged();
    });

  const onDelete = () =>
    void run(async () => {
      setConfirming(false);
      await deleteSkills(cwd, dirs, hostId);
      await onChanged();
    });

  return (
    <div ref={lockOverscroll} className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-none">
      <div className="flex flex-col gap-4 px-6 py-6">
        <header className="flex items-start gap-3">
          <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md bg-content/8">
            <Cube className="size-4 text-content/60" strokeWidth={1.75} />
          </span>
          <div className="flex min-w-0 flex-1 flex-col">
            <h2 className="truncate text-[16px] font-semibold leading-tight text-content">
              {skill.name}
            </h2>
            <p className="mt-0.5 truncate text-[12.5px] leading-tight text-content/45">
              {skillSubtitle(skill)}
            </p>
          </div>
          {managedBy ? null : (
            <Toggle
              label={`Enable ${skill.name}`}
              on={skill.enabled}
              onChange={busy ? () => undefined : onToggle}
            />
          )}
        </header>

        {skill.description ? (
          <p className="text-[13.5px] leading-relaxed text-content/70">{skill.description}</p>
        ) : null}

        <dl className="flex flex-col">
          <DetailRow label="Invoke">
            <code className="font-mono text-[12.5px] text-content/80">/{skill.name}</code>
          </DetailRow>
          {skill.installs.map((install) => (
            <DetailRow
              key={install.dir}
              label={skillSourceLabel(install.source)}
              title={install.dir}
            >
              <span className="truncate font-mono text-[12.5px] text-content/55">
                {prettyCwd(install.dir)}
              </span>
            </DetailRow>
          ))}
          <DetailRow label="Contents">{formatSkillBytes(skill.bytes)}</DetailRow>
          <DetailRow label="Updated">{formatSkillUpdated(skill.updatedMs)}</DetailRow>
          {skill.tools.length > 0 ? (
            <DetailRow label="Tools">
              <span className="font-mono text-[12.5px] text-content/55">
                {skill.tools.join("  ")}
              </span>
            </DetailRow>
          ) : null}
        </dl>

        {managedBy ? (
          <p className="rounded-md border border-edge bg-content/5 px-3 py-2 text-[12.5px] leading-snug text-content/50">
            {managedBy} wavex lists it so you can see what your agents load; add, update, or remove
            it with the CLI that installed it.
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          {managedBy ? null : draft === null ? (
            <Action
              icon={Pencil}
              label="Edit SKILL.md"
              disabled={body === null}
              onClick={() => setDraft(body ?? "")}
            />
          ) : (
            <>
              <Action icon={Pencil} label="Save" disabled={busy} onClick={onSave} />
              <Action label="Cancel" onClick={() => setDraft(null)} />
            </>
          )}
          <Action
            icon={FolderOpen}
            label="Reveal"
            onClick={() => source && void revealPath(source.path, hostId)}
          />
          <Action
            icon={Copy}
            label="Copy path"
            onClick={() => source && void copyText(source.dir)}
          />
          <span className="flex-1" />
          {managedBy ? null : (
            <Action icon={Trash2} label="Delete" danger onClick={() => setConfirming(true)} />
          )}
        </div>

        {error ? <p className="text-[12.5px] leading-snug text-red-300">{error}</p> : null}

        <div className="flex flex-col gap-2 border-t border-edge pt-4">
          <span className="font-mono ui-label">
            {source ? source.path.split("/").pop() : "SKILL.md"}
          </span>
          {draft !== null ? (
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              spellCheck={false}
              aria-label={`${skill.name} SKILL.md`}
              className="min-h-96 w-full resize-y rounded-md border border-edge bg-content/5 p-3 font-mono text-[12.5px] leading-relaxed text-content outline-none focus:border-edge-strong"
            />
          ) : body === null ? (
            <span className="flex items-center gap-1.5 text-[12.5px] text-content/40">
              <Loader className="size-3.5 animate-spin" strokeWidth={1.75} />
              Reading…
            </span>
          ) : (
            <AgentMarkdown text={body} />
          )}
        </div>
      </div>

      {confirming ? (
        <DeleteSkillDialog
          skill={skill}
          onCancel={() => setConfirming(false)}
          onConfirm={onDelete}
        />
      ) : null}
    </div>
  );
}

function DetailRow({
  label,
  title,
  children,
}: {
  label: string;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline gap-4 border-b border-edge py-2 last:border-b-0">
      <dt className="w-24 shrink-0 text-[12.5px] text-content/40">{label}</dt>
      <dd className="min-w-0 flex-1 truncate text-[12.5px] text-content/70" title={title}>
        {children}
      </dd>
    </div>
  );
}

function Action({
  icon: Icon,
  label,
  danger = false,
  disabled = false,
  onClick,
}: {
  icon?: (props: { className?: string; strokeWidth?: number }) => React.ReactNode;
  label: string;
  danger?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[12.5px] disabled:opacity-40 ${
        danger
          ? "border-red-500/25 text-red-300 enabled:hover:bg-red-500/15"
          : "border-edge bg-content/5 text-content/70 enabled:hover:text-content"
      }`}
    >
      {Icon ? <Icon className="size-3.5" strokeWidth={1.75} /> : null}
      {label}
    </button>
  );
}

function DeleteSkillDialog({
  skill,
  onCancel,
  onConfirm,
}: {
  skill: SkillDetail;
  onCancel: () => void;
  onConfirm: () => void;
}) {
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
        aria-label={`Delete ${skill.name}`}
        onMouseDown={(event) => event.stopPropagation()}
        className="absolute left-1/2 top-[22%] flex w-[min(420px,calc(100vw-24px))] -translate-x-1/2 flex-col gap-3 rounded-lg border border-edge bg-content/5 p-4 shadow-xl backdrop-blur-xl"
      >
        <div className="flex flex-col gap-1">
          <h2 className="text-[13.5px] font-medium leading-tight text-content">
            Delete “{skill.name}”?
          </h2>
          <p className="text-[12.5px] leading-snug text-content/55">
            Its folder is removed from every agent directory below. This cannot be undone. Switch
            the skill off instead to keep it and take it out of circulation.
          </p>
          <ul className="mt-1 flex flex-col gap-0.5">
            {skill.installs.map((install) => (
              <li
                key={install.dir}
                className="truncate font-mono text-[11.5px] leading-tight text-content/40"
              >
                {prettyCwd(install.dir)}
              </li>
            ))}
          </ul>
        </div>

        <div className="flex justify-end gap-2">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            className="rounded-md px-3 py-1.5 text-[12.5px] text-content/70 hover:bg-hover hover:text-content"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="rounded-md bg-red-500/20 px-3 py-1.5 text-[12.5px] font-medium text-red-300 hover:bg-red-500/30"
          >
            Delete
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

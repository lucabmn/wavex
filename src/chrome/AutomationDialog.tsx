import { useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { CircleAlert } from "./icons";
import { ModelPicker } from "./ModelPicker";
import { Segmented, Toggle } from "./SettingsRow";
import { useDialogFocus } from "../hooks/useDialogFocus";
import { LAYER } from "../lib/layers";
import { CLOCK_STRIDE_COARSE, useNow } from "../lib/motion";
import { connectionSnapshot } from "../lib/transport";
import { isRemoteHostId, parseProjectRef } from "../lib/host";
import { prettyCwd, projectName } from "../lib/paths";
import { RUNTIME_MODES, RUNTIME_MODE_HINT, RUNTIME_MODE_LABEL } from "../lib/session";
import {
  AUTOMATION_NAME_MAX,
  MISSED_POLICIES,
  MISSED_POLICY_HINT,
  MISSED_POLICY_LABEL,
  OVERLAP_POLICIES,
  OVERLAP_POLICY_HINT,
  OVERLAP_POLICY_LABEL,
  validateAutomation,
  type Automation,
  type AutomationDraft,
} from "../lib/automations/automation";
import {
  DEFAULT_TIME,
  DST_POLICIES,
  DST_POLICY_HINT,
  DST_POLICY_LABEL,
  EVERY_DAY,
  describeSchedule,
  formatMoment,
  minEvery,
  upcomingRuns,
  type IntervalUnit,
  type Schedule,
  type Weekday,
} from "../lib/automations/schedule";
import { localTimeZone, wallToInstant, zonedParts } from "../lib/automations/zone";

type Props = {
  draft: AutomationDraft;
  /** Set when editing, so the title and the confirm step say so. */
  existing: Automation | null;
  /** Projects offered as targets, newest first. */
  projects: readonly string[];
  onClose: () => void;
  onSave: (draft: AutomationDraft) => Promise<void>;
};

/** Answered by typing, so their complaints wait for the blur. */
const TYPED_FIELDS = new Set(["name", "prompt"]);

const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const UNITS: IntervalUnit[] = ["minutes", "hours", "days", "weeks"];
const WEEKDAY_SET: Weekday[] = [1, 2, 3, 4, 5];

/** Time zones this machine knows, so a schedule is never written in an unusable one. */
function timeZones(): string[] {
  try {
    const supported = Intl.supportedValuesOf?.("timeZone");
    if (supported && supported.length > 0) return [...supported];
  } catch {
    // Older engines have no catalogue; the current zone still works.
  }
  return [localTimeZone(), "UTC"];
}

type ScheduleKind = Schedule["kind"];

/**
 * The structured schedule builder.
 *
 * Cron would be one field that covers all three shapes and is impossible to
 * preview honestly, which is why the sentence under the controls is generated
 * from the same value the automation stores rather than from the form.
 */
export function AutomationDialog({ draft, existing, projects, onClose, onSave }: Props) {
  const nameRef = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState<AutomationDraft>(draft);
  const [advanced, setAdvanced] = useState(false);
  /**
   * Which fields have been answered, and whether Save has been pressed. A
   * blank form is not a form full of mistakes: "Give this automation a name"
   * before a name could have been typed is scolding, not help.
   */
  const [touched, setTouched] = useState<ReadonlySet<string>>(() => new Set());
  const [submitted, setSubmitted] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useDialogFocus<HTMLFormElement>({
    onClose,
    initialFocusRef: nameRef,
    // The model menu is a portal outside this form, so while it is showing the
    // trap would keep it unreachable and Escape would close the dialog instead
    // of the menu.
    escapeDisabled: busy || pickerOpen,
    trapDisabled: pickerOpen,
  });

  // A coarse shared clock rather than `Date.now()` in the render body: a new
  // millisecond every keystroke would rebuild the preview on every character.
  const now = useNow(true, CLOCK_STRIDE_COARSE);
  const zones = useMemo(timeZones, []);
  const issues = useMemo(() => validateAutomation(form, now), [form, now]);
  const valid = issues.length === 0;
  const issueFor = (field: string) =>
    submitted || touched.has(field)
      ? issues.find((issue) => issue.field === field)?.message
      : undefined;
  const touch = (field: string) =>
    setTouched((prev) => (prev.has(field) ? prev : new Set(prev).add(field)));

  const upcoming = useMemo(
    () => (valid ? upcomingRuns(form.schedule, now, 3, form.timeZone, form.dstPolicy) : []),
    [form.dstPolicy, form.schedule, form.timeZone, now, valid],
  );

  const patch = (next: Partial<AutomationDraft>) => {
    setForm((prev) => ({ ...prev, ...next }));
    // Choosing a schedule or a run limit is one deliberate act, so its
    // complaint belongs right there. The two fields somebody types into wait
    // for the blur instead, or they would object to the first character.
    const keys = Object.keys(next).filter((key) => !TYPED_FIELDS.has(key));
    if (keys.length > 0) {
      setTouched((prev) => {
        const missing = keys.filter((key) => !prev.has(key));
        if (missing.length === 0) return prev;
        const out = new Set(prev);
        for (const key of missing) out.add(key);
        return out;
      });
    }
  };

  const setKind = (kind: ScheduleKind) => {
    if (kind === form.schedule.kind) return;
    if (kind === "interval") {
      patch({ schedule: { kind: "interval", every: 4, unit: "hours", anchorMs: now } });
    } else if (kind === "weekly") {
      patch({ schedule: { kind: "weekly", days: [...EVERY_DAY], time: DEFAULT_TIME } });
    } else {
      patch({ schedule: { kind: "once", atMs: now + 3_600_000 } });
    }
  };

  const target = parseProjectRef(form.projectRef);
  const host = target && isRemoteHostId(target.hostId) ? connectionSnapshot(target.hostId) : null;

  const selectProject = (value: string) => {
    const ref = parseProjectRef(value);
    if (!ref) return;
    patch({ projectRef: value, cwd: ref.path, hostId: ref.hostId });
  };

  const submit = () => {
    if (busy) return;
    // Pressing Save is the moment every remaining gap becomes worth naming.
    setSubmitted(true);
    if (!valid) return;
    // Enabling is the step that needs the resolved schedule, target, harness,
    // and prompt in front of the user. Saving it switched off does not.
    if (form.enabled && !confirming) {
      setConfirming(true);
      return;
    }
    setBusy(true);
    setError(null);
    void onSave(form)
      .then(onClose)
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err));
        setConfirming(false);
      })
      .finally(() => setBusy(false));
  };

  return createPortal(
    <div className="fixed inset-0" style={{ zIndex: LAYER.dialog }}>
      <div
        className="absolute inset-0 bg-black/30"
        onMouseDown={() => {
          if (!busy) onClose();
        }}
      />
      <form
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
        aria-modal="true"
        aria-label={existing ? `Edit automation ${existing.name}` : "New automation"}
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
        className="absolute left-1/2 top-[6%] flex max-h-[88vh] w-[min(560px,calc(100vw-24px))] -translate-x-1/2 flex-col rounded-lg border border-content/10 bg-content/5 shadow-xl backdrop-blur-xl"
      >
        <header className="shrink-0 px-4 pb-3 pt-4">
          <h2 className="text-[13px] font-medium leading-tight text-content">
            {existing ? "Edit automation" : "New automation"}
          </h2>
          <p className="mt-0.5 text-[12px] leading-snug text-content/55">
            A prompt wavex runs on a schedule. Each run is an ordinary session you can open.
          </p>
        </header>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-none px-4 pb-2">
          <Field label="Name" error={issueFor("name")}>
            <input
              ref={nameRef}
              value={form.name}
              disabled={busy}
              maxLength={AUTOMATION_NAME_MAX}
              placeholder="Nightly dependency check"
              onChange={(event) => patch({ name: event.target.value })}
              onBlur={() => touch("name")}
              className={FIELD}
            />
          </Field>

          <Field label="Prompt" error={issueFor("prompt")}>
            <textarea
              value={form.prompt}
              rows={5}
              spellCheck={false}
              disabled={busy}
              placeholder="Check for outdated dependencies and open an issue for anything with a security advisory."
              onChange={(event) => patch({ prompt: event.target.value })}
              onBlur={() => touch("prompt")}
              className="max-h-[30vh] min-h-24 w-full resize-y rounded-md bg-content/10 px-2 py-1.5 font-mono text-[12px] leading-5 text-content outline-none placeholder:text-content/40"
            />
          </Field>

          <Field label="Project" error={issueFor("target")}>
            <select
              value={form.projectRef}
              disabled={busy}
              onChange={(event) => selectProject(event.target.value)}
              className={FIELD}
            >
              {form.projectRef && !projects.includes(form.projectRef) ? (
                <option value={form.projectRef}>{projectName(form.cwd)}</option>
              ) : null}
              {projects.map((path) => (
                <option key={path} value={path}>
                  {projectName(path)}
                </option>
              ))}
            </select>
            <p className="truncate text-[11px] leading-tight text-content/45">
              {prettyCwd(form.cwd)}
              {host ? ` · ${host.name}` : ""}
            </p>
            {host && host.phase !== "connected" ? (
              <Attention>
                {host.name} is not connected. Runs will be recorded as failed until it is.
              </Attention>
            ) : null}
          </Field>

          <Field label="Agent" error={issueFor("harness")}>
            <ModelPicker
              fill
              // The menu is anchored inside a dialog, so it has to outrank it.
              layer={LAYER.dialog + 1}
              harness={form.harness}
              model={form.model}
              onOpenChange={setPickerOpen}
              onChange={(harness, model) => patch({ harness, model })}
            />
          </Field>

          <Field label="Schedule" error={issueFor("schedule")}>
            <div className="flex flex-col gap-2">
              <Segmented
                label="Schedule kind"
                value={form.schedule.kind}
                options={[
                  { value: "interval", label: "Repeat" },
                  { value: "weekly", label: "Days" },
                  { value: "once", label: "Once" },
                ]}
                onChange={setKind}
              />
              {form.schedule.kind === "interval" ? (
                <IntervalFields
                  schedule={form.schedule}
                  disabled={busy}
                  onChange={(schedule) => patch({ schedule })}
                />
              ) : form.schedule.kind === "weekly" ? (
                <WeeklyFields
                  schedule={form.schedule}
                  disabled={busy}
                  onChange={(schedule) => patch({ schedule })}
                />
              ) : (
                <OnceFields
                  atMs={form.schedule.atMs}
                  timeZone={form.timeZone}
                  disabled={busy}
                  onChange={(atMs) => patch({ schedule: { kind: "once", atMs } })}
                />
              )}
            </div>
          </Field>

          <Field label="Time zone" error={issueFor("timeZone")}>
            <select
              value={form.timeZone}
              disabled={busy}
              onChange={(event) => patch({ timeZone: event.target.value })}
              className={FIELD}
            >
              {zones.map((zone) => (
                <option key={zone} value={zone}>
                  {zone}
                </option>
              ))}
            </select>
          </Field>

          <button
            type="button"
            aria-expanded={advanced}
            onClick={() => setAdvanced((open) => !open)}
            className="self-start rounded-md px-1 py-0.5 text-[12px] text-content/55 hover:text-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            {advanced ? "Hide options" : "More options"}
          </button>

          {advanced ? (
            <div className="flex flex-col gap-3 border-l border-content/10 pl-3">
              <Choice
                label="Permissions"
                value={form.runtimeMode}
                options={RUNTIME_MODES.map((mode) => ({
                  value: mode,
                  label: RUNTIME_MODE_LABEL[mode],
                  hint: RUNTIME_MODE_HINT[mode],
                }))}
                disabled={busy}
                onChange={(runtimeMode) => patch({ runtimeMode })}
              />
              <Choice
                label="While a run is still going"
                value={form.overlapPolicy}
                options={OVERLAP_POLICIES.map((policy) => ({
                  value: policy,
                  label: OVERLAP_POLICY_LABEL[policy],
                  hint: OVERLAP_POLICY_HINT[policy],
                }))}
                disabled={busy}
                onChange={(overlapPolicy) => patch({ overlapPolicy })}
              />
              <Choice
                label="If wavex was closed when it was due"
                value={form.missedPolicy}
                options={MISSED_POLICIES.map((policy) => ({
                  value: policy,
                  label: MISSED_POLICY_LABEL[policy],
                  hint: MISSED_POLICY_HINT[policy],
                }))}
                disabled={busy}
                onChange={(missedPolicy) => patch({ missedPolicy })}
              />
              {form.schedule.kind !== "once" ? (
                <Choice
                  label="When the clock skips the scheduled hour"
                  value={form.dstPolicy}
                  options={DST_POLICIES.map((policy) => ({
                    value: policy,
                    label: DST_POLICY_LABEL[policy],
                    hint: DST_POLICY_HINT[policy],
                  }))}
                  disabled={busy}
                  onChange={(dstPolicy) => patch({ dstPolicy })}
                />
              ) : null}
              <Field label="Stop after" error={issueFor("maxRuns") ?? issueFor("endAtMs")}>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="number"
                    min={1}
                    value={form.maxRuns ?? ""}
                    disabled={busy}
                    placeholder="runs"
                    aria-label="Maximum number of runs"
                    onChange={(event) =>
                      patch({
                        maxRuns: event.target.value ? Number(event.target.value) : undefined,
                      })
                    }
                    className={`${CONTROL} w-24`}
                  />
                  <span className="text-[12px] text-content/45">or on</span>
                  <input
                    type="date"
                    value={form.endAtMs ? isoDate(form.endAtMs, form.timeZone) : ""}
                    disabled={busy}
                    aria-label="Final date"
                    onChange={(event) =>
                      patch({
                        endAtMs: event.target.value
                          ? wallToInstant(
                              { ...parseIsoDate(event.target.value), hour: 23, minute: 59 },
                              form.timeZone,
                            ).ms
                          : undefined,
                      })
                    }
                    className={`${CONTROL} w-40`}
                  />
                </div>
              </Field>
              <div className="flex items-center justify-between gap-4">
                <span className="text-[12px] text-content/70">
                  Play a sound when a run finishes
                </span>
                <Toggle
                  label="Play a sound when a run finishes"
                  on={form.notify}
                  disabled={busy}
                  onChange={(notify) => patch({ notify })}
                />
              </div>
            </div>
          ) : null}

          <div className="rounded-md border border-content/10 bg-content/5 px-3 py-2.5">
            <p className="text-[12px] font-medium text-content">
              {describeSchedule(form.schedule, form.timeZone)}
            </p>
            {upcoming.length > 0 ? (
              <ul className="mt-1.5 flex flex-col gap-0.5">
                {upcoming.map((run, index) => (
                  <li key={run} className="text-[11.5px] leading-tight text-content/55">
                    {index === 0 ? "Next" : "Then"} · {formatMoment(run, form.timeZone)}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1.5 text-[11.5px] leading-tight text-content/45">
                Finish the form to see when this would run.
              </p>
            )}
            <p className="mt-2 text-[11px] leading-snug text-content/45">
              Schedules run only while this wavex is open
              {host ? `, with ${host.name} reachable` : ""}. There is no background service: an
              occurrence that comes due while it is closed follows the missed-run setting.
            </p>
          </div>

          <div className="flex items-start justify-between gap-4 pb-2">
            <span className="min-w-0 text-[12px] text-content/70">
              Run on this schedule
              <span className="block text-[11px] leading-tight text-content/45">
                You will confirm the resolved schedule and target before it starts.
              </span>
            </span>
            <Toggle
              label="Run on this schedule"
              on={form.enabled}
              disabled={busy}
              onChange={(enabled) => {
                setConfirming(false);
                patch({ enabled });
              }}
            />
          </div>
        </div>

        {error ? (
          <p className="shrink-0 border-t border-content/10 px-4 py-2 text-[12px] leading-4 text-red-400/90">
            {error}
          </p>
        ) : null}

        {confirming ? (
          <div className="shrink-0 border-t border-content/10 bg-content/5 px-4 py-3">
            <p className="text-[12px] font-medium text-content">Enable this automation?</p>
            <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[11.5px] leading-tight">
              <Fact label="Runs">{describeSchedule(form.schedule, form.timeZone)}</Fact>
              <Fact label="First run">
                {upcoming[0] ? formatMoment(upcoming[0], form.timeZone) : "—"}
              </Fact>
              <Fact label="In">{`${prettyCwd(form.cwd)}${host ? ` on ${host.name}` : ""}`}</Fact>
              <Fact label="With">{`${form.harness}${form.model ? ` · ${form.model}` : ""} · ${RUNTIME_MODE_LABEL[form.runtimeMode]}`}</Fact>
              <Fact label="Prompt">{form.prompt.trim()}</Fact>
            </dl>
            {form.runtimeMode !== "supervised" ? (
              <div className="mt-2">
                <Attention>
                  Nobody will be watching this run, and {RUNTIME_MODE_LABEL[form.runtimeMode]} lets
                  it act without asking.
                </Attention>
              </div>
            ) : null}
          </div>
        ) : null}

        <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-content/10 px-4 py-3">
          <button
            type="button"
            disabled={busy}
            onClick={() => (confirming ? setConfirming(false) : onClose())}
            className="rounded-md px-3 py-1.5 text-[12px] text-content/70 hover:bg-content/8 hover:text-content"
          >
            {confirming ? "Back" : "Cancel"}
          </button>
          <button
            type="submit"
            disabled={busy}
            className="halo-fill halo-focus rounded-lg px-3.5 py-1.5 text-[12px] font-medium disabled:opacity-40 disabled:shadow-none"
          >
            {busy
              ? "Saving…"
              : confirming
                ? "Confirm and enable"
                : form.enabled
                  ? "Review and enable"
                  : "Save"}
          </button>
        </footer>
      </form>
    </div>,
    document.body,
  );
}

/**
 * One height for every control in the form. A native `select` does not size
 * itself like a text input, so both are given the height rather than padding.
 * No width here: a class list that already said `w-full` would fight the
 * `w-24` a sized control adds, and which one won came down to stylesheet order.
 */
const CONTROL =
  "h-8 rounded-md bg-content/10 px-2 text-[13px] text-content outline-none placeholder:text-content/40";
const FIELD = `${CONTROL} w-full`;

function Field({ label, error, children }: { label: string; error?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[11px] uppercase tracking-wide text-content/45">{label}</span>
      {children}
      {error ? <p className="text-[11.5px] leading-snug text-red-400/90">{error}</p> : null}
    </div>
  );
}

/** Amber, for something true about the world rather than wrong about the form. */
function Attention({ children }: { children: ReactNode }) {
  return (
    <p className="flex items-start gap-1.5 text-[11.5px] leading-snug text-amber-300">
      <CircleAlert className="mt-px size-3 shrink-0" strokeWidth={1.75} />
      {children}
    </p>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-content/45">{label}</dt>
      <dd className="min-w-0 truncate text-content/80">{children}</dd>
    </>
  );
}

function Choice<T extends string>({
  label,
  value,
  options,
  disabled,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string; hint: string }[];
  disabled: boolean;
  onChange: (value: T) => void;
}) {
  const selected = options.find((option) => option.value === value);
  return (
    <Field label={label}>
      <select
        value={value}
        disabled={disabled}
        aria-label={label}
        onChange={(event) => onChange(event.target.value as T)}
        className={FIELD}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {selected ? (
        <p className="text-[11px] leading-snug text-content/45">{selected.hint}</p>
      ) : null}
    </Field>
  );
}

function IntervalFields({
  schedule,
  disabled,
  onChange,
}: {
  schedule: Extract<Schedule, { kind: "interval" }>;
  disabled: boolean;
  onChange: (schedule: Schedule) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[12px] text-content/45">Every</span>
      <input
        type="number"
        min={minEvery(schedule.unit)}
        value={schedule.every}
        disabled={disabled}
        aria-label="How often this repeats"
        onChange={(event) => onChange({ ...schedule, every: Number(event.target.value) })}
        className={`${CONTROL} w-24`}
      />
      <select
        value={schedule.unit}
        disabled={disabled}
        aria-label="Interval unit"
        onChange={(event) => {
          const unit = event.target.value as IntervalUnit;
          onChange({ ...schedule, unit, every: Math.max(schedule.every, minEvery(unit)) });
        }}
        className={`${CONTROL} w-32`}
      >
        {UNITS.map((unit) => (
          <option key={unit} value={unit}>
            {unit}
          </option>
        ))}
      </select>
    </div>
  );
}

function WeeklyFields({
  schedule,
  disabled,
  onChange,
}: {
  schedule: Extract<Schedule, { kind: "weekly" }>;
  disabled: boolean;
  onChange: (schedule: Schedule) => void;
}) {
  const toggle = (day: Weekday) => {
    const has = schedule.days.includes(day);
    const days = has ? schedule.days.filter((entry) => entry !== day) : [...schedule.days, day];
    onChange({ ...schedule, days: days.sort((a, b) => a - b) });
  };
  return (
    <div className="flex flex-col gap-2">
      <div role="group" aria-label="Days of the week" className="flex flex-wrap gap-1">
        {DAY_SHORT.map((name, index) => {
          const day = index as Weekday;
          const on = schedule.days.includes(day);
          return (
            <button
              key={name}
              type="button"
              disabled={disabled}
              aria-pressed={on}
              onClick={() => toggle(day)}
              className={`rounded-md px-2 py-1 text-[11.5px] transition-colors ${
                on
                  ? "bg-accent/16 text-content"
                  : "text-content/45 hover:bg-content/8 hover:text-content/75"
              }`}
            >
              {name}
            </button>
          );
        })}
      </div>
      <div className="flex items-center gap-1">
        <button
          type="button"
          disabled={disabled}
          onClick={() => onChange({ ...schedule, days: [...EVERY_DAY] })}
          className="rounded-md px-2 py-1 text-[11.5px] text-content/45 hover:bg-content/8 hover:text-content/75"
        >
          Every day
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => onChange({ ...schedule, days: [...WEEKDAY_SET] })}
          className="rounded-md px-2 py-1 text-[11.5px] text-content/45 hover:bg-content/8 hover:text-content/75"
        >
          Weekdays
        </button>
        <span className="ml-auto text-[12px] text-content/45">at</span>
        <input
          type="time"
          value={schedule.time}
          disabled={disabled}
          aria-label="Time of day"
          onChange={(event) => onChange({ ...schedule, time: event.target.value })}
          className={`${CONTROL} w-32`}
        />
      </div>
    </div>
  );
}

function OnceFields({
  atMs,
  timeZone,
  disabled,
  onChange,
}: {
  atMs: number;
  timeZone: string;
  disabled: boolean;
  onChange: (atMs: number) => void;
}) {
  const parts = zonedParts(atMs, timeZone);
  const date = isoDate(atMs, timeZone);
  const time = `${pad(parts.hour)}:${pad(parts.minute)}`;
  const move = (nextDate: string, nextTime: string) => {
    const day = parseIsoDate(nextDate);
    const [hour, minute] = nextTime.split(":").map(Number);
    onChange(wallToInstant({ ...day, hour: hour || 0, minute: minute || 0 }, timeZone).ms);
  };
  return (
    <div className="flex items-center gap-2">
      <input
        type="date"
        value={date}
        disabled={disabled}
        aria-label="Date"
        onChange={(event) => move(event.target.value, time)}
        className={`${CONTROL} w-44`}
      />
      <span className="text-[12px] text-content/45">at</span>
      <input
        type="time"
        value={time}
        disabled={disabled}
        aria-label="Time"
        onChange={(event) => move(date, event.target.value)}
        className={`${CONTROL} w-32`}
      />
    </div>
  );
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function isoDate(ms: number, timeZone: string): string {
  const parts = zonedParts(ms, timeZone);
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
}

function parseIsoDate(value: string): { year: number; month: number; day: number } {
  const [year, month, day] = value.split("-").map(Number);
  return { year: year || 1970, month: month || 1, day: day || 1 };
}

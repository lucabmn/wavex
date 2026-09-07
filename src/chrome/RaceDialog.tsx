import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import {
  getHarnessAvailabilitySnapshot,
  hasProbedHarnessAvailability,
  isHarnessAvailable,
  probeHarnessAvailability,
  subscribeHarnessAvailability,
} from "../lib/harness/availability";
import { isLiveHarness } from "../lib/harness/registry";
import {
  getModelSnapshot,
  isPickerProviderVisible,
  modelsFor,
  preferredModelId,
  subscribeModels,
} from "../lib/models";
import {
  canRace,
  RACE_MAX_RUNNERS,
  RACE_MIN_RUNNERS,
  validateRaceRunners,
  type RaceRunnerChoice,
} from "../lib/race";
import { HARNESS_TITLE, HARNESSES, type HarnessId } from "../lib/session";
import { HarnessIcon } from "./HarnessIcon";
import { X } from "./icons";

type Props = {
  cwd: string;
  initialPrompt: string;
  onClose: () => void;
  onStart: (prompt: string, runners: RaceRunnerChoice[]) => void;
};

/**
 * Composer action "Race prompt...": pick 2–3 installed harnesses (through the
 * registry and availability probe only, never a provider adapter) plus one
 * model per runner, then fire the same prompt at all of them.
 */
export function RaceDialog({ cwd, initialPrompt, onClose, onStart }: Props) {
  const availabilityVersion = useSyncExternalStore(
    subscribeHarnessAvailability,
    getHarnessAvailabilitySnapshot,
    getHarnessAvailabilitySnapshot,
  );
  const catalogVersion = useSyncExternalStore(subscribeModels, getModelSnapshot, getModelSnapshot);
  const [prompt, setPrompt] = useState(initialPrompt);
  const [picked, setPicked] = useState<HarnessId[]>([]);
  const [models, setModels] = useState<Partial<Record<HarnessId, string>>>({});

  useEffect(() => {
    void probeHarnessAvailability();
  }, []);

  const probed = hasProbedHarnessAvailability();
  const candidates = useMemo(() => {
    void availabilityVersion;
    return HARNESSES.filter(
      (id) =>
        isLiveHarness(id) && isPickerProviderVisible(id) && (!probed || isHarnessAvailable(id)),
    );
  }, [probed, availabilityVersion]);
  void catalogVersion;
  void cwd;

  const gate = canRace(
    HARNESSES.filter((id) => isLiveHarness(id) && isHarnessAvailable(id)).length,
    probed,
  );

  const toggle = (id: HarnessId) => {
    setPicked((prev) => {
      if (prev.includes(id)) return prev.filter((entry) => entry !== id);
      if (prev.length >= RACE_MAX_RUNNERS) return prev;
      return [...prev, id];
    });
    setModels((prev) => (prev[id] ? prev : { ...prev, [id]: preferredModelId(id) }));
  };

  const runners: RaceRunnerChoice[] = picked.map((harness) => ({
    harness,
    model: models[harness] ?? preferredModelId(harness),
  }));
  const error = validateRaceRunners(runners, { installed: isHarnessAvailable, probed });
  const promptError = prompt.trim() ? null : "Write the prompt to race first.";

  const start = () => {
    if (error || promptError) return;
    onStart(prompt.trim(), runners);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Race prompt"
      className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-content/10 bg-background-base shadow-2xl">
        <div className="flex h-11 shrink-0 items-center gap-2 border-b border-content/10 px-3">
          <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-content">
            Race prompt
          </span>
          <span className="shrink-0 font-mono text-[11px] text-content/40">
            {RACE_MIN_RUNNERS}–{RACE_MAX_RUNNERS} runners
          </span>
          <button
            type="button"
            title="Close"
            aria-label="Close"
            onClick={onClose}
            className="grid size-6 shrink-0 place-items-center rounded-md text-content/45 hover:bg-content/10 hover:text-content"
          >
            <X className="size-3.5" strokeWidth={1.75} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {gate.emptyState ? (
            <p className="rounded-lg border border-content/10 bg-content/[0.03] px-3 py-4 text-[13px] text-content/60">
              {gate.emptyState}
            </p>
          ) : (
            <>
              <label
                htmlFor="race-prompt"
                className="mb-1 block text-[11px] font-medium tracking-wide text-content/40 uppercase"
              >
                Same prompt for every runner
              </label>
              <textarea
                id="race-prompt"
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                rows={4}
                placeholder="What should every agent try?"
                className="mb-3 w-full resize-y rounded-lg border border-content/15 bg-content/[0.03] px-2.5 py-2 text-[13px] text-content outline-none placeholder:text-content/30 focus:border-accent"
              />
              <p className="mb-1 text-[11px] font-medium tracking-wide text-content/40 uppercase">
                Runners share this checkout
              </p>
              <div className="flex flex-col gap-1">
                {candidates.map((id) => {
                  const active = picked.includes(id);
                  const options = modelsFor(id);
                  return (
                    <div
                      key={id}
                      className={`flex items-center gap-2 rounded-lg border px-2 py-1.5 ${
                        active ? "border-accent/50 bg-accent/5" : "border-content/10"
                      }`}
                    >
                      <button
                        type="button"
                        role="checkbox"
                        aria-checked={active}
                        aria-label={`Race with ${HARNESS_TITLE[id]}`}
                        onClick={() => toggle(id)}
                        className="flex min-w-0 flex-1 items-center gap-2 text-left"
                      >
                        <span
                          aria-hidden
                          className={`grid size-4 shrink-0 place-items-center rounded border text-[10px] ${
                            active ? "border-accent bg-accent text-white" : "border-content/25"
                          }`}
                        >
                          {active ? "✓" : ""}
                        </span>
                        <HarnessIcon harness={id} className="size-4 shrink-0" />
                        <span className="truncate text-[13px] text-content">
                          {HARNESS_TITLE[id]}
                        </span>
                      </button>
                      {active && options.length > 0 ? (
                        <select
                          aria-label={`${HARNESS_TITLE[id]} model`}
                          value={models[id] ?? preferredModelId(id)}
                          onChange={(event) =>
                            setModels((prev) => ({ ...prev, [id]: event.target.value }))
                          }
                          className="max-w-44 shrink-0 rounded-md border border-content/15 bg-background-base px-1.5 py-1 text-[12px] text-content outline-none"
                        >
                          {options.map((option) => (
                            <option key={option.id} value={option.id}>
                              {option.name}
                            </option>
                          ))}
                        </select>
                      ) : null}
                    </div>
                  );
                })}
              </div>
              {candidates.length === 0 && probed ? (
                <p className="mt-2 text-[12px] text-content/50">
                  No installed providers found. Install an agent CLI and restart wavex.
                </p>
              ) : null}
            </>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2 border-t border-content/10 px-3 py-2.5">
          <span className="min-w-0 flex-1 truncate text-[12px] text-content/45">
            {promptError ??
              error ??
              `${runners.length} runner${runners.length === 1 ? "" : "s"} ready`}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-md px-2.5 py-1.5 text-[12.5px] text-content/60 hover:bg-content/8 hover:text-content"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!!error || !!promptError || !!gate.emptyState}
            onClick={start}
            className="shrink-0 rounded-md bg-accent px-3 py-1.5 text-[12.5px] font-medium text-white disabled:opacity-40"
          >
            Start race
          </button>
        </div>
      </div>
    </div>
  );
}

import { useEffect, useState, useSyncExternalStore } from "react";
import { HarnessIcon } from "../chrome/HarnessIcon";
import { basename } from "../lib/fs";
import {
  getHarnessAvailabilitySnapshot,
  harnessUnavailableHint,
  hasProbedHarnessAvailability,
  isHarnessAvailable,
  probeHarnessAvailability,
  subscribeHarnessAvailability,
} from "../lib/harness/availability";
import { LAYER } from "../lib/layers";
import { looksLikeProject } from "../lib/recents";
import { HARNESSES, HARNESS_TITLE } from "../lib/session";

type Props = {
  /** Current project path; a non-project cwd starts the wizard on step 0. */
  cwd: string;
  onPickProject: () => void;
  onComplete: () => void;
};

const STEPS = ["Project", "Coding agents", "Ready"] as const;

/**
 * First-run setup. wavex drives the coding-agent CLIs installed on this
 * machine, so a new install needs two things before the blank composer makes
 * sense: a project to work in and at least one CLI wavex can see. Three
 * steps, skippable, never shown again once completed or skipped.
 */
export function OnboardingView({ cwd, onPickProject, onComplete }: Props) {
  const [step, setStep] = useState(0);
  const project = looksLikeProject(cwd) ? basename(cwd) : null;

  return (
    <div
      className="fixed inset-0 flex items-center justify-center bg-black/50 p-4"
      style={{ zIndex: LAYER.dialog }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="onboarding-title"
        className="flex w-[min(480px,calc(100vw-32px))] flex-col overflow-hidden rounded-2xl border border-content/10 bg-background-base shadow-2xl"
      >
        <div className="flex items-center gap-1.5 px-5 pt-4">
          {STEPS.map((label, index) => (
            <div key={label} className="flex flex-1 items-center gap-1.5">
              <div className="flex flex-1 flex-col gap-1">
                <span
                  className={`text-[11px] font-medium ${
                    index === step ? "text-content" : "text-content/35"
                  }`}
                >
                  {label}
                </span>
                <span
                  className={`h-1 rounded-full ${index <= step ? "bg-accent" : "bg-content/10"}`}
                />
              </div>
            </div>
          ))}
        </div>

        <div className="px-5 py-4">
          {step === 0 ? (
            <ProjectStep project={project} onPickProject={onPickProject} />
          ) : step === 1 ? (
            <AgentsStep />
          ) : (
            <ReadyStep project={project} />
          )}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-content/10 px-5 py-3">
          <span className="text-[11px] text-content/35">Step {step + 1} of 3</span>
          <div className="flex gap-2">
            {step > 0 ? (
              <button
                type="button"
                onClick={() => setStep(step - 1)}
                className="rounded-md px-3 py-1.5 text-[12px] text-content/70 hover:bg-content/5 hover:text-content"
              >
                Back
              </button>
            ) : null}
            {step < 2 ? (
              <button
                type="button"
                onClick={() => setStep(step + 1)}
                className="rounded-md bg-content px-3 py-1.5 text-[12px] font-medium text-background-base hover:bg-content/80"
              >
                {step === 0 && !project ? "Continue without a project" : "Continue"}
              </button>
            ) : (
              <button
                type="button"
                // oxlint-disable-next-line jsx-a11y/no-autofocus -- the dialog exists to finish setup
                autoFocus
                onClick={onComplete}
                className="rounded-md bg-content px-3 py-1.5 text-[12px] font-medium text-background-base hover:bg-content/80"
              >
                Start working
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ProjectStep({
  project,
  onPickProject,
}: {
  project: string | null;
  onPickProject: () => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <h1 id="onboarding-title" className="text-lg font-semibold text-content">
        Where is your code?
      </h1>
      <p className="text-[12.5px] leading-relaxed text-content/60">
        wavex works in your real checkout — pick the project folder you want to start in. You can
        switch projects anytime afterwards.
      </p>
      <button
        type="button"
        onClick={onPickProject}
        className="flex items-center justify-between rounded-lg border border-content/15 bg-content/5 px-3 py-2.5 text-left hover:bg-content/10"
      >
        <span className="min-w-0">
          <span className="block text-[12.5px] font-medium text-content">
            {project ?? "Choose a project folder…"}
          </span>
          <span className="block text-[11.5px] text-content/45">
            {project ? "Looks good, or pick a different folder" : "Opens a folder picker"}
          </span>
        </span>
        <span aria-hidden className="shrink-0 text-content/40">
          →
        </span>
      </button>
    </div>
  );
}

function AgentsStep() {
  useSyncExternalStore(subscribeHarnessAvailability, getHarnessAvailabilitySnapshot);
  const [probing, setProbing] = useState(!hasProbedHarnessAvailability());

  useEffect(() => {
    let live = true;
    setProbing(true);
    void probeHarnessAvailability()
      .catch(() => undefined)
      .finally(() => {
        if (live) setProbing(false);
      });
    return () => {
      live = false;
    };
  }, []);

  const found = HARNESSES.filter((id) => isHarnessAvailable(id));
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-2">
        <h1 id="onboarding-title" className="text-lg font-semibold text-content">
          Coding agents
        </h1>
        <button
          type="button"
          disabled={probing}
          onClick={() => {
            setProbing(true);
            void probeHarnessAvailability({ force: true })
              .catch(() => undefined)
              .finally(() => setProbing(false));
          }}
          className="shrink-0 text-[12px] text-content/55 hover:text-content disabled:opacity-50"
        >
          {probing ? "Scanning…" : "Rescan"}
        </button>
      </div>
      <p className="text-[12.5px] leading-relaxed text-content/60">
        wavex uses your own subscriptions — sign in stays in the CLI, never in wavex.{" "}
        {found.length === 0 && !probing ? "Nothing found yet." : ""}
      </p>
      <ul className="flex max-h-56 flex-col gap-1 overflow-y-auto overscroll-none">
        {HARNESSES.map((id) => {
          const available = isHarnessAvailable(id);
          return (
            <li
              key={id}
              className="flex items-center gap-2 rounded-md border border-content/10 bg-content/5 px-2.5 py-1.5"
            >
              <HarnessIcon harness={id} className="size-4 shrink-0" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12.5px] text-content">
                  {HARNESS_TITLE[id]}
                </span>
                {!available && hasProbedHarnessAvailability() ? (
                  <span className="block truncate font-mono text-[11px] text-content/45">
                    {harnessUnavailableHint(id)}
                  </span>
                ) : null}
              </span>
              <span
                className={`size-2 shrink-0 rounded-full ${
                  available ? "bg-green-500" : "bg-content/20"
                }`}
                aria-label={available ? "Installed" : "Not found"}
                title={available ? "Installed" : "Not found"}
              />
            </li>
          );
        })}
      </ul>
      <p className="text-[11.5px] leading-snug text-content/45">
        Missing one? Install it, then hit Rescan. You can finish setup now and add CLIs later.
      </p>
    </div>
  );
}

function ReadyStep({ project }: { project: string | null }) {
  return (
    <div className="flex flex-col gap-3">
      <h1 id="onboarding-title" className="text-lg font-semibold text-content">
        You are set{project ? ` for ${project}` : ""}
      </h1>
      <p className="text-[12.5px] leading-relaxed text-content/60">A few things worth knowing:</p>
      <ul className="flex flex-col gap-1.5 text-[12.5px] leading-relaxed text-content/70">
        <li>
          <span className="font-mono text-content">⌘K</span> runs any command —{" "}
          <span className="font-mono text-content">@</span> jumps to a file,{" "}
          <span className="font-mono text-content">#</span> searches,{" "}
          <span className="font-mono text-content">?</span> lists every shortcut.
        </li>
        <li>
          <span className="font-mono text-content">Workspace</span> is the project surface;{" "}
          <span className="font-mono text-content">Chat</span> is plain chat without files or
          terminals.
        </li>
        <li>Approval requests pause the agent until you decide.</li>
      </ul>
    </div>
  );
}

import { useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { HarnessIcon } from "./HarnessIcon";
import { Loader } from "./icons";
import { LAYER } from "../lib/layers";
import { HARNESS_TITLE } from "../lib/session";
import {
  installSkills,
  skillInstallCommand,
  SKILL_CLI_AGENTS,
  type SkillInstallResult,
} from "../lib/skillLibrary";
import { isHarnessAvailable } from "../lib/harness/availability";
import { looksLikeProject } from "../lib/recents";
import { prettyCwd } from "../lib/paths";
import { useDialogFocus } from "../hooks/useDialogFocus";

type Props = {
  cwd: string;
  onCancel: () => void;
  onInstalled: () => void;
};

/**
 * Add a skill package by running the `skills` CLI.
 *
 * The agents and the scope are the two things that command needs and cannot
 * guess, so they are the dialog. The exact command line is shown because this
 * spawns a process that writes into the user's own agent directories.
 */
export function InstallSkillDialog({ cwd, onCancel, onInstalled }: Props) {
  const inProject = looksLikeProject(cwd);
  const [pkg, setPkg] = useState("");
  const [skills, setSkills] = useState("");
  const [global, setGlobal] = useState(!inProject);
  const [agents, setAgents] = useState<string[]>(() => {
    const available = SKILL_CLI_AGENTS.filter((agent) => isHarnessAvailable(agent.harness));
    return (available.length > 0 ? available : SKILL_CLI_AGENTS.slice(0, 1)).map(
      (agent) => agent.id,
    );
  });
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SkillInstallResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const packageRef = useRef<HTMLInputElement>(null);
  const dialogRef = useDialogFocus<HTMLDivElement>({
    onClose: onCancel,
    initialFocusRef: packageRef,
    escapeDisabled: busy,
  });

  const skillNames = useMemo(
    () =>
      skills
        .split(/[\s,]+/)
        .map((name) => name.trim())
        .filter(Boolean),
    [skills],
  );
  const command = skillInstallCommand({
    package: pkg,
    agents,
    skills: skillNames.length > 0 ? skillNames : ["*"],
    global,
  });
  const ready = pkg.trim().length > 0 && agents.length > 0 && !busy;

  const toggleAgent = (id: string) => {
    setAgents((current) =>
      current.includes(id) ? current.filter((agent) => agent !== id) : [...current, id],
    );
  };

  const install = async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const answer = await installSkills({
        cwd,
        package: pkg.trim(),
        agents,
        skills: skillNames.length > 0 ? skillNames : ["*"],
        global,
      });
      setResult(answer);
      if (answer.ok) onInstalled();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0" style={{ zIndex: LAYER.dialog }}>
      <div className="absolute inset-0 bg-black/30" onMouseDown={busy ? undefined : onCancel} />
      <div
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
        aria-modal="true"
        aria-label="Add a skill"
        onMouseDown={(event) => event.stopPropagation()}
        className="absolute left-1/2 top-[14%] flex w-[min(560px,calc(100vw-24px))] flex-col gap-4 rounded-lg border border-edge bg-content/5 p-4 shadow-xl backdrop-blur-xl"
      >
        <div className="flex flex-col gap-1">
          <h2 className="text-[13.5px] font-medium leading-tight text-content">Add a skill</h2>
          <p className="text-[12.5px] leading-snug text-content/55">
            wavex runs the <code className="font-mono">skills</code> CLI. It writes the skill once
            and links it into each agent directory you pick.
          </p>
        </div>

        <label className="flex flex-col gap-1.5">
          <span className="text-[12.5px] text-content/60">Package</span>
          <input
            ref={packageRef}
            value={pkg}
            onChange={(event) => setPkg(event.target.value)}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            placeholder="owner/repo or a GitHub URL"
            className="rounded-md border border-edge bg-content/5 px-2 py-1.5 text-[13.5px] text-content outline-none placeholder:text-content/30 focus:border-edge-strong"
          />
        </label>

        <div className="flex flex-col gap-1.5">
          <span className="text-[12.5px] text-content/60">Agents</span>
          <div className="flex flex-wrap gap-1.5">
            {SKILL_CLI_AGENTS.map((agent) => {
              const on = agents.includes(agent.id);
              return (
                <button
                  key={agent.id}
                  type="button"
                  role="switch"
                  aria-checked={on}
                  onClick={() => toggleAgent(agent.id)}
                  className={`flex items-center gap-1.5 rounded-md border px-2 py-1 text-[12.5px] ${
                    on
                      ? "border-accent/40 bg-accent/15 text-content"
                      : "border-edge bg-content/5 text-content/55 hover:text-content"
                  }`}
                >
                  <HarnessIcon harness={agent.harness} className="size-3.5" />
                  {HARNESS_TITLE[agent.harness]}
                </button>
              );
            })}
          </div>
        </div>

        <label className="flex flex-col gap-1.5">
          <span className="text-[12.5px] text-content/60">Skills</span>
          <input
            value={skills}
            onChange={(event) => setSkills(event.target.value)}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            placeholder="Every skill in the package"
            className="rounded-md border border-edge bg-content/5 px-2 py-1.5 text-[13.5px] text-content outline-none placeholder:text-content/30 focus:border-edge-strong"
          />
        </label>

        <div className="flex flex-col gap-1.5">
          <span className="text-[12.5px] text-content/60">Scope</span>
          <div className="flex gap-1.5">
            <ScopeButton
              label="This project"
              detail={inProject ? prettyCwd(cwd) : "No project is open"}
              on={!global}
              disabled={!inProject}
              onClick={() => setGlobal(false)}
            />
            <ScopeButton
              label="Every project"
              detail="Your home directory"
              on={global}
              onClick={() => setGlobal(true)}
            />
          </div>
        </div>

        <pre className="overflow-x-auto rounded-md bg-content/5 px-2 py-1.5 font-mono text-[11.5px] leading-relaxed text-content/60">
          {command}
        </pre>

        {error ? <p className="text-[12.5px] leading-snug text-red-300">{error}</p> : null}
        {result ? (
          <div className="flex flex-col gap-1">
            <p
              className={`text-[12.5px] leading-snug ${result.ok ? "text-content/70" : "text-red-300"}`}
            >
              {result.ok ? "Installed." : "The skills CLI reported a problem."}
            </p>
            {result.output ? (
              <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-md bg-content/5 px-2 py-1.5 font-mono text-[11.5px] leading-relaxed text-content/55">
                {result.output}
              </pre>
            ) : null}
          </div>
        ) : null}

        <div className="flex items-center justify-end gap-2">
          {busy ? (
            <span className="mr-auto flex items-center gap-1.5 text-[12.5px] text-content/50">
              <Loader className="size-3.5 animate-spin" strokeWidth={1.75} />
              Running the skills CLI…
            </span>
          ) : null}
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md px-3 py-1.5 text-[12.5px] text-content/70 hover:bg-hover hover:text-content"
          >
            {result?.ok ? "Done" : "Cancel"}
          </button>
          <button
            type="button"
            disabled={!ready}
            onClick={() => void install()}
            className="rounded-md bg-accent/20 px-3 py-1.5 text-[12.5px] font-medium text-content disabled:opacity-40 enabled:hover:bg-accent/30"
          >
            Add
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function ScopeButton({
  label,
  detail,
  on,
  disabled = false,
  onClick,
}: {
  label: string;
  detail: string;
  on: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      disabled={disabled}
      onClick={onClick}
      className={`flex min-w-0 flex-1 flex-col items-start gap-0.5 rounded-md border px-2 py-1.5 text-left disabled:opacity-40 ${
        on
          ? "border-accent/40 bg-accent/15 text-content"
          : "border-edge bg-content/5 text-content/55 enabled:hover:text-content"
      }`}
    >
      <span className="text-[12.5px] font-medium">{label}</span>
      <span className="w-full truncate text-[11.5px] text-content/40">{detail}</span>
    </button>
  );
}

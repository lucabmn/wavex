import { useEffect, useSyncExternalStore } from "react";
import { Row, Section, Toggle } from "../../chrome/SettingsRow";
import {
  getLanguageServerAvailabilitySnapshot,
  languageServerBinary,
  probeLanguageServers,
  subscribeLanguageServerAvailability,
} from "../../lib/lsp/availability";
import {
  languageServerChoice,
  languageServerChoicesSnapshot,
  setLanguageServerEnabled,
  subscribeLanguageServerChoices,
} from "../../lib/lsp/enabled";
import {
  lspStatusSnapshot,
  stopLspServersFor,
  subscribeLspStatus,
  type LspServerStatus,
} from "../../lib/lsp/manager";
import { LANGUAGE_SERVERS } from "../../lib/lsp/servers";

/**
 * Language servers are found, not installed. The page reports what is on the
 * user's PATH and quotes the install line for what is not — the same posture
 * wavex takes with the agent CLIs.
 */
export function LanguageServersPage() {
  useSyncExternalStore(
    subscribeLanguageServerAvailability,
    getLanguageServerAvailabilitySnapshot,
    getLanguageServerAvailabilitySnapshot,
  );
  useSyncExternalStore(
    subscribeLanguageServerChoices,
    languageServerChoicesSnapshot,
    languageServerChoicesSnapshot,
  );
  const running = useSyncExternalStore(subscribeLspStatus, lspStatusSnapshot, lspStatusSnapshot);

  useEffect(() => {
    void probeLanguageServers();
  }, []);

  const onToggle = (serverId: string, enabled: boolean) => {
    setLanguageServerEnabled(serverId, enabled);
    // Turning one off stops it now rather than leaving it indexing until the
    // idle timer notices. Turning one on takes effect as files are opened.
    if (!enabled) void stopLspServersFor(serverId);
  };

  const installed = LANGUAGE_SERVERS.filter((server) => languageServerBinary(server.id));
  const missing = LANGUAGE_SERVERS.filter((server) => !languageServerBinary(server.id));

  return (
    <>
      <p className="pb-5 text-[12.5px] leading-relaxed text-content/45">
        wavex uses the language servers you already have installed and never downloads one. None run
        until you turn them on — the editor offers one the first time you open a file it covers. A
        server starts with the first such file, and stops when you close the project, switch
        profile, or quit.
      </p>

      {installed.length > 0 ? (
        <Section title="Installed" description="Found on your PATH and ready to be turned on.">
          {installed.map((server) => (
            <ServerRow key={server.id} serverId={server.id} running={running} onToggle={onToggle} />
          ))}
        </Section>
      ) : null}

      {missing.length > 0 ? (
        <Section title="Not installed" description="Install one and it moves up on the next probe.">
          {missing.map((server) => (
            <ServerRow key={server.id} serverId={server.id} running={running} onToggle={onToggle} />
          ))}
        </Section>
      ) : null}
    </>
  );
}

function ServerRow({
  serverId,
  running,
  onToggle,
}: {
  serverId: string;
  running: LspServerStatus[];
  onToggle: (serverId: string, enabled: boolean) => void;
}) {
  const server = LANGUAGE_SERVERS.find((entry) => entry.id === serverId);
  if (!server) return null;
  const binary = languageServerBinary(server.id);
  const live = running.filter((entry) => entry.serverId === server.id);
  const choice = languageServerChoice(server.id);
  const failure = live.find((entry) => entry.status.state === "failed")?.status;

  return (
    <Row
      label={server.name}
      description={
        // A failure says what went wrong, in the server's own words.
        // "Failed to start" alone leaves the user nowhere to go.
        failure?.state === "failed"
          ? failure.message
          : binary
            ? `Found ${binary}. Covers ${server.extensions.join(", ")}.`
            : `Not installed. Install it with \`${server.installHint}\`.`
      }
    >
      <span className="text-[11.5px] whitespace-nowrap text-content/50">
        {choice === "undecided" && live.length === 0
          ? "Not asked yet"
          : languageServerStateLabel(live)}
      </span>
      <Toggle
        label={`Use ${server.name}`}
        on={choice === "enabled"}
        disabled={!binary}
        onChange={(next) => onToggle(server.id, next)}
      />
    </Row>
  );
}

function languageServerStateLabel(running: LspServerStatus[]): string {
  if (running.length === 0) return "Not running";
  if (running.some((entry) => entry.status.state === "failed")) return "Failed to start";
  const ready = running.filter((entry) => entry.status.state === "ready").length;
  if (ready === 0) return "Starting…";
  return ready === 1 ? "Running" : `Running in ${ready} checkouts`;
}

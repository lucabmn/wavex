import { useSyncExternalStore, type ReactNode } from "react";
import { X } from "./icons";
import {
  getLanguageServerAvailabilitySnapshot,
  languageServerBinary,
  subscribeLanguageServerAvailability,
} from "../lib/lsp/availability";
import {
  languageServerChoice,
  languageServerChoicesSnapshot,
  setLanguageServerEnabled,
  subscribeLanguageServerChoices,
} from "../lib/lsp/enabled";
import { lspStatusSnapshot, retryLspServersFor, subscribeLspStatus } from "../lib/lsp/manager";
import type { LanguageServerDefinition } from "../lib/lsp/servers";

type Props = {
  server: LanguageServerDefinition;
  onAnswered: () => void;
  onRetry: () => void;
};

/**
 * What the editor says about its language server, when there is anything to
 * say.
 *
 * Two cases, and no third: the server has never been answered for, or the user
 * turned it on and it did not start. A server that is running says nothing —
 * the types, errors, and jumps are the message.
 */
export function LanguageServerBar({ server, onAnswered, onRetry }: Props) {
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

  const choice = languageServerChoice(server.id);
  const failure = running.find(
    (entry) => entry.serverId === server.id && entry.status.state === "failed",
  )?.status;

  if (choice === "enabled") {
    if (failure?.state !== "failed") return null;
    return (
      <Bar>
        <span className="min-w-0 flex-1 truncate text-content/70" title={failure.message}>
          {failure.message}
        </span>
        <BarButton
          onClick={() => {
            void retryLspServersFor(server.id).then(onRetry);
          }}
        >
          Retry
        </BarButton>
        <BarDismiss
          label={`Turn off ${server.name}`}
          title={`Turn off ${server.name}`}
          onClick={() => {
            setLanguageServerEnabled(server.id, false);
            onAnswered();
          }}
        />
      </Bar>
    );
  }

  if (choice === "disabled") return null;

  const installed = languageServerBinary(server.id) !== null;
  const answer = (enabled: boolean) => {
    setLanguageServerEnabled(server.id, enabled);
    onAnswered();
  };

  return (
    <Bar>
      <span className="min-w-0 flex-1 truncate text-content/70">
        {installed ? (
          <>
            Use <span className="font-medium text-content">{server.name}</span> for this project?
            Types, errors, and go to definition.
          </>
        ) : (
          <>
            <span className="font-medium text-content">{server.name}</span> isn’t installed —{" "}
            <span className="font-mono text-content/55">{server.installHint}</span>
          </>
        )}
      </span>
      {installed ? <BarButton onClick={() => answer(true)}>Enable</BarButton> : null}
      <BarDismiss
        // Not a dismissal: declining is an answer, and it is what stops the
        // offer coming back on every file of this language.
        label={installed ? `Don’t use ${server.name}` : `Dismiss ${server.name}`}
        title={`Don’t ask about ${server.name} again`}
        onClick={() => answer(false)}
      />
    </Bar>
  );
}

function Bar({ children }: { children: ReactNode }) {
  return (
    <header className="flex h-8 shrink-0 items-center gap-2 border-b border-content/10 px-3 text-[11.5px]">
      {children}
    </header>
  );
}

function BarButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="h-6 shrink-0 rounded-md bg-accent px-2 text-[11.5px] font-medium text-white"
    >
      {children}
    </button>
  );
}

function BarDismiss({
  label,
  title,
  onClick,
}: {
  label: string;
  title: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={title}
      className="grid size-6 shrink-0 place-items-center rounded-md text-content/45 hover:bg-content/8 hover:text-content"
    >
      <X className="size-3" strokeWidth={1.75} />
    </button>
  );
}

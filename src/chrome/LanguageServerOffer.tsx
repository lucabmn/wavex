import { useSyncExternalStore } from "react";
import { X } from "./icons";
import {
  getLanguageServerAvailabilitySnapshot,
  languageServerBinary,
  subscribeLanguageServerAvailability,
} from "../lib/lsp/availability";
import { setLanguageServerEnabled } from "../lib/lsp/enabled";
import type { LanguageServerDefinition } from "../lib/lsp/servers";

type Props = {
  server: LanguageServerDefinition;
  onAnswered: () => void;
};

/**
 * The one time wavex offers a language server.
 *
 * A server is a long-lived process that indexes the whole checkout, so opening
 * a file is not consent to start one. The offer appears once per server, on the
 * first file it covers; either answer is remembered, and Settings can change it
 * later. A server that is not installed is reported rather than offered — wavex
 * never downloads one.
 */
export function LanguageServerOffer({ server, onAnswered }: Props) {
  useSyncExternalStore(
    subscribeLanguageServerAvailability,
    getLanguageServerAvailabilitySnapshot,
    getLanguageServerAvailabilitySnapshot,
  );
  const installed = languageServerBinary(server.id) !== null;

  const answer = (enabled: boolean) => {
    setLanguageServerEnabled(server.id, enabled);
    onAnswered();
  };

  return (
    <header className="flex h-8 shrink-0 items-center gap-2 border-b border-content/10 px-3 text-[11.5px]">
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
      {installed ? (
        <button
          type="button"
          onClick={() => answer(true)}
          className="h-6 shrink-0 rounded-md bg-accent px-2 text-[11.5px] font-medium text-white"
        >
          Enable
        </button>
      ) : null}
      <button
        type="button"
        // Not a dismissal: declining is an answer, and it is what stops the
        // offer coming back on every file of this language.
        onClick={() => answer(false)}
        aria-label={installed ? `Don’t use ${server.name}` : `Dismiss ${server.name}`}
        title={`Don’t ask about ${server.name} again`}
        className="grid size-6 shrink-0 place-items-center rounded-md text-content/45 hover:bg-content/8 hover:text-content"
      >
        <X className="size-3" strokeWidth={1.75} />
      </button>
    </header>
  );
}

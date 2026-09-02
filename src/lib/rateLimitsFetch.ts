import { invoke } from "@tauri-apps/api/core";
import { homeDir } from "./fs";
import {
  errorRateLimits,
  parseClaudeOAuthUsage,
  parseCodexRateLimits,
  unavailableRateLimits,
  type ProviderRateLimits,
} from "./rateLimits";
import {
  killChild,
  resolveCodexBinary,
  spawnChild,
  unwatchChild,
  watchChild,
} from "./harness/child";
import { asRecord } from "./harness/codexProtocol";
import { JsonRpcClient } from "./harness/jsonRpc";

const USAGE_CHILD_PREFIX = "wavex-codex-usage";
const DISCOVERY_TIMEOUT_MS = 15_000;
const REQUEST_TIMEOUT_MS = 12_000;

type CodexProbe = { limits: ProviderRateLimits; raw: unknown };

/**
 * The one probe in flight, shared by every caller.
 *
 * Two probes at once used to fail each other: they spawned under one child id,
 * so the second one's cleanup killed the first one's process and its next
 * `harness_write` came back as `Harness process is not running`. The status-bar
 * chip and the usage view ask at the same moment whenever the view is opened,
 * which is exactly that case. The slot is cleared only after the probe's own
 * cleanup has run, so a follow-up can never spawn into a pending teardown.
 */
let inflightProbe: Promise<CodexProbe> | null = null;
let probeCount = 0;

type ClaudeUsageFetch = {
  status: "ok" | "error" | "unavailable" | string;
  httpStatus?: number | null;
  body?: string | null;
  error?: string | null;
};

export async function fetchClaudeRateLimits(): Promise<ProviderRateLimits> {
  try {
    const result = await invoke<ClaudeUsageFetch>("fetch_claude_usage");
    if (result.status === "ok" && result.body) {
      const parsed = parseClaudeOAuthUsage(result.body);
      if (parsed.session || parsed.weekly) return parsed;
      return {
        ...parsed,
        status: parsed.status === "ok" ? "ok" : parsed.status,
      };
    }
    if (result.status === "unavailable") {
      return unavailableRateLimits("claude", result.error?.trim() || "Claude not signed in");
    }
    return errorRateLimits("claude", result.error?.trim() || "Claude usage unavailable");
  } catch (error) {
    return errorRateLimits(
      "claude",
      error instanceof Error ? error.message : "Claude usage unavailable",
    );
  }
}

/**
 * Reads Codex's own rate-limit report over its app-server.
 *
 * `onRaw` hands the untouched payload to a second reader, so the plan-limit
 * view and the status-bar chip share one probe instead of spawning the CLI
 * twice for the same answer.
 */
export async function fetchCodexRateLimits(
  onRaw?: (result: unknown) => void,
): Promise<ProviderRateLimits> {
  if (!inflightProbe) {
    const probe = probeCodexRateLimits();
    inflightProbe = probe;
    void probe
      .catch(() => undefined)
      .finally(() => {
        if (inflightProbe === probe) inflightProbe = null;
      });
  }
  const { limits, raw } = await inflightProbe;
  if (raw !== undefined) onRaw?.(raw);
  return limits;
}

async function probeCodexRateLimits(): Promise<CodexProbe> {
  // A private child id per probe: cleanup can then only ever kill its own
  // process, even against a second window whose module state is separate.
  const childId = `${USAGE_CHILD_PREFIX}-${(probeCount += 1)}`;
  let raw: unknown;
  const done = (limits: ProviderRateLimits): CodexProbe => ({ limits, raw });
  let path: string;
  try {
    path = (await resolveCodexBinary()).path;
  } catch {
    return done(unavailableRateLimits("codex", "Codex CLI not found"));
  }

  let cwd: string;
  try {
    cwd = await homeDir();
  } catch (error) {
    return done(errorRateLimits("codex", error instanceof Error ? error.message : String(error)));
  }

  const rpc = new JsonRpcClient(
    childId,
    {
      onRequest: (id) => {
        void rpc.respond(id, {}).catch(() => undefined);
      },
    },
    { includeJsonrpc: false, label: "codex-usage" },
  );

  const stop = async () => {
    rpc.close();
    unwatchChild(childId);
    await killChild(childId).catch(() => undefined);
  };

  watchChild(
    childId,
    (line) => rpc.pushLine(line),
    () => rpc.close(new Error("Codex usage probe exited")),
  );

  try {
    await spawnChild(childId, path, ["app-server"], cwd);
    return await withTimeout(
      DISCOVERY_TIMEOUT_MS,
      async () => {
        await rpc.request(
          "initialize",
          {
            clientInfo: {
              name: "wavex",
              title: "wavex",
              version: "0.1.0",
            },
            capabilities: { experimentalApi: true },
          },
          REQUEST_TIMEOUT_MS,
        );
        await rpc.notify("initialized", undefined);

        const result = await rpc.request<unknown>(
          "account/rateLimits/read",
          {},
          REQUEST_TIMEOUT_MS,
        );
        raw = result;
        const parsed = parseCodexRateLimits(result);
        if (parsed.session || parsed.weekly) return done(parsed);
        const rec = asRecord(result);
        if (rec && !parsed.session && !parsed.weekly) {
          return done(unavailableRateLimits("codex", "No Codex usage data"));
        }
        return done(parsed);
      },
      () => {
        void stop();
      },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/not signed in|chatgpt authentication required|not authenticated/i.test(message)) {
      return done(unavailableRateLimits("codex", "Codex not signed in"));
    }
    if (/ENOENT|not found|could not run/i.test(message)) {
      return done(unavailableRateLimits("codex", "Codex CLI not found"));
    }
    return done(errorRateLimits("codex", message));
  } finally {
    await stop();
  }
}

async function withTimeout<T>(
  ms: number,
  work: () => Promise<T>,
  onTimeout: () => void,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const pending = work();
  try {
    return await Promise.race([
      pending,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => {
          onTimeout();
          reject(new Error("Codex usage probe timed out"));
        }, ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
    void pending.catch(() => undefined);
  }
}

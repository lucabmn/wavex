import { homeDir } from "../fs";
import { type HostId } from "../host";
import { setHarnessModels } from "../models";
import { AcpClient } from "./acp";
import {
  execChild,
  harnessHostId,
  killChild,
  resolveGrokBinary,
  spawnChild,
  unwatchChild,
  watchChild,
} from "./child";
import {
  fallbackGrokModels,
  grokAuthMethodId,
  grokSpawnArgs,
  modelsFromGrokModelsOutput,
  modelsFromInitialize,
  modelsFromSessionNew,
} from "./grokProtocol";

const PROBE_ID = "wavex-grok-probe";
const DISCOVERY_TIMEOUT_MS = 15_000;
const REQUEST_TIMEOUT_MS = 12_000;

const CLIENT_CAPABILITIES = {
  fs: { readTextFile: false, writeTextFile: false },
  terminal: false,
};

/** One probe in flight per host: two hosts run two installs of the CLI. */
const inflight = new Map<HostId, Promise<void>>();

export function refreshGrokCatalog(hostIdArg?: HostId): Promise<void> {
  const hostId = harnessHostId("", hostIdArg);
  const running = inflight.get(hostId);
  if (running) return running;
  const run = discoverGrokModels(hostId)
    .then((models) => {
      if (models.length > 0) setHarnessModels("grok", models);
    })
    .catch((error: unknown) => {
      console.debug("[wavex] grok catalog", error);
    })
    .finally(() => {
      inflight.delete(hostId);
    });
  inflight.set(hostId, run);
  return run;
}

async function discoverGrokModels(hostId: HostId) {
  const fromAcp = await discoverViaAcp(hostId).catch((error: unknown) => {
    console.debug("[wavex] grok ACP catalog failed", error);
    return [];
  });
  if (fromAcp.length > 0) return fromAcp;
  const fromCli = await discoverViaCli(hostId).catch((error: unknown) => {
    console.debug("[wavex] grok CLI catalog failed", error);
    return [];
  });
  if (fromCli.length > 0) return fromCli;
  return fallbackGrokModels();
}

async function discoverViaAcp(hostId: HostId) {
  const { path } = await resolveGrokBinary(hostId);
  const cwd = await homeDir(hostId);
  const acp = new AcpClient(
    PROBE_ID,
    {
      onRequest: (id) => {
        void acp.respond(id, {}).catch(() => undefined);
      },
    },
    hostId,
  );

  const stop = async () => {
    acp.close();
    unwatchChild(PROBE_ID, hostId);
    await killChild(PROBE_ID, hostId).catch(() => undefined);
  };

  watchChild(
    PROBE_ID,
    (line) => acp.pushLine(line),
    () => acp.close(new Error("Grok Build probe exited")),
    undefined,
    hostId,
  );

  try {
    await spawnChild(PROBE_ID, path, grokSpawnArgs({ model: "" }), cwd, hostId);
    return await withTimeout(
      DISCOVERY_TIMEOUT_MS,
      async () => {
        const init = await acp.request(
          "initialize",
          {
            protocolVersion: 1,
            clientCapabilities: CLIENT_CAPABILITIES,
            clientInfo: { name: "wavex", version: "0.1.0" },
          },
          REQUEST_TIMEOUT_MS,
        );
        const fromInit = modelsFromInitialize(init);
        if (fromInit.length > 0) return fromInit;

        const methodId = grokAuthMethodId(init);
        if (methodId) {
          await acp
            .request("authenticate", { methodId, _meta: { headless: true } }, REQUEST_TIMEOUT_MS)
            .catch(() => undefined);
        }
        const created = await acp.request(
          "session/new",
          { cwd, mcpServers: [] },
          REQUEST_TIMEOUT_MS,
        );
        return modelsFromSessionNew(created);
      },
      () => {
        void stop();
      },
    );
  } finally {
    await stop();
  }
}

async function discoverViaCli(hostId: HostId) {
  const { path } = await resolveGrokBinary(hostId);
  const cwd = await homeDir(hostId);
  const stdout = await execChild(path, ["models"], cwd, hostId);
  return modelsFromGrokModelsOutput(stdout);
}

function withTimeout<T>(ms: number, run: () => Promise<T>, onTimeout: () => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      onTimeout();
      reject(new Error("Grok Build catalog probe timed out"));
    }, ms);
    run()
      .then(resolve, reject)
      .finally(() => clearTimeout(timer));
  });
}

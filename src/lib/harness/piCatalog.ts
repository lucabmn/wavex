import { homeDir } from "../fs";
import { type HostId } from "../host";
import { setHarnessModels } from "../models";
import { harnessHostId, killChild, spawnChild, unwatchChild, watchChild } from "./child";
import { PiRpc } from "./piClient";
import { OMP_FLAVOR, PI_FLAVOR, type PiFlavor } from "./piFlavor";
import { buildPiSpawnArgs, modelsFromRpcData } from "./piProtocol";

const DISCOVERY_TIMEOUT_MS = 45_000;

/** One probe in flight per flavor per host: two hosts run two CLI installs. */
const inflight = new Map<string, Promise<void>>();

function refreshCatalog(flavor: PiFlavor, hostIdArg?: HostId): Promise<void> {
  const hostId = harnessHostId("", hostIdArg);
  const key = `${flavor.id}\u0000${hostId}`;
  const running = inflight.get(key);
  if (running) return running;
  const run = discoverModels(flavor, hostId)
    .then((models) => {
      if (models.length > 0) setHarnessModels(flavor.id, models);
    })
    .catch((error: unknown) => {
      console.debug(`[wavex] ${flavor.id} catalog`, error);
    })
    .finally(() => {
      inflight.delete(key);
    });
  inflight.set(key, run);
  return run;
}

async function discoverModels(flavor: PiFlavor, hostId: HostId) {
  const { path } = await flavor.resolveBinary(hostId);
  const cwd = await homeDir(hostId);
  const probeId = flavor.probeChildId;
  const rpc = new PiRpc(probeId, () => undefined, flavor.label, hostId);

  const stop = async () => {
    rpc.close();
    unwatchChild(probeId, hostId);
    await killChild(probeId, hostId).catch(() => undefined);
  };

  watchChild(
    probeId,
    (line) => rpc.pushLine(line),
    () => rpc.close(new Error(`${flavor.label} catalog probe exited`)),
    undefined,
    hostId,
  );

  try {
    await spawnChild(
      probeId,
      path,
      buildPiSpawnArgs(flavor, { noSession: true, noExtensions: true }),
      cwd,
      hostId,
    );
    const response = await Promise.race([
      rpc.request({ type: "get_available_models" }, DISCOVERY_TIMEOUT_MS),
      new Promise<never>((_, reject) => {
        setTimeout(
          () => reject(new Error(`${flavor.label} model discovery timed out`)),
          DISCOVERY_TIMEOUT_MS,
        );
      }),
    ]);
    return modelsFromRpcData(flavor, response.data);
  } finally {
    await stop();
  }
}

export function refreshPiCatalog(hostId?: HostId): Promise<void> {
  return refreshCatalog(PI_FLAVOR, hostId);
}

export function refreshOmpCatalog(hostId?: HostId): Promise<void> {
  return refreshCatalog(OMP_FLAVOR, hostId);
}

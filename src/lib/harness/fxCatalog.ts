import { homeDir } from "../fs";
import { type HostId } from "../host";
import { setHarnessModels } from "../models";
import { execChild, harnessHostId, resolveFxBinary } from "./child";
import { mergeFxCatalogModels, modelFromFxStatusOutput, modelsFromFxOutput } from "./fxProtocol";

/** One probe in flight per host: two hosts run two installs of the CLI. */
const inflight = new Map<HostId, Promise<void>>();

export function refreshFxCatalog(hostIdArg?: HostId): Promise<void> {
  const hostId = harnessHostId("", hostIdArg);
  const running = inflight.get(hostId);
  if (running) return running;
  const run = discoverFxModels(hostId)
    .then((models) => {
      if (models.length > 0) setHarnessModels("fx", models);
    })
    .catch((error: unknown) => {
      console.debug("[wavex] fx catalog", error);
    })
    .finally(() => {
      inflight.delete(hostId);
    });
  inflight.set(hostId, run);
  return run;
}

async function discoverFxModels(hostId: HostId) {
  const { path } = await resolveFxBinary(hostId);
  const cwd = await homeDir(hostId);
  const [modelsOutput, statusOutput] = await Promise.all([
    execChild(path, ["models", "--json"], cwd, hostId),
    execChild(path, ["status", "--json"], cwd, hostId).catch(() => ""),
  ]);
  return mergeFxCatalogModels(
    modelsFromFxOutput(modelsOutput),
    modelFromFxStatusOutput(statusOutput),
  );
}

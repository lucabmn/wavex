import {
  bindOmpSession,
  cancelOmpTurn,
  forgetOmpSession,
  respondOmpApproval,
  sendOmpTurn,
  steerOmpTurn,
  stopOmpSession,
} from "./omp";
import { refreshOmpCatalog } from "./piCatalog";
import { runTextPrompt, warmupOmpText } from "./piText";
import { OMP_FLAVOR } from "./piFlavor";
import { createHandoffBriefGenerator, createSessionTitleGenerator } from "./textGenerators";
import { registerHarness, type HarnessAdapter } from "./registry";

export const ompAdapter: HarnessAdapter = {
  id: "omp",
  live: true,
  sendTurn: sendOmpTurn,
  steerTurn: steerOmpTurn,
  cancelTurn: cancelOmpTurn,
  respondApproval: respondOmpApproval,
  stopSession: stopOmpSession,
  forgetSession: forgetOmpSession,
  bindSession: bindOmpSession,
  refreshCatalog: refreshOmpCatalog,
  generateTitle: createSessionTitleGenerator((input) => runTextPrompt(OMP_FLAVOR, input)),
  generateHandoffBrief: createHandoffBriefGenerator((input) => runTextPrompt(OMP_FLAVOR, input)),
  warmupText: warmupOmpText,
};

let registered = false;

export function ensureOmpRegistered(): void {
  if (registered) return;
  registerHarness(ompAdapter);
  registered = true;
}

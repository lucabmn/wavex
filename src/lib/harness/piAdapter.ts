import {
  bindPiSession,
  cancelPiTurn,
  forgetPiSession,
  respondPiApproval,
  sendPiTurn,
  steerPiTurn,
  stopPiSession,
} from "./pi";
import { refreshPiCatalog } from "./piCatalog";
import { runTextPrompt, warmupPiText } from "./piText";
import { PI_FLAVOR } from "./piFlavor";
import { createHandoffBriefGenerator, createSessionTitleGenerator } from "./textGenerators";
import { registerHarness, type HarnessAdapter } from "./registry";

export const piAdapter: HarnessAdapter = {
  id: "pi",
  live: true,
  sendTurn: sendPiTurn,
  steerTurn: steerPiTurn,
  cancelTurn: cancelPiTurn,
  respondApproval: respondPiApproval,
  stopSession: stopPiSession,
  forgetSession: forgetPiSession,
  bindSession: bindPiSession,
  refreshCatalog: refreshPiCatalog,
  generateTitle: createSessionTitleGenerator((input) => runTextPrompt(PI_FLAVOR, input)),
  generateHandoffBrief: createHandoffBriefGenerator((input) => runTextPrompt(PI_FLAVOR, input)),
  warmupText: warmupPiText,
};

let registered = false;

export function ensurePiRegistered(): void {
  if (registered) return;
  registerHarness(piAdapter);
  registered = true;
}

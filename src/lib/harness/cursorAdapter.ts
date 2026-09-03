import {
  bindCursorSession,
  cancelCursorTurn,
  forgetCursorSession,
  respondCursorApproval,
  respondCursorQuestion,
  sendCursorTurn,
  steerCursorTurn,
  stopCursorSession,
} from "./cursor";
import { refreshCursorCatalog } from "./cursorCatalog";
import { runCursorTextPrompt, warmupCursorText } from "./cursorText";
import {
  createGitTextGenerators,
  createHandoffBriefGenerator,
  createSessionTitleGenerator,
} from "./textGenerators";
import { registerHarness, type HarnessAdapter } from "./registry";

const gitText = createGitTextGenerators(runCursorTextPrompt, "Cursor", 60_000);

export const cursorAdapter: HarnessAdapter = {
  id: "cursor",
  live: true,
  sendTurn: sendCursorTurn,
  steerTurn: steerCursorTurn,
  cancelTurn: cancelCursorTurn,
  respondApproval: respondCursorApproval,
  respondQuestion: respondCursorQuestion,
  stopSession: stopCursorSession,
  forgetSession: forgetCursorSession,
  bindSession: bindCursorSession,
  refreshCatalog: refreshCursorCatalog,
  generateTitle: createSessionTitleGenerator(runCursorTextPrompt),
  generateHandoffBrief: createHandoffBriefGenerator(runCursorTextPrompt),
  generateCommitMessage: gitText.generateCommitMessage,
  generatePrContent: gitText.generatePrContent,
  generateBranchName: gitText.generateBranchName,
  warmupText: warmupCursorText,
};

let registered = false;

export function ensureCursorRegistered(): void {
  if (registered) return;
  registerHarness(cursorAdapter);
  registered = true;
}

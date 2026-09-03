import {
  bindGrokSession,
  cancelGrokTurn,
  forgetGrokSession,
  respondGrokApproval,
  respondGrokQuestion,
  sendGrokTurn,
  steerGrokTurn,
  stopGrokSession,
} from "./grok";
import { refreshGrokCatalog } from "./grokCatalog";
import { runGrokTextPrompt, warmupGrokText } from "./grokText";
import {
  createGitTextGenerators,
  createHandoffBriefGenerator,
  createSessionTitleGenerator,
} from "./textGenerators";
import { registerHarness, type HarnessAdapter } from "./registry";

const gitText = createGitTextGenerators(runGrokTextPrompt, "Grok Build", 60_000);

export const grokAdapter: HarnessAdapter = {
  id: "grok",
  live: true,
  canSteer: false,
  sendTurn: sendGrokTurn,
  steerTurn: steerGrokTurn,
  cancelTurn: cancelGrokTurn,
  respondApproval: respondGrokApproval,
  respondQuestion: respondGrokQuestion,
  stopSession: stopGrokSession,
  forgetSession: forgetGrokSession,
  bindSession: bindGrokSession,
  refreshCatalog: refreshGrokCatalog,
  generateTitle: createSessionTitleGenerator(runGrokTextPrompt),
  generateHandoffBrief: createHandoffBriefGenerator(runGrokTextPrompt),
  generateCommitMessage: gitText.generateCommitMessage,
  generatePrContent: gitText.generatePrContent,
  generateBranchName: gitText.generateBranchName,
  warmupText: warmupGrokText,
};

let registered = false;

export function ensureGrokRegistered(): void {
  if (registered) return;
  registerHarness(grokAdapter);
  registered = true;
}

import {
  bindOpenCodeSession,
  cancelOpenCodeTurn,
  forgetOpenCodeSession,
  respondOpenCodeApproval,
  respondOpenCodeQuestion,
  sendOpenCodeTurn,
  steerOpenCodeTurn,
  stopOpenCodeSession,
} from "./opencode";
import { refreshOpenCodeCatalog } from "./opencodeCatalog";
import { runOpenCodeTextPrompt, warmupOpenCodeText } from "./opencodeText";
import {
  createGitTextGenerators,
  createHandoffBriefGenerator,
  createSessionTitleGenerator,
} from "./textGenerators";
import { registerHarness, type HarnessAdapter } from "./registry";

const gitText = createGitTextGenerators(runOpenCodeTextPrompt, "OpenCode");

export const openCodeAdapter: HarnessAdapter = {
  id: "opencode",
  live: true,
  sendTurn: sendOpenCodeTurn,
  steerTurn: steerOpenCodeTurn,
  cancelTurn: cancelOpenCodeTurn,
  respondApproval: respondOpenCodeApproval,
  respondQuestion: respondOpenCodeQuestion,
  stopSession: stopOpenCodeSession,
  forgetSession: forgetOpenCodeSession,
  bindSession: bindOpenCodeSession,
  refreshCatalog: refreshOpenCodeCatalog,
  generateTitle: createSessionTitleGenerator(runOpenCodeTextPrompt),
  generateHandoffBrief: createHandoffBriefGenerator(runOpenCodeTextPrompt),
  generateCommitMessage: gitText.generateCommitMessage,
  generatePrContent: gitText.generatePrContent,
  generateBranchName: gitText.generateBranchName,
  warmupText: warmupOpenCodeText,
};

let registered = false;

export function ensureOpenCodeRegistered(): void {
  if (registered) return;
  registerHarness(openCodeAdapter);
  registered = true;
}

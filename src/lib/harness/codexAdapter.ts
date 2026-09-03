import {
  bindCodexSession,
  cancelCodexTurn,
  forgetCodexSession,
  respondCodexApproval,
  sendCodexTurn,
  steerCodexTurn,
  stopCodexSession,
} from "./codex";
import { refreshCodexCatalog } from "./codexCatalog";
import { runCodexTextPrompt, warmupCodexText } from "./codexText";
import {
  createGitTextGenerators,
  createHandoffBriefGenerator,
  createSessionTitleGenerator,
} from "./textGenerators";
import { registerHarness, type HarnessAdapter } from "./registry";

const gitText = createGitTextGenerators(runCodexTextPrompt, "Codex");

export const codexAdapter: HarnessAdapter = {
  id: "codex",
  live: true,
  sendTurn: sendCodexTurn,
  steerTurn: steerCodexTurn,
  cancelTurn: cancelCodexTurn,
  respondApproval: respondCodexApproval,
  stopSession: stopCodexSession,
  forgetSession: forgetCodexSession,
  bindSession: bindCodexSession,
  refreshCatalog: refreshCodexCatalog,
  generateTitle: createSessionTitleGenerator(runCodexTextPrompt),
  generateHandoffBrief: createHandoffBriefGenerator(runCodexTextPrompt),
  generateCommitMessage: gitText.generateCommitMessage,
  generatePrContent: gitText.generatePrContent,
  generateBranchName: gitText.generateBranchName,
  warmupText: warmupCodexText,
};

let registered = false;

export function ensureCodexRegistered(): void {
  if (registered) return;
  registerHarness(codexAdapter);
  registered = true;
}

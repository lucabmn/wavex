import {
  bindClaudeSession,
  cancelClaudeTurn,
  forgetClaudeSession,
  respondClaudeApproval,
  respondClaudeQuestion,
  sendClaudeTurn,
  steerClaudeTurn,
  stopClaudeSession,
} from "./claude";
import { refreshClaudeCatalog } from "./claudeCatalog";
import { runClaudeTextPrompt, warmupClaudeText } from "./claudeText";
import { createGitTextGenerators, createSessionTitleGenerator } from "./textGenerators";
import { registerHarness, type HarnessAdapter } from "./registry";

const gitText = createGitTextGenerators(runClaudeTextPrompt, "Claude Code");

export const claudeAdapter: HarnessAdapter = {
  id: "claude",
  live: true,
  sendTurn: sendClaudeTurn,
  steerTurn: steerClaudeTurn,
  cancelTurn: cancelClaudeTurn,
  respondApproval: respondClaudeApproval,
  respondQuestion: respondClaudeQuestion,
  stopSession: stopClaudeSession,
  forgetSession: forgetClaudeSession,
  bindSession: bindClaudeSession,
  refreshCatalog: refreshClaudeCatalog,
  generateTitle: createSessionTitleGenerator(runClaudeTextPrompt),
  generateCommitMessage: gitText.generateCommitMessage,
  generatePrContent: gitText.generatePrContent,
  generateBranchName: gitText.generateBranchName,
  warmupText: warmupClaudeText,
};

let registered = false;

export function ensureClaudeRegistered(): void {
  if (registered) return;
  registerHarness(claudeAdapter);
  registered = true;
}

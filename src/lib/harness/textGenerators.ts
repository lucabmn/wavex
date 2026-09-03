import { gitRangeContext, gitStagedContext } from "../fs";
import { buildHandoffBriefPrompt, parseHandoffBrief } from "../handoff";
import {
  buildBranchNamePrompt,
  buildCommitMessagePrompt,
  buildPrContentPrompt,
  formatCommitMessage,
  parseBranchName,
  parseCommitMessage,
  parsePrContent,
  type PrContent,
} from "../gitText";
import { buildThreadTitlePrompt, parseGeneratedThreadTitle } from "../sessions/sessionTitle";

/**
 * A harness's one-shot text call. Every harness exposes the same shape, so the
 * generators below differ only in which one they are handed.
 */
export type TextPromptRunner = (input: {
  cwd: string;
  prompt: string;
  timeoutMs: number;
}) => Promise<string>;

const TITLE_TIMEOUT_MS = 45_000;
const HANDOFF_BRIEF_TIMEOUT_MS = 60_000;
const DEFAULT_GIT_TIMEOUT_MS = 90_000;

export function createSessionTitleGenerator(run: TextPromptRunner) {
  return async function generateSessionTitle(input: {
    sessionId: string;
    cwd: string;
    message: string;
  }): Promise<string | null> {
    try {
      const output = await run({
        cwd: input.cwd,
        prompt: buildThreadTitlePrompt(input.message),
        timeoutMs: TITLE_TIMEOUT_MS,
      });
      return parseGeneratedThreadTitle(output);
    } catch (error) {
      console.debug("[wavex] session title", error);
      return null;
    }
  };
}

/**
 * Briefing for a session handed to another harness. Stateless on purpose: the
 * source session must keep its own child untouched, so the transcript travels
 * in the prompt instead of being asked of a live conversation.
 */
export function createHandoffBriefGenerator(run: TextPromptRunner) {
  return async function generateHandoffBrief(
    cwd: string,
    transcript: string,
  ): Promise<string | null> {
    if (!transcript.trim()) return null;
    try {
      const output = await run({
        cwd,
        prompt: buildHandoffBriefPrompt(transcript),
        timeoutMs: HANDOFF_BRIEF_TIMEOUT_MS,
      });
      return parseHandoffBrief(output) || null;
    } catch (error) {
      console.debug("[wavex] handoff brief", error);
      return null;
    }
  };
}

/**
 * `label` names the harness in the one message a user can see: the fallback
 * when the model answered with nothing usable.
 */
export function createGitTextGenerators(
  run: TextPromptRunner,
  label: string,
  timeoutMs = DEFAULT_GIT_TIMEOUT_MS,
) {
  async function generateCommitMessage(cwd: string): Promise<string> {
    const context = await gitStagedContext(cwd);
    const output = await run({
      cwd,
      prompt: buildCommitMessagePrompt({
        branch: context.branch,
        stagedSummary: context.summary,
        stagedPatch: context.patch,
      }),
      timeoutMs,
    });
    const parsed = parseCommitMessage(output);
    if (parsed) return formatCommitMessage(parsed);
    const snippet = output.trim().replace(/\s+/g, " ").slice(0, 240);
    throw new Error(
      snippet
        ? `Could not generate a commit message. Model replied: ${snippet}`
        : `Could not generate a commit message. ${label} returned no text.`,
    );
  }

  async function generatePrContent(
    cwd: string,
  ): Promise<(PrContent & { base: string; head: string }) | null> {
    const range = await gitRangeContext(cwd);
    let parsed: PrContent | null = null;
    try {
      const output = await run({
        cwd,
        prompt: buildPrContentPrompt({
          baseBranch: range.base,
          headBranch: range.head,
          commitSummary: range.commitSummary,
          diffSummary: range.diffSummary,
          diffPatch: range.diffPatch,
        }),
        timeoutMs,
      });
      parsed = parsePrContent(output);
    } catch (error) {
      console.debug("[wavex] pr content", error);
    }
    // A failed generation still yields a usable PR: fall back to the commits.
    const title =
      parsed?.title || range.commitSummary.split(/\r?\n/)[0]?.trim() || `Update ${range.head}`;
    return {
      title,
      body: parsed?.body || range.commitSummary.trim(),
      base: range.base,
      head: range.head,
    };
  }

  async function generateBranchName(cwd: string, message: string): Promise<string | null> {
    try {
      const output = await run({
        cwd,
        prompt: buildBranchNamePrompt(message),
        timeoutMs,
      });
      return parseBranchName(output);
    } catch (error) {
      console.debug("[wavex] branch name", error);
      return null;
    }
  }

  return { generateCommitMessage, generatePrContent, generateBranchName };
}

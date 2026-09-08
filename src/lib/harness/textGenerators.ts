import { gitRangeContext, gitStagedContext } from "../fs";
import type { HostId } from "../host";
import type { HarnessId } from "../session";
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
import { loadGitWritingSkillSection } from "./gitWritingSkills";

/**
 * A harness's one-shot text call. Every harness exposes the same shape, so the
 * generators below differ only in which one they are handed.
 */
export type TextPromptRunner = (input: {
  cwd: string;
  prompt: string;
  timeoutMs: number;
  hostId?: HostId;
}) => Promise<string>;

const TITLE_TIMEOUT_MS = 45_000;
const DEFAULT_GIT_TIMEOUT_MS = 90_000;

export function createSessionTitleGenerator(run: TextPromptRunner) {
  return async function generateSessionTitle(input: {
    sessionId: string;
    cwd: string;
    message: string;
    hostId?: HostId;
  }): Promise<string | null> {
    try {
      const output = await run({
        cwd: input.cwd,
        prompt: buildThreadTitlePrompt(input.message),
        timeoutMs: TITLE_TIMEOUT_MS,
        hostId: input.hostId,
      });
      return parseGeneratedThreadTitle(output);
    } catch (error) {
      console.debug("[wavex] session title", error);
      return null;
    }
  };
}

/**
 * `label` names the harness in the one message a user can see: the fallback
 * when the model answered with nothing usable. `harness` scopes the project
 * skills folded into each prompt, so a commit skill is honored instead of
 * bypassed.
 */
export function createGitTextGenerators(
  run: TextPromptRunner,
  label: string,
  harness: HarnessId,
  timeoutMs = DEFAULT_GIT_TIMEOUT_MS,
) {
  async function withSkills(
    prompt: string,
    input: { harness: HarnessId; cwd: string; kind: "commit" | "pr" | "branch"; hostId?: HostId },
  ): Promise<string> {
    const section = await loadGitWritingSkillSection(input);
    return section ? `${prompt}\n\n${section}` : prompt;
  }

  async function generateCommitMessage(cwd: string, hostId?: HostId): Promise<string> {
    const context = await gitStagedContext(cwd, hostId);
    const prompt = await withSkills(
      buildCommitMessagePrompt({
        branch: context.branch,
        stagedSummary: context.summary,
        stagedPatch: context.patch,
      }),
      { harness, cwd, kind: "commit", hostId },
    );
    const output = await run({
      cwd,
      prompt,
      timeoutMs,
      hostId,
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
    hostId?: HostId,
  ): Promise<(PrContent & { base: string; head: string }) | null> {
    const range = await gitRangeContext(cwd, hostId);
    let parsed: PrContent | null = null;
    try {
      const prompt = await withSkills(
        buildPrContentPrompt({
          baseBranch: range.base,
          headBranch: range.head,
          commitSummary: range.commitSummary,
          diffSummary: range.diffSummary,
          diffPatch: range.diffPatch,
        }),
        { harness, cwd, kind: "pr", hostId },
      );
      const output = await run({
        cwd,
        prompt,
        timeoutMs,
        hostId,
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

  async function generateBranchName(
    cwd: string,
    message: string,
    hostId?: HostId,
  ): Promise<string | null> {
    try {
      const prompt = await withSkills(buildBranchNamePrompt(message), {
        harness,
        cwd,
        kind: "branch",
        hostId,
      });
      const output = await run({
        cwd,
        prompt,
        timeoutMs,
        hostId,
      });
      return parseBranchName(output);
    } catch (error) {
      console.debug("[wavex] branch name", error);
      return null;
    }
  }

  return { generateCommitMessage, generatePrContent, generateBranchName };
}

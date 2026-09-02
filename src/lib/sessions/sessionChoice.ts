import { noteCardMeta, type NoteComposerCard } from "../notes";
import { dropContextWindow } from "../contextUsage";
import {
  formatSessionTitle,
  sessionDisplayTitle,
  HARNESS_LABEL,
  type HarnessId,
  type SecondOpinionMeta,
  type Session,
} from "../session";

export function userTurnCards(
  noteCard: NoteComposerCard | undefined,
  secondOpinion?: SecondOpinionMeta,
) {
  if (!noteCard && !secondOpinion) return undefined;
  return {
    ...(secondOpinion ? { secondOpinion } : {}),
    ...(noteCard ? { noteCard: noteCardMeta(noteCard) } : {}),
  };
}

export function withHarnessChoice(
  session: Session,
  harness: HarnessId,
  model: string,
  modelSettings: Record<string, string>,
): Session {
  return {
    ...session,
    harness,
    model,
    modelSettings,
    title:
      session.blocks.length === 0
        ? HARNESS_LABEL[harness]
        : formatSessionTitle(harness, sessionDisplayTitle(session.title, session.harness)),
    ...(session.model === model ? {} : { context: dropContextWindow(session.context) }),
    ...(session.harness === harness ? {} : { providerSessionId: undefined }),
  };
}

export function lastUserBlockId(session: Session): string | undefined {
  for (let i = session.blocks.length - 1; i >= 0; i--) {
    if (session.blocks[i]?.role === "user") return session.blocks[i]?.id;
  }
  return undefined;
}

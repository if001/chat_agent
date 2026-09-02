import { UserNote } from "../../core/types";

export type UserMemoryWriteAction =
  | "create"
  | "keep_existing"
  | "replace"
  | "delete";

export interface UserMemoryWriteDecision {
  action: UserMemoryWriteAction;
  targetNoteId?: number;
  reason: string;
}

export interface UserMemoryWritePlanner {
  decide(input: {
    proposedNote: string;
    candidates: UserNote[];
    explicitTargetNoteId?: number;
  }): Promise<UserMemoryWriteDecision | null>;
}

interface JsonGeneratingModel {
  generateJson<T>(systemPrompt: string, userPrompt: string): Promise<T>;
}

interface RawUserMemoryWriteDecision {
  action?: string;
  targetNoteId?: number;
  reason?: string;
}

export const createUserMemoryWritePlanner = (
  model: JsonGeneratingModel,
): UserMemoryWritePlanner => ({
  async decide(input) {
    const parsed = await model.generateJson<RawUserMemoryWriteDecision>(
      [
        "You decide one explicit UserMemory write operation.",
        "UserMemory stores stable preferences, constraints, attributes, and ongoing working assumptions.",
        "Choose exactly one action: create, keep_existing, replace, or delete.",
        "Use keep_existing for a semantic duplicate, replace for a contradiction or correction, create for a genuinely new stable fact, and delete only when the proposed correction explicitly removes an existing fact without a replacement.",
        "Never target an unrelated note.",
        "targetNoteId must be one of the supplied candidate IDs. If explicitTargetNoteId is supplied, replace or delete may target only that ID.",
        "Return JSON with action, optional targetNoteId, and a short natural-language reason.",
      ].join(" "),
      JSON.stringify({
        proposedNote: input.proposedNote,
        candidates: input.candidates.map(({ id, note }) => ({ id, note })),
        ...(input.explicitTargetNoteId !== undefined
          ? { explicitTargetNoteId: input.explicitTargetNoteId }
          : {}),
      }),
    );
    return normalizeDecision(parsed, input);
  },
});

const normalizeDecision = (
  value: RawUserMemoryWriteDecision | null | undefined,
  input: {
    candidates: UserNote[];
    explicitTargetNoteId?: number;
  },
): UserMemoryWriteDecision | null => {
  const action = value?.action;
  const reason = value?.reason?.trim();
  if (
    !reason ||
    (action !== "create" &&
      action !== "keep_existing" &&
      action !== "replace" &&
      action !== "delete")
  ) {
    return null;
  }
  if (action === "create") {
    return input.explicitTargetNoteId === undefined
      ? { action, reason }
      : null;
  }
  const targetNoteId = value?.targetNoteId;
  if (
    !Number.isInteger(targetNoteId) ||
    !input.candidates.some((candidate) => candidate.id === targetNoteId) ||
    (input.explicitTargetNoteId !== undefined &&
      targetNoteId !== input.explicitTargetNoteId)
  ) {
    return null;
  }
  return { action, targetNoteId: targetNoteId as number, reason };
};

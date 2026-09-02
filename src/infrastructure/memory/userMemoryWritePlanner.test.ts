import { createUserMemoryWritePlanner } from "./userMemoryWritePlanner";

const candidates = [
  { id: 1, note: "回答は簡潔な方がよい", createdAt: new Date() },
  { id: 2, note: "TypeScriptを使っている", createdAt: new Date() },
];

test.each([
  ["keep_existing", 1],
  ["replace", 1],
  ["delete", 1],
] as const)("accepts validated %s decisions", async (action, targetNoteId) => {
  const planner = createUserMemoryWritePlanner({
    generateJson: async <T>() =>
      ({ action, targetNoteId, reason: "semantic comparison" }) as T,
  });

  await expect(
    planner.decide({ proposedNote: "短い回答が好き", candidates }),
  ).resolves.toEqual({ action, targetNoteId, reason: "semantic comparison" });
});

test("accepts create without a target ID", async () => {
  const planner = createUserMemoryWritePlanner({
    generateJson: async <T>() =>
      ({ action: "create", reason: "new stable preference" }) as T,
  });

  await expect(
    planner.decide({ proposedNote: "ダークモードが好き", candidates }),
  ).resolves.toEqual({ action: "create", reason: "new stable preference" });
});

test("rejects an ID outside the candidate set", async () => {
  const planner = createUserMemoryWritePlanner({
    generateJson: async <T>() =>
      ({ action: "replace", targetNoteId: 999, reason: "invalid" }) as T,
  });

  await expect(
    planner.decide({ proposedNote: "詳細な回答が好き", candidates }),
  ).resolves.toBeNull();
});

test("rejects mutation of a different note during explicit replacement", async () => {
  const planner = createUserMemoryWritePlanner({
    generateJson: async <T>() =>
      ({ action: "replace", targetNoteId: 2, reason: "wrong target" }) as T,
  });

  await expect(
    planner.decide({
      proposedNote: "詳細な回答が好き",
      candidates,
      explicitTargetNoteId: 1,
    }),
  ).resolves.toBeNull();
});

test("rejects create during an explicit replacement", async () => {
  const planner = createUserMemoryWritePlanner({
    generateJson: async <T>() =>
      ({ action: "create", reason: "would leave the old note" }) as T,
  });

  await expect(
    planner.decide({
      proposedNote: "詳細な回答が好き",
      candidates,
      explicitTargetNoteId: 1,
    }),
  ).resolves.toBeNull();
});

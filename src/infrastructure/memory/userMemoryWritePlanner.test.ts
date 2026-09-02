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
      ({
        destination: "user_memory",
        action,
        targetNoteId,
        reason: "semantic comparison",
      }) as T,
  });

  await expect(
    planner.decide({ proposedNote: "短い回答が好き", candidates }),
  ).resolves.toEqual({
    destination: "user_memory",
    action,
    targetNoteId,
    reason: "semantic comparison",
  });
});

test("accepts create without a target ID", async () => {
  const planner = createUserMemoryWritePlanner({
    generateJson: async <T>() =>
      ({
        destination: "user_memory",
        action: "create",
        reason: "new stable preference",
      }) as T,
  });

  await expect(
    planner.decide({ proposedNote: "ダークモードが好き", candidates }),
  ).resolves.toEqual({
    destination: "user_memory",
    action: "create",
    reason: "new stable preference",
  });
});

test("rejects an ID outside the candidate set", async () => {
  const planner = createUserMemoryWritePlanner({
    generateJson: async <T>() =>
      ({
        destination: "user_memory",
        action: "replace",
        targetNoteId: 999,
        reason: "invalid",
      }) as T,
  });

  await expect(
    planner.decide({ proposedNote: "詳細な回答が好き", candidates }),
  ).resolves.toBeNull();
});

test("rejects mutation of a different note during explicit replacement", async () => {
  const planner = createUserMemoryWritePlanner({
    generateJson: async <T>() =>
      ({
        destination: "user_memory",
        action: "replace",
        targetNoteId: 2,
        reason: "wrong target",
      }) as T,
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
      ({
        destination: "user_memory",
        action: "create",
        reason: "would leave the old note",
      }) as T,
  });

  await expect(
    planner.decide({
      proposedNote: "詳細な回答が好き",
      candidates,
      explicitTargetNoteId: 1,
    }),
  ).resolves.toBeNull();
});

test.each(["daily_event", "topic_state", "reject"] as const)(
  "accepts a validated %s destination without a UserMemory action",
  async (destination) => {
    const planner = createUserMemoryWritePlanner({
      generateJson: async <T>() =>
        ({ destination, reason: "semantic destination" }) as T,
    });

    await expect(
      planner.decide({ proposedNote: "candidate", candidates }),
    ).resolves.toEqual({ destination, reason: "semantic destination" });
  },
);

test("rejects a UserMemory decision without an action", async () => {
  const planner = createUserMemoryWritePlanner({
    generateJson: async <T>() =>
      ({ destination: "user_memory", reason: "missing action" }) as T,
  });

  await expect(
    planner.decide({ proposedNote: "candidate", candidates }),
  ).resolves.toBeNull();
});

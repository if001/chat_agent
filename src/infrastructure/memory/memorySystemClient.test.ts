import { formatPolicyCardsForPrompt } from "./memorySystemClient";

test("formats policy context with explicit applicability and behaviors", () => {
  const prompt = formatPolicyCardsForPrompt([
    {
      id: "pc-1",
      appliesWhen: "User compares implementation options.",
      recommendedBehavior: "Compare tradeoffs against constraints.",
      avoidBehavior: "Do not choose before confirming constraints.",
      episodeIds: ["ep-1"],
    },
  ]);

  expect(prompt).toContain(
    "appliesWhen: User compares implementation options.",
  );
  expect(prompt).toContain(
    "recommendedBehavior: Compare tradeoffs against constraints.",
  );
  expect(prompt).toContain(
    "avoidBehavior: Do not choose before confirming constraints.",
  );
  expect(prompt).not.toContain("episodeIds");
});

import { RequestContextBuilder } from "./requestContextBuilder";

const request = {
  botId: "ao",
  userId: "user-1",
  threadId: "thread-1",
  currentContext: "hello",
  kind: "human" as const,
};

test("builds only runtime metadata for a human request", async () => {
  const builder = new RequestContextBuilder(
    () => new Date("2026-09-01T00:00:00.000Z"),
  );

  await expect(builder.build(request)).resolves.toBe(
    "# Request Context\nCurrent time: 2026-09-01T00:00:00.000Z\nInput origin: human",
  );
});

test("includes proactive evidence only for proactive input", async () => {
  const builder = new RequestContextBuilder(
    () => new Date("2026-09-01T00:00:00.000Z"),
  );

  const context = await builder.build({
    ...request,
    kind: "proactive",
    proactiveEvidence: "continue the saved topic",
  });

  expect(context).toContain("Input origin: proactive");
  expect(context).toContain("## Proactive Internal Context");
  expect(context).toContain("continue the saved topic");
});

test("does not prefetch memory or policy context", async () => {
  const builder = new RequestContextBuilder(
    () => new Date("2026-09-01T00:00:00.000Z"),
  );

  const context = await builder.build(request);

  expect(context).not.toContain("UserMemory");
  expect(context).not.toContain("PolicyCard");
  expect(context).not.toContain("DailyEvent");
});

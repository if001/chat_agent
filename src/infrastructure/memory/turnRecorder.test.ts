import { createTurnRecorder } from "./turnRecorder";
import { TurnRecordInput } from "./memorySystemClient";

test("saves each visible turn exactly once", async () => {
  const saved: TurnRecordInput[] = [];
  const recorder = createTurnRecorder({
    ingestTurnRecord: async (record) => {
      saved.push(record);
    },
  });
  const record: TurnRecordInput = {
    botId: "ao",
    threadId: "thread-1",
    kind: "human",
    messages: [],
    createdAtIso: "2026-08-31T00:00:00.000Z",
  };

  await recorder(record);

  expect(saved).toEqual([record]);
});

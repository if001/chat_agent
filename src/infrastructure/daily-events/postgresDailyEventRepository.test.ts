import { PostgresDailyEventRepository } from "./postgresDailyEventRepository";

const createInsertDb = () => ({
  insert: () => ({
    values: (payload: {
      botId: string;
      userId: string;
      eventDate: string;
      summary: string;
      tags: string[];
      sourceMessage?: string;
    }) => ({
      returning: async () => [
        {
          id: 1,
          botId: payload.botId,
          userId: payload.userId,
          eventDate: payload.eventDate,
          summary: payload.summary,
          tags: payload.tags,
          sourceMessage: payload.sourceMessage ?? null,
          createdAt: new Date("2026-05-06T00:00:00.000Z"),
        },
      ],
    }),
  }),
}) as never;

test("rememberDailyEvent normalizes and persists a date", async () => {
  const repository = new PostgresDailyEventRepository(createInsertDb());
  const saved = await repository.rememberDailyEvent({
    userId: "u1",
    eventDate: "20260506",
    summary: "queue のテストを追加した",
    tags: ["queue", "test"],
  });

  expect(saved.eventDate).toBe("2026-05-06");
  expect(saved.summary).toBe("queue のテストを追加した");
  expect(saved.tags).toEqual(["queue", "test"]);
});

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
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

test("rememberDailyEvent normalizes date and appends monthly file", async () => {
  const originalCwd = process.cwd();
  const root = await mkdtemp(path.join(tmpdir(), "daily-events-"));
  process.chdir(root);

  try {
    const repository = new PostgresDailyEventRepository(createInsertDb());
    const saved = await repository.rememberDailyEvent({
      botId: "ao",
      userId: "u1",
      eventDate: "20260506",
      summary: "queue のテストを追加した",
      tags: ["queue", "test"],
    });

    expect(saved.eventDate).toBe("2026-05-06");
    const filePath = path.join(
      root,
      "memories",
      "daily-events",
      "ao",
      "u1",
      "2026-05.md",
    );
    const content = await readFile(filePath, "utf8");
    expect(content).toContain("2026-05-06 ユーザーはqueue のテストを追加した");
    expect(content).toContain("[tags: queue, test]");
  } finally {
    process.chdir(originalCwd);
    await rm(root, { recursive: true, force: true });
  }
});

import { PostgresUserMemoryStore } from "./postgresUserMemoryStore";

class FakeDb {
  public inserted: unknown[] = [];

  insert(): { values: (value: unknown) => Promise<void> } {
    return {
      values: async (value: unknown) => {
        this.inserted.push(value);
      },
    };
  }

  select(): {
    from: () => {
      where: () => {
        orderBy: () => {
          limit: () => Promise<Array<{ note: string; createdAt: Date }>>;
        };
      };
    };
  } {
    return {
      from: () => ({
        where: () => ({
          orderBy: () => ({
            limit: async () => [{ note: "n1", createdAt: new Date("2026-01-01T00:00:00.000Z") }],
          }),
        }),
      }),
    };
  }
}

test("rememberUserNote inserts user note", async () => {
  const db = new FakeDb();
  const store = new PostgresUserMemoryStore(db as never);

  await store.rememberUserNote("bot1", "user1", "prefer concise answers");

  expect(db.inserted[0]).toEqual({
    botId: "bot1",
    userId: "user1",
    note: "prefer concise answers",
  });
});


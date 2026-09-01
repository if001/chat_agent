import { PostgresUserMemoryStore } from "./postgresUserMemoryStore";

const fixed = new Date("2026-01-01T00:00:00.000Z");

class FakeDb {
  selected: Array<{ id: number; note: string; createdAt: Date }> = [];
  inserted: unknown[] = [];
  updated: unknown[] = [];
  deleted = 0;

  select() {
    const chain = {
      from: () => chain,
      $dynamic: () => chain,
      where: () => chain,
      orderBy: () => chain,
      limit: async () => this.selected,
    };
    return chain;
  }

  insert() {
    return {
      values: (value: unknown) => {
        this.inserted.push(value);
        const result = {
          onConflictDoNothing: () => result,
          returning: async () => [{ id: 1, ...(value as object), createdAt: fixed }],
        };
        return result;
      },
    };
  }

  update() {
    return {
      set: (value: unknown) => {
        this.updated.push(value);
        return {
          where: () => ({
            returning: async () => [{ id: 1, userId: "user-1", ...(value as object), createdAt: fixed }],
          }),
        };
      },
    };
  }

  delete() {
    return {
      where: () => ({
        returning: async () => {
          this.deleted += 1;
          return [{ id: 1 }];
        },
      }),
    };
  }
}

test("rememberUserNote is shared across bot identities and deduplicates normalized text", async () => {
  const db = new FakeDb();
  const store = new PostgresUserMemoryStore(db as never);

  const created = await store.rememberUserNote("user-1", "Prefer concise answers");
  db.selected = [created];
  const duplicateFromOtherBotPath = await store.rememberUserNote(
    "user-1",
    " prefer concise answers。 ",
  );

  expect(db.inserted).toEqual([
    { userId: "user-1", note: "Prefer concise answers" },
  ]);
  expect(duplicateFromOtherBotPath.id).toBe(created.id);
});

test("replaceUserNote updates the searched ID and old text is no longer returned", async () => {
  const db = new FakeDb();
  db.selected = [{ id: 1, note: "Prefer concise answers", createdAt: fixed }];
  const store = new PostgresUserMemoryStore(db as never);

  const updated = await store.replaceUserNote(
    "user-1",
    1,
    "Prefer detailed answers",
  );
  db.selected = updated ? [updated] : [];
  const oldResults = await store.searchUserNotes("user-1", "concise", 10);

  expect(updated?.note).toBe("Prefer detailed answers");
  expect(db.updated).toEqual([{ note: "Prefer detailed answers" }]);
  expect(oldResults).toEqual([updated]);
  expect(oldResults.some((item) => item.note.includes("concise"))).toBe(false);
});

test("deleteUserNote targets one user note ID", async () => {
  const db = new FakeDb();
  const store = new PostgresUserMemoryStore(db as never);

  await expect(store.deleteUserNote("user-1", 1)).resolves.toBe(true);
  expect(db.deleted).toBe(1);
});

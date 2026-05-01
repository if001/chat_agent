import { Queryable, QueryResultRow } from "../db/postgresKnowledgeRepository";
import { PostgresUserMemoryStore } from "./postgresUserMemoryStore";

class FakeDb implements Queryable {
  public readonly calls: Array<{ sql: string; params?: unknown[] }> = [];

  async query<T extends QueryResultRow>(sql: string, params?: unknown[]): Promise<{ rows: T[] }> {
    this.calls.push({ sql, params });
    return { rows: [] };
  }
}

test("rememberUserNote inserts user note", async () => {
  const db = new FakeDb();
  const store = new PostgresUserMemoryStore(db);

  await store.rememberUserNote("bot1", "user1", "prefer concise answers");

  expect(db.calls[0]?.sql).toContain("INSERT INTO user_notes");
  expect(db.calls[0]?.params).toEqual(["bot1", "user1", "prefer concise answers"]);
});

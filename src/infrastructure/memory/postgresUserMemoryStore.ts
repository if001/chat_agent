import { UserMemoryStore, UserNote } from "../../core/types";
import { Queryable } from "../db/postgresKnowledgeRepository";
import { readFile } from "node:fs/promises";
import path from "node:path";

interface UserNoteRow {
  [key: string]: unknown;
  note: string;
  created_at: Date;
}

export class PostgresUserMemoryStore implements UserMemoryStore {
  constructor(private readonly db: Queryable) {}

  async initialize(): Promise<void> {
    await this.db.query(`
      CREATE TABLE IF NOT EXISTS user_notes (
        id BIGSERIAL PRIMARY KEY,
        bot_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        note TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
  }

  async rememberUserNote(botId: string, userId: string, note: string): Promise<void> {
    await this.db.query(
      "INSERT INTO user_notes (bot_id, user_id, note) VALUES ($1, $2, $3)",
      [botId, userId, note],
    );
  }

  async listUserNotes(botId: string, userId: string, limit: number): Promise<UserNote[]> {
    const result = await this.db.query<UserNoteRow>(
      `
      SELECT note, created_at
      FROM user_notes
      WHERE bot_id = $1 AND user_id = $2
      ORDER BY created_at DESC
      LIMIT $3
      `,
      [botId, userId, limit],
    );
    return result.rows.map((row) => ({
      note: row.note,
      createdAt: new Date(row.created_at),
    }));
  }

  async readMemoryFile(path: string): Promise<string> {
    const normalized = path.replace(/\\/g, "/");
    if (!normalized.startsWith("/memories/")) {
      throw new Error("read_memory_file only allows paths under /memories/");
    }
    const resolved = pathModuleResolve(normalized);
    return readFile(resolved, "utf8");
  }
}

const pathModuleResolve = (input: string): string => path.posix.normalize(path.resolve(input));

import { UserMemoryStore, UserNote } from "../../core/types";
import { NodePgDatabase } from "drizzle-orm/node-postgres";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { and, desc, eq } from "drizzle-orm";
import { userNotesTable } from "../db/schema";

export class PostgresUserMemoryStore implements UserMemoryStore {
  constructor(private readonly db: NodePgDatabase) {}

  async rememberUserNote(botId: string, userId: string, note: string): Promise<void> {
    await this.db.insert(userNotesTable).values({
      botId,
      userId,
      note,
    });
  }

  async listUserNotes(botId: string, userId: string, limit: number): Promise<UserNote[]> {
    const rows = await this.db
      .select({
        note: userNotesTable.note,
        createdAt: userNotesTable.createdAt,
      })
      .from(userNotesTable)
      .where(and(eq(userNotesTable.botId, botId), eq(userNotesTable.userId, userId)))
      .orderBy(desc(userNotesTable.createdAt))
      .limit(limit);
    return rows.map((row) => ({
      note: row.note,
      createdAt: new Date(row.createdAt),
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

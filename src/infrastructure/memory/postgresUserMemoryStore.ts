import { UserMemoryStore, UserNote } from "../../core/types";
import { NodePgDatabase } from "drizzle-orm/node-postgres";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { and, desc, eq, ilike } from "drizzle-orm";
import { userNotesTable } from "../db/schema";

export class PostgresUserMemoryStore implements UserMemoryStore {
  constructor(private readonly db: NodePgDatabase) {}

  async rememberUserNote(userId: string, note: string): Promise<UserNote> {
    const normalized = normalizeNote(note);
    const existing = (await this.searchUserNotes(userId, "", 100)).find(
      (item) => normalizeNote(item.note) === normalized,
    );
    if (existing) {
      return existing;
    }
    const rows = await this.db
      .insert(userNotesTable)
      .values({ userId, note: note.trim() })
      .onConflictDoNothing()
      .returning();
    if (rows[0]) {
      return mapUserNote(rows[0]);
    }
    const concurrentlyCreated = (
      await this.searchUserNotes(userId, "", 100)
    ).find((item) => normalizeNote(item.note) === normalized);
    if (!concurrentlyCreated) {
      throw new Error("UserMemory note insert did not return a row");
    }
    return concurrentlyCreated;
  }

  async searchUserNotes(
    userId: string,
    query: string,
    limit: number,
  ): Promise<UserNote[]> {
    const normalizedQuery = query.trim();
    let statement = this.db
      .select({
        id: userNotesTable.id,
        note: userNotesTable.note,
        createdAt: userNotesTable.createdAt,
      })
      .from(userNotesTable)
      .$dynamic();
    statement = statement.where(
      normalizedQuery
        ? and(
            eq(userNotesTable.userId, userId),
            ilike(userNotesTable.note, `%${escapeLike(normalizedQuery)}%`),
          )
        : eq(userNotesTable.userId, userId),
    );
    const rows = await statement
      .orderBy(desc(userNotesTable.createdAt))
      .limit(limit);
    return rows.map(mapUserNote);
  }

  async replaceUserNote(
    userId: string,
    noteId: number,
    note: string,
  ): Promise<UserNote | null> {
    const existingEquivalent = (
      await this.searchUserNotes(userId, "", 100)
    ).find(
      (item) => item.id !== noteId && normalizeNote(item.note) === normalizeNote(note),
    );
    if (existingEquivalent) {
      await this.deleteUserNote(userId, noteId);
      return existingEquivalent;
    }
    const rows = await this.db
      .update(userNotesTable)
      .set({ note: note.trim() })
      .where(
        and(eq(userNotesTable.userId, userId), eq(userNotesTable.id, noteId)),
      )
      .returning();
    return rows[0] ? mapUserNote(rows[0]) : null;
  }

  async deleteUserNote(userId: string, noteId: number): Promise<boolean> {
    const rows = await this.db
      .delete(userNotesTable)
      .where(
        and(eq(userNotesTable.userId, userId), eq(userNotesTable.id, noteId)),
      )
      .returning({ id: userNotesTable.id });
    return rows.length > 0;
  }

  async readMemoryFile(filePath: string): Promise<string> {
    const normalized = filePath.replace(/\\/g, "/");
    if (!normalized.startsWith("/memories/")) {
      throw new Error("read_memory_file only allows paths under /memories/");
    }
    const resolved = resolveMemoryPath(normalized);
    return readFile(resolved, "utf8");
  }
}

export const resolveMemoryPath = (publicPath: string): string =>
  path.join(process.cwd(), publicPath.replace(/^\//, ""));

const normalizeNote = (value: string): string =>
  value.trim().toLocaleLowerCase().replace(/[\s。、,.!！?？]+/gu, " ").trim();

const escapeLike = (value: string): string => value.replace(/[%_\\]/g, "\\$&");

const mapUserNote = (row: {
  id: number;
  note: string;
  createdAt: Date;
}): UserNote => ({
  id: row.id,
  note: row.note,
  createdAt: new Date(row.createdAt),
});

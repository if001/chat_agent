import {
  DailyEvent,
  DailyEventRepository,
  GetDailyEventsByDateInput,
  RememberDailyEventInput,
  SearchDailyEventsInput,
} from "../../core/types";
import { NodePgDatabase } from "drizzle-orm/node-postgres";
import { and, asc, desc, eq, gte, ilike, lte, or, sql } from "drizzle-orm";
import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { dailyEventsTable } from "../db/schema";
import { resolveMemoryPath } from "../memory/postgresUserMemoryStore";

export class PostgresDailyEventRepository implements DailyEventRepository {
  constructor(
    private readonly db: NodePgDatabase,
    private readonly memoriesRootDir: string = "/memories/daily-events",
  ) {}

  async rememberDailyEvent(input: RememberDailyEventInput): Promise<DailyEvent> {
    const normalizedEventDate = normalizeDateInput(input.eventDate);
    const [row] = await this.db
      .insert(dailyEventsTable)
      .values({
        botId: input.botId,
        userId: input.userId,
        eventDate: normalizedEventDate,
        summary: input.summary,
        tags: input.tags ?? [],
        ...(input.sourceMessage ? { sourceMessage: input.sourceMessage } : {}),
      })
      .returning();
    if (!row) {
      throw new Error("failed to persist daily event");
    }
    await this.appendMonthlyFile({
      ...input,
      eventDate: normalizedEventDate,
      tags: input.tags ?? [],
      createdAt: new Date(row.createdAt),
    });
    return mapRow(row);
  }

  async searchDailyEvents(input: SearchDailyEventsInput): Promise<DailyEvent[]> {
    const conditions = [
      eq(dailyEventsTable.botId, input.botId),
      eq(dailyEventsTable.userId, input.userId),
      or(
        ilike(dailyEventsTable.summary, `%${input.query}%`),
        ilike(dailyEventsTable.sourceMessage, `%${input.query}%`),
        sql`${dailyEventsTable.tags}::text ILIKE ${`%${input.query}%`}`,
      ),
      ...(input.fromDate ? [gte(dailyEventsTable.eventDate, normalizeDateInput(input.fromDate))] : []),
      ...(input.toDate ? [lte(dailyEventsTable.eventDate, normalizeDateInput(input.toDate))] : []),
    ];
    const rows = await this.db
      .select()
      .from(dailyEventsTable)
      .where(and(...conditions))
      .orderBy(desc(dailyEventsTable.eventDate), desc(dailyEventsTable.createdAt))
      .limit(input.limit ?? 10);
    return rows.map(mapRow);
  }

  async getDailyEventsByDate(input: GetDailyEventsByDateInput): Promise<DailyEvent[]> {
    const windowDays = input.windowDays ?? 3;
    const center = parseDateOnly(normalizeDateInput(input.date));
    const fromDate = formatDateOnly(addDays(center, -windowDays));
    const toDate = formatDateOnly(addDays(center, windowDays));
    const rows = await this.db
      .select()
      .from(dailyEventsTable)
      .where(
        and(
          eq(dailyEventsTable.botId, input.botId),
          eq(dailyEventsTable.userId, input.userId),
          gte(dailyEventsTable.eventDate, fromDate),
          lte(dailyEventsTable.eventDate, toDate),
        ),
      )
      .orderBy(asc(dailyEventsTable.eventDate), asc(dailyEventsTable.createdAt))
      .limit(input.limit ?? 20);
    return rows.map(mapRow);
  }

  private async appendMonthlyFile(
    input: RememberDailyEventInput & { tags: string[]; createdAt: Date },
  ): Promise<void> {
    const month = input.eventDate.slice(0, 7);
    const dir = resolveMemoryPath(
      path.posix.join(this.memoriesRootDir, input.botId, input.userId),
    );
    await mkdir(dir, { recursive: true });
    const filePath = path.join(dir, `${month}.md`);
    const tags = input.tags.length > 0 ? ` [tags: ${input.tags.join(", ")}]` : "";
    const line = `- ${input.eventDate} ユーザーは${input.summary}${tags}\n`;
    await appendFile(filePath, line, "utf8");
  }
}

const mapRow = (row: typeof dailyEventsTable.$inferSelect): DailyEvent => ({
  id: row.id,
  botId: row.botId,
  userId: row.userId,
  eventDate: row.eventDate,
  summary: row.summary,
  tags: row.tags,
  ...(row.sourceMessage ? { sourceMessage: row.sourceMessage } : {}),
  createdAt: new Date(row.createdAt),
});

const normalizeDateInput = (value: string): string => {
  if (/^\d{8}$/.test(value)) {
    return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }
  throw new Error(`invalid date format: ${value}`);
};

const parseDateOnly = (value: string): Date => new Date(`${value}T00:00:00.000Z`);
const addDays = (date: Date, delta: number): Date => {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + delta);
  return next;
};
const formatDateOnly = (date: Date): string => date.toISOString().slice(0, 10);

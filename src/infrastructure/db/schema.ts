import {
  bigserial,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  vector,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const articlesTable = pgTable("articles", {
  id: text("id").primaryKey(),
  url: text("url").notNull().unique(),
  title: text("title").notNull(),
  summary: text("summary").notNull(),
  content: text("content").notNull(),
  tags: text("tags").array().notNull(),
  rawMarkdown: text("raw_markdown").notNull(),
  embedding: vector("embedding", { dimensions: 768 }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const userNotesTable = pgTable(
  "user_notes",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: text("user_id").notNull(),
    note: text("note").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("user_notes_user_normalized_unique").on(
      table.userId,
      sql`regexp_replace(lower(trim(${table.note})), '[[:space:]。、,.!！?？]+', ' ', 'g')`,
    ),
  ],
);

export const dailyEventsTable = pgTable("daily_events", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  botId: text("bot_id").notNull(),
  userId: text("user_id").notNull(),
  eventDate: text("event_date").notNull(),
  summary: text("summary").notNull(),
  tags: text("tags").array().notNull(),
  sourceMessage: text("source_message"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

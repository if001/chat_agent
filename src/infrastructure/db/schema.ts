import { bigserial, customType, pgTable, text, timestamp } from "drizzle-orm/pg-core";

const vector = customType<{ data: string }>({
  dataType() {
    return "vector";
  },
});

export const articlesTable = pgTable("articles", {
  id: text("id").primaryKey(),
  url: text("url").notNull().unique(),
  title: text("title").notNull(),
  summary: text("summary").notNull(),
  rawMarkdown: text("raw_markdown").notNull(),
  embedding: vector("embedding"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const userNotesTable = pgTable("user_notes", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  botId: text("bot_id").notNull(),
  userId: text("user_id").notNull(),
  note: text("note").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

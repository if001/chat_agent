import {
  pgTable,
  text,
  timestamp,
  vector,
} from "drizzle-orm/pg-core";

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

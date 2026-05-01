import { Pool } from "pg";
import { Queryable } from "./postgresKnowledgeRepository";

export const createPostgresPool = (connectionString: string): Queryable & { close(): Promise<void> } => {
  const pool = new Pool({ connectionString });
  return {
    query: (sql: string, params?: unknown[]) => pool.query(sql, params),
    close: async () => {
      await pool.end();
    },
  };
};

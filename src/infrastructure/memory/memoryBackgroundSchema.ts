import { Pool } from "pg";

export const setupMemoryBackgroundProcessing = async (
  pool: Pick<Pool, "query">,
): Promise<void> => {
  await pool.query(`
    CREATE SCHEMA IF NOT EXISTS app;
    CREATE TABLE IF NOT EXISTS app.memory_turn_memory_processing (
      turn_record_id text PRIMARY KEY,
      lease_until timestamptz,
      processed_at timestamptz,
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS memory_turn_processing_lease_idx
      ON app.memory_turn_memory_processing (lease_until);
  `);
};

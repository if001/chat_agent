import { setupMemoryBackgroundProcessing } from "./infrastructure/memory/memoryBackgroundSchema";

describe("setupMemoryBackgroundProcessing", () => {
  it("creates the lease-backed processing checkpoint idempotently", async () => {
    const query = jest.fn().mockResolvedValue(undefined);

    await setupMemoryBackgroundProcessing({ query } as never);

    expect(query).toHaveBeenCalledTimes(1);
    const sql = query.mock.calls[0]?.[0] as string;
    expect(sql).toContain(
      "CREATE TABLE IF NOT EXISTS app.memory_turn_memory_processing",
    );
    expect(sql).toContain("turn_record_id text PRIMARY KEY");
    expect(sql).toContain("lease_until timestamptz");
    expect(sql).toContain("processed_at timestamptz");
    expect(sql).toContain("CREATE INDEX IF NOT EXISTS");
  });
});

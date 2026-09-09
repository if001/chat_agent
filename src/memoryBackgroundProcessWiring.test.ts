import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("memory background process wiring", () => {
  it("runs separately in both local and Docker Discord operations", () => {
    const root = resolve(__dirname, "..");
    const packageJson = JSON.parse(
      readFileSync(resolve(root, "package.json"), "utf8"),
    ) as { scripts: Record<string, string> };
    const runScript = readFileSync(resolve(root, "run.sh"), "utf8");
    const compose = readFileSync(resolve(root, "docker-compose.yml"), "utf8");

    expect(packageJson.scripts["start:memory"]).toBe(
      "tsx --env-file=.env.ao packages/memory-system/src/cli/runBackground.ts",
    );
    expect(runScript).toContain("npm run start:memory");
    expect(compose).toContain("memory_worker:");
    expect(compose).toContain(
      '["node", "packages/memory-system/lib/cli/runBackground.js"]',
    );
    expect(compose).toContain("restart: unless-stopped");
  });
});

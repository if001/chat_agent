import { readFile } from "node:fs/promises";
import path from "node:path";

const readSkill = (name: string): Promise<string> =>
  readFile(path.join(process.cwd(), "src", "skills", name, "SKILL.md"), "utf8");

test("configured skills retain valid metadata after instruction cleanup", async () => {
  const skills = await Promise.all(
    ["daily-events", "knowledge-lookup", "user-memory", "web-ingest"].map(
      readSkill,
    ),
  );

  for (const skill of skills) {
    expect(skill).toMatch(/^---\nname: [a-z-]+\ndescription: .+\n---\n/u);
  }
});

test("web ingest uses one fetch-and-save operation", async () => {
  const skill = await readSkill("web-ingest");

  expect(skill).toContain("Call `save_web_knowledge(url)` once");
  expect(skill).not.toMatch(/Call `web_page\(url\)`/u);
});

test("daily events skill is retrieval-focused", async () => {
  const skill = await readSkill("daily-events");

  expect(skill).toContain("Retrieve concise day-by-day user activity records");
  expect(skill).not.toContain("remember_daily_event");
});

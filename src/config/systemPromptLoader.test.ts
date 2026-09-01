import { loadSystemPromptByBotId } from "./systemPromptLoader";

test.each([
  ["ao", "アオ", "アカ"],
  ["aka", "アカ", "アオ"],
] as const)(
  "%s prompt keeps identity and real delegation while omitting duplicated procedures",
  (botId, identity, collaborator) => {
    const prompt = loadSystemPromptByBotId(botId, "fallback");

    expect(prompt).toContain(identity);
    expect(prompt).toContain(collaborator);
    expect(prompt).toContain("UserMemory");
    expect(prompt).toContain("DailyEvent");
    expect(prompt).not.toContain("常に最新の情報");
    expect(prompt).not.toContain("replace_user_note");
    expect(prompt).not.toContain("喜怒哀楽をオーバー");
  },
);

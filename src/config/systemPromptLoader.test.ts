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
    expect(prompt).toContain("inspect_context_catalog");
    expect(prompt).toContain("挨拶や単純な応答では、記憶ツールを呼ばない");
    expect(prompt).toContain("`not_found` の場合にqueryを変えて再検索するのは各領域につき最大1回");
    expect(prompt).toContain("`unavailable` は「記憶が存在しない」という意味ではない");
    expect(prompt).not.toContain("常に最新の情報");
    expect(prompt).not.toContain("replace_user_note");
    expect(prompt).not.toContain("喜怒哀楽をオーバー");
  },
);

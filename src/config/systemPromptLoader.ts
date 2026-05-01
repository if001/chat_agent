import { getAoSystemPrompt } from "../system_prompts/ao";
import { getAkaSystemPrompt } from "../system_prompts/aka";

const PROMPT_RESOLVERS: Record<string, () => string> = {
  ao: getAoSystemPrompt,
  aka: getAkaSystemPrompt,
};

export const loadSystemPromptByBotId = (botId: string, fallbackPrompt: string): string => {
  const resolver = PROMPT_RESOLVERS[botId];
  if (!resolver) {
    return fallbackPrompt;
  }
  return resolver();
};

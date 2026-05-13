import { AgentRuntime, BotIdentity, ChannelMessage } from "../types";

export const handleMention = async (
  identity: BotIdentity,
  runtime: AgentRuntime,
  message: ChannelMessage,
): Promise<string | null> => {
  if (!message.mentionsBot) {
    return null;
  }
  const response = await runtime.respond({
    botId: identity.botId,
    systemPrompt: identity.systemPrompt,
    threadId: `${message.channelId}:${message.authorId}`,
    messages: [{ role: "user", content: message.content }],
  });
  return response.content;
};

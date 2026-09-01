import { AgentRuntime, BotIdentity, ChannelMessage } from "../types";

export const handleMention = async (
  identity: BotIdentity,
  runtime: AgentRuntime,
  message: ChannelMessage,
  requestContext?: string,
): Promise<string | null> => {
  if (!message.mentionsBot) {
    return null;
  }
  const response = await runtime.respond({
    botId: identity.botId,
    userId: message.authorId,
    systemPrompt: identity.systemPrompt,
    ...(requestContext ? { requestContext } : {}),
    threadId: `${message.channelId}:${message.authorId}`,
    messages: [{ role: "user", content: message.content }],
  });
  return response.content;
};

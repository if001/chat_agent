export const formatAgentUserInput = (
  message: string,
  now: Date = new Date(),
): string => `Current time: ${now.toISOString()}\n\nUser message:\n${message}`;

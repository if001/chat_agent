export type RequestKind =
  | "human"
  | "conversation"
  | "proactive"
  | "delegation";

export interface RequestContextInput {
  botId: string;
  userId: string;
  threadId: string;
  currentContext: string;
  kind: RequestKind;
  proactiveEvidence?: string;
}

export class RequestContextBuilder {
  constructor(private readonly now: () => Date = () => new Date()) {}

  async build(input: RequestContextInput): Promise<string> {
    const sections = [
      `# Request Context\nCurrent time: ${this.now().toISOString()}\nInput origin: ${input.kind}`,
    ];
    if (
      (input.kind === "conversation" || input.kind === "proactive") &&
      input.proactiveEvidence?.trim()
    ) {
      sections.push(
        `## Proactive Internal Context\n${input.proactiveEvidence.trim()}`,
      );
    }
    return fitWholeSections(sections, 8_000);
  }
}
const fitWholeSections = (sections: string[], maxLength: number): string => {
  const priority = (section: string): number => {
    if (section.startsWith("# Request Context")) return 0;
    if (section.startsWith("## Proactive Internal Context")) return 1;
    return 6;
  };
  const accepted: string[] = [];
  let length = 0;
  for (const section of [...sections].sort((a, b) => priority(a) - priority(b))) {
    const addedLength = section.length + (accepted.length > 0 ? 2 : 0);
    if (accepted.length > 0 && length + addedLength > maxLength) continue;
    accepted.push(section);
    length += addedLength;
  }
  return accepted.join("\n\n");
};

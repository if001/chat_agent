import {
  MemorySystemClient,
  TurnRecordInput,
} from "./memorySystemClient";

export type TurnRecorder = (record: TurnRecordInput) => Promise<void>;

export const createTurnRecorder = (
  memoryClient: Pick<MemorySystemClient, "ingestTurnRecord">,
): TurnRecorder => (record) => memoryClient.ingestTurnRecord(record);

export type MessageType = "incoming" | "outgoing";
export type RegistrationStatus = "registered" | "cancelled" | "checked-in";

export interface SettingRow {
  key: string;
  value: string;
}

export interface MessageRow {
  id: number;
  sender_id: string;
  text: string;
  timestamp: string;
  type: MessageType;
}

export interface RegistrationRow {
  id: string;
  sender_id: string;
  first_name: string;
  last_name: string;
  phone: string;
  email: string;
  timestamp: string;
  status: RegistrationStatus;
}

export interface RegistrationInput {
  sender_id: string;
  first_name: unknown;
  last_name: unknown;
  phone: unknown;
  email?: unknown;
}

export interface RegistrationResult {
  statusCode: number;
  content: Record<string, unknown>;
}

export interface AppDatabase {
  driver: "postgres" | "sqlite";
  initialize(): Promise<void>;
  ping(): Promise<void>;
  close(): Promise<void>;
  getSettingsMap(): Promise<Record<string, string>>;
  getSettingValue(key: string): Promise<string | undefined>;
  upsertSettings(entries: Record<string, string>): Promise<void>;
  getRegistrationById(id: string): Promise<RegistrationRow | undefined>;
  listRegistrations(limit?: number): Promise<RegistrationRow[]>;
  exportRegistrations(): Promise<RegistrationRow[]>;
  createRegistration(input: RegistrationInput): Promise<RegistrationResult>;
  cancelRegistration(id: unknown): Promise<RegistrationResult>;
  checkInRegistration(id: string): Promise<boolean>;
  updateRegistrationStatus(id: string, status: RegistrationStatus): Promise<boolean>;
  saveMessage(senderId: string, text: string, type: MessageType): Promise<void>;
  listMessages(limit: number): Promise<MessageRow[]>;
  getMessageHistoryRows(senderId: string, limit: number): Promise<Array<{ text: string; type: MessageType }>>;
}

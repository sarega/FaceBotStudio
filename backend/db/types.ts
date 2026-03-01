export type MessageType = "incoming" | "outgoing";
export type RegistrationStatus = "registered" | "cancelled" | "checked-in";
export type UserRole = "owner" | "admin" | "operator" | "checker" | "viewer";

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

export interface AuthUserRow {
  id: string;
  username: string;
  display_name: string;
  role: UserRole;
  organization_id: string;
  organization_name: string;
  is_active: boolean;
  created_at: string;
  last_login_at: string | null;
}

export interface AuthSessionRow {
  session_id: string;
  token_hash: string;
  expires_at: string;
  last_seen_at: string;
  user: AuthUserRow;
}

export interface CreateUserInput {
  username: string;
  display_name: string;
  password_hash: string;
  role: UserRole;
}

export interface AuditLogEntryInput {
  actor_user_id?: string | null;
  action: string;
  target_type?: string | null;
  target_id?: string | null;
  metadata?: Record<string, unknown>;
}

export interface AuditLogRow {
  id: number;
  action: string;
  actor_user_id: string | null;
  actor_username: string | null;
  target_type: string | null;
  target_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
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
  getUserByUsername(username: string): Promise<AuthUserRow | undefined>;
  getUserById(userId: string): Promise<AuthUserRow | undefined>;
  getUserPasswordHash(username: string): Promise<string | undefined>;
  listUsers(): Promise<AuthUserRow[]>;
  createUser(input: CreateUserInput): Promise<AuthUserRow>;
  updateUserRole(userId: string, role: UserRole): Promise<boolean>;
  createSession(userId: string, tokenHash: string, expiresAt: Date): Promise<void>;
  getSessionWithUser(tokenHash: string): Promise<AuthSessionRow | undefined>;
  touchSession(sessionId: string): Promise<void>;
  deleteSession(tokenHash: string): Promise<void>;
  deleteExpiredSessions(): Promise<void>;
  updateUserLastLogin(userId: string): Promise<void>;
  recordAuditLog(entry: AuditLogEntryInput): Promise<void>;
  listAuditLogs(limit: number): Promise<AuditLogRow[]>;
}

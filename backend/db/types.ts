export type MessageType = "incoming" | "outgoing";
export type RegistrationStatus = "registered" | "cancelled" | "checked-in";
export type UserRole = "owner" | "admin" | "operator" | "checker" | "viewer";
export type ManualEventStatus = "pending" | "active" | "cancelled";
export type EventStatus = ManualEventStatus | "closed";
export type ChannelPlatform = "facebook" | "line_oa" | "instagram" | "whatsapp" | "telegram" | "web_chat";
export type EmbeddingStatus = "pending" | "ready" | "failed" | "skipped";

export interface SettingRow {
  key: string;
  value: string;
}

export interface MessageRow {
  id: number;
  sender_id: string;
  event_id?: string | null;
  page_id?: string | null;
  text: string;
  timestamp: string;
  type: MessageType;
}

export interface RegistrationRow {
  id: string;
  sender_id: string;
  event_id?: string | null;
  first_name: string;
  last_name: string;
  phone: string;
  email: string;
  timestamp: string;
  status: RegistrationStatus;
}

export interface RegistrationInput {
  sender_id: string;
  event_id?: string;
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

export interface EventRow {
  id: string;
  name: string;
  slug: string;
  status: ManualEventStatus;
  effective_status: EventStatus;
  is_default: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface FacebookPageRow {
  id: string;
  page_id: string;
  page_name: string;
  event_id: string;
  page_access_token?: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface ChannelAccountRow {
  id: string;
  platform: ChannelPlatform;
  external_id: string;
  display_name: string;
  event_id: string;
  access_token?: string | null;
  is_active: boolean;
  config_json?: string | null;
  created_at: string;
  updated_at: string;
}

export interface EventDocumentRow {
  id: string;
  event_id: string;
  title: string;
  source_type: "note" | "document" | "url";
  source_url?: string | null;
  content: string;
  is_active: boolean;
  chunk_count?: number;
  content_hash?: string | null;
  embedding_status?: EmbeddingStatus;
  embedding_model?: string | null;
  last_embedded_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface EventDocumentChunkRow {
  id: string;
  document_id: string;
  event_id: string;
  chunk_index: number;
  content: string;
  content_hash?: string | null;
  char_count?: number;
  token_estimate?: number;
  embedding_status?: EmbeddingStatus;
  embedding_model?: string | null;
  embedded_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateEventInput {
  name: string;
}

export interface UpdateEventInput {
  name?: string;
  status?: ManualEventStatus;
}

export interface UpsertFacebookPageInput {
  page_id: string;
  page_name: string;
  event_id: string;
  page_access_token?: string;
  is_active?: boolean;
}

export interface UpsertChannelAccountInput {
  platform: ChannelPlatform;
  external_id: string;
  display_name: string;
  event_id: string;
  access_token?: string;
  is_active?: boolean;
  config_json?: string;
}

export interface UpsertEventDocumentInput {
  id?: string;
  event_id: string;
  title: string;
  source_type: "note" | "document" | "url";
  source_url?: string;
  content: string;
  is_active?: boolean;
}

export interface AppDatabase {
  driver: "postgres" | "sqlite";
  initialize(): Promise<void>;
  ping(): Promise<void>;
  close(): Promise<void>;
  getSettingsMap(eventId?: string): Promise<Record<string, string>>;
  getSettingValue(key: string, eventId?: string): Promise<string | undefined>;
  upsertSettings(entries: Record<string, string>, eventId?: string): Promise<void>;
  getRegistrationById(id: string): Promise<RegistrationRow | undefined>;
  listRegistrations(limit?: number, eventId?: string): Promise<RegistrationRow[]>;
  exportRegistrations(eventId?: string): Promise<RegistrationRow[]>;
  createRegistration(input: RegistrationInput): Promise<RegistrationResult>;
  cancelRegistration(id: unknown): Promise<RegistrationResult>;
  checkInRegistration(id: string): Promise<boolean>;
  updateRegistrationStatus(id: string, status: RegistrationStatus): Promise<boolean>;
  saveMessage(senderId: string, text: string, type: MessageType, eventId?: string, pageId?: string): Promise<void>;
  listMessages(limit: number, eventId?: string): Promise<MessageRow[]>;
  getMessageHistoryRows(senderId: string, limit: number, eventId?: string): Promise<Array<{ text: string; type: MessageType }>>;
  listEvents(): Promise<EventRow[]>;
  getEventById(eventId: string): Promise<EventRow | undefined>;
  createEvent(input: CreateEventInput): Promise<EventRow>;
  updateEvent(eventId: string, input: UpdateEventInput): Promise<boolean>;
  listEventDocuments(eventId: string): Promise<EventDocumentRow[]>;
  listEventDocumentChunks(eventId: string): Promise<EventDocumentChunkRow[]>;
  upsertEventDocument(input: UpsertEventDocumentInput): Promise<EventDocumentRow>;
  resetEventKnowledge(
    eventId: string,
    options?: { clearContext?: boolean },
  ): Promise<{ documentsDeleted: number; chunksDeleted: number; contextCleared: boolean }>;
  setEventDocumentActive(documentId: string, isActive: boolean): Promise<boolean>;
  setEventDocumentEmbeddingStatus(
    documentId: string,
    status: EmbeddingStatus,
    options?: { embeddingModel?: string; embeddedAt?: Date | null },
  ): Promise<boolean>;
  listChannelAccounts(platform?: ChannelPlatform): Promise<ChannelAccountRow[]>;
  getChannelAccount(platform: ChannelPlatform, externalId: string): Promise<ChannelAccountRow | undefined>;
  upsertChannelAccount(input: UpsertChannelAccountInput): Promise<ChannelAccountRow>;
  resolveEventIdForChannel(platform: ChannelPlatform, externalId: string): Promise<string | undefined>;
  listFacebookPages(): Promise<FacebookPageRow[]>;
  getFacebookPageByPageId(pageId: string): Promise<FacebookPageRow | undefined>;
  upsertFacebookPage(input: UpsertFacebookPageInput): Promise<FacebookPageRow>;
  resolveEventIdForPage(pageId: string): Promise<string | undefined>;
  getUserByUsername(username: string): Promise<AuthUserRow | undefined>;
  getUserById(userId: string): Promise<AuthUserRow | undefined>;
  getUserPasswordHash(username: string): Promise<string | undefined>;
  listUsers(): Promise<AuthUserRow[]>;
  createUser(input: CreateUserInput): Promise<AuthUserRow>;
  updateUserRole(userId: string, role: UserRole): Promise<boolean>;
  setUserActive(userId: string, isActive: boolean): Promise<boolean>;
  createSession(userId: string, tokenHash: string, expiresAt: Date): Promise<void>;
  getSessionWithUser(tokenHash: string): Promise<AuthSessionRow | undefined>;
  touchSession(sessionId: string): Promise<void>;
  deleteSession(tokenHash: string): Promise<void>;
  deleteSessionsForUser(userId: string): Promise<void>;
  deleteExpiredSessions(): Promise<void>;
  updateUserLastLogin(userId: string): Promise<void>;
  recordAuditLog(entry: AuditLogEntryInput): Promise<void>;
  listAuditLogs(limit: number): Promise<AuditLogRow[]>;
}

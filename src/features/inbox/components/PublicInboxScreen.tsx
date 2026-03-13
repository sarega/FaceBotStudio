import type { FormEvent, ReactNode } from "react";
import {
  ExternalLink,
  RefreshCw,
  Search,
  Send,
  Users,
  X,
} from "lucide-react";

import { ChatBubble } from "../../../components/ChatBubble";
import {
  ActionButton,
  SelectionMarker,
  StatusBadge,
  StatusLine,
  type BadgeTone,
} from "../../../components/shared/AppUi";
import type {
  Message,
  PublicInboxConversationStatus,
  PublicInboxConversationSummary,
} from "../../../types";

type PublicInboxCounts = Record<"all" | "attention" | PublicInboxConversationStatus, number>;
type PublicInboxStatusFilter = "all" | "attention" | PublicInboxConversationStatus;

type PublicInboxScreenProps = {
  counts: PublicInboxCounts;
  totalConversationCount: number;
  deferredQuery: string;
  filteredConversations: PublicInboxConversationSummary[];
  selectedEventName: string | null;
  loading: boolean;
  selectedEventId: string;
  onRefreshConversations: () => unknown;
  searchQuery: string;
  onSearchQueryChange: (value: string) => void;
  statusFilter: PublicInboxStatusFilter;
  onStatusFilterChange: (filter: PublicInboxStatusFilter) => void;
  message: string;
  selectedSenderId: string;
  onSelectConversation: (senderId: string) => void;
  getAttentionReasonLabel: (reason: string | null) => string | null;
  getStatusTone: (status: PublicInboxConversationStatus) => BadgeTone;
  getStatusLabel: (status: PublicInboxConversationStatus) => string;
  activeConversation: PublicInboxConversationSummary | null;
  conversationLoading: boolean;
  onRefreshConversation: (senderId: string, eventId: string) => unknown;
  canManageRegistrations: boolean;
  onOpenRegistration: (registrationId: string) => void;
  canChangeConversationStatus: boolean;
  statusUpdating: boolean;
  onUpdateConversationStatus: (status: PublicInboxConversationStatus) => unknown;
  conversationMessages: Message[];
  replyText: string;
  onReplyTextChange: (value: string) => void;
  canSendManualOverride: boolean;
  replySending: boolean;
  onReplySubmit: (event: FormEvent<HTMLFormElement>) => void;
  chatChannelBadge?: ReactNode;
};

export function PublicInboxScreen({
  counts,
  totalConversationCount,
  deferredQuery,
  filteredConversations,
  selectedEventName,
  loading,
  selectedEventId,
  onRefreshConversations,
  searchQuery,
  onSearchQueryChange,
  statusFilter,
  onStatusFilterChange,
  message,
  selectedSenderId,
  onSelectConversation,
  getAttentionReasonLabel,
  getStatusTone,
  getStatusLabel,
  activeConversation,
  conversationLoading,
  onRefreshConversation,
  canManageRegistrations,
  onOpenRegistration,
  canChangeConversationStatus,
  statusUpdating,
  onUpdateConversationStatus,
  conversationMessages,
  replyText,
  onReplyTextChange,
  canSendManualOverride,
  replySending,
  onReplySubmit,
  chatChannelBadge = <StatusBadge tone="neutral">Web chat</StatusBadge>,
}: PublicInboxScreenProps) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="border-b border-slate-100 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold">Public Inbox</h2>
              <StatusBadge tone={counts.attention > 0 ? "rose" : "neutral"}>
                {counts.attention > 0 ? `${counts.attention} need attention` : "No attention queue"}
              </StatusBadge>
            </div>
            <StatusLine
              className="mt-1"
              items={[
                `${counts.all} conversation${counts.all === 1 ? "" : "s"}`,
                deferredQuery ? `${filteredConversations.length} match` : null,
                selectedEventName,
              ]}
            />
            <p className="mt-1 text-xs text-slate-500">
              Human handoff requests and bot failures from the public event page land here first.
            </p>
          </div>
          <button
            onClick={() => void onRefreshConversations()}
            className="rounded-lg p-2 transition-colors hover:bg-slate-100"
            aria-label="Refresh public inbox"
          >
            <RefreshCw className={`h-4 w-4 text-slate-400 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>

        <div className="mt-3 flex flex-col gap-3">
          <div className="relative min-w-0">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={searchQuery}
              onChange={(event) => onSearchQueryChange(event.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2 pl-10 pr-10 text-xs outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Search by attendee, sender ID, registration ID, contact, or last message"
            />
            {searchQuery && (
              <button
                onClick={() => onSearchQueryChange("")}
                className="absolute right-3 top-1/2 inline-flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-slate-200 hover:text-slate-600"
                aria-label="Clear inbox search"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            {([
              { id: "all", label: "All", count: counts.all },
              { id: "attention", label: "Attention", count: counts.attention },
              { id: "open", label: "Open", count: counts.open },
              { id: "waiting-admin", label: "Waiting Admin", count: counts["waiting-admin"] },
              { id: "waiting-user", label: "Waiting User", count: counts["waiting-user"] },
              { id: "resolved", label: "Resolved", count: counts.resolved },
            ] as Array<{ id: PublicInboxStatusFilter; label: string; count: number }>).map((filter) => {
              const active = statusFilter === filter.id;
              return (
                <button
                  key={filter.id}
                  onClick={() => onStatusFilterChange(filter.id)}
                  className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
                    active
                      ? "border-blue-200 bg-blue-50 text-blue-700"
                      : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  <span>{filter.label}</span>
                  <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${active ? "bg-white/80 text-blue-700" : "bg-slate-100 text-slate-500"}`}>
                    {filter.count}
                  </span>
                </button>
              );
            })}
          </div>

          {message && (
            <p className={`text-xs ${
              message.toLowerCase().includes("failed") || message.toLowerCase().includes("error")
                ? "text-rose-600"
                : "text-emerald-600"
            }`}>
              {message}
            </p>
          )}
        </div>
      </div>

      <div className="grid min-h-[34rem] grid-cols-1 xl:grid-cols-[minmax(0,0.85fr)_minmax(22rem,1.15fr)]">
        <div className="border-b border-slate-100 xl:border-b-0 xl:border-r xl:border-slate-100">
          {loading && totalConversationCount === 0 ? (
            <div className="flex h-full items-center justify-center px-6 py-16 text-center text-sm text-slate-400">
              Loading public inbox conversations...
            </div>
          ) : filteredConversations.length === 0 ? (
            <div className="flex h-full items-center justify-center px-6 py-16 text-center text-sm text-slate-400">
              {deferredQuery || statusFilter !== "all"
                ? "No public page conversations match this filter."
                : "No public page conversations yet."}
            </div>
          ) : (
            <div className="max-h-[34rem] overflow-y-auto">
              {filteredConversations.map((conversation) => {
                const selected = selectedSenderId === conversation.sender_id;
                const attentionReasonLabel = getAttentionReasonLabel(conversation.attention_reason);
                return (
                  <button
                    key={conversation.sender_id}
                    onClick={() => onSelectConversation(conversation.sender_id)}
                    className={`grid w-full grid-cols-[minmax(0,1fr)_auto] items-start gap-3 border-b border-slate-100 px-4 py-3 text-left transition-colors ${
                      selected ? "bg-blue-50" : "hover:bg-slate-50"
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate text-sm font-semibold text-slate-900">{conversation.participant_label}</p>
                        <StatusBadge tone={getStatusTone(conversation.status)}>
                          {getStatusLabel(conversation.status)}
                        </StatusBadge>
                        {conversation.needs_attention && <SelectionMarker className="text-rose-700" />}
                      </div>
                      <p className="mt-1 truncate font-mono text-[10px] text-blue-600">{conversation.sender_id}</p>
                      <p className="log-list-preview-2 mt-1 text-[13px] leading-5 text-slate-700">
                        {conversation.last_message_text || "(no message body)"}
                      </p>
                      <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-slate-500">
                        <span>{conversation.last_message_type === "incoming" ? "visitor" : "bot"} · {conversation.message_count} msg</span>
                        {conversation.registration_id && <span>{conversation.registration_id}</span>}
                        {attentionReasonLabel && <span>{attentionReasonLabel}</span>}
                      </div>
                    </div>
                    <p className="shrink-0 whitespace-nowrap pl-2 text-[10px] text-slate-500">
                      {conversation.last_message_at ? new Date(conversation.last_message_at).toLocaleString() : "-"}
                    </p>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="min-w-0 bg-slate-50">
          {!activeConversation ? (
            <div className="flex h-full items-center justify-center px-8 py-16 text-center text-sm text-slate-400">
              Select a public page conversation to inspect the thread and update follow-up status.
            </div>
          ) : (
            <div className="flex h-full min-h-[34rem] flex-col">
              <div className="border-b border-slate-100 bg-white px-4 py-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-base font-semibold text-slate-900">{activeConversation.participant_label}</h3>
                      <StatusBadge tone={getStatusTone(activeConversation.status)}>
                        {getStatusLabel(activeConversation.status)}
                      </StatusBadge>
                      {activeConversation.needs_attention && (
                        <StatusBadge tone="rose">
                          {getAttentionReasonLabel(activeConversation.attention_reason) || "Needs attention"}
                        </StatusBadge>
                      )}
                    </div>
                    <p className="mt-1 break-all font-mono text-[11px] text-blue-600">{activeConversation.sender_id}</p>
                    <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-slate-500">
                      {activeConversation.sender_phone && <span>{activeConversation.sender_phone}</span>}
                      {activeConversation.sender_email && <span>{activeConversation.sender_email}</span>}
                      {activeConversation.registration_id && <span>{activeConversation.registration_id}</span>}
                      {activeConversation.public_slug && <span>/events/{activeConversation.public_slug}</span>}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      onClick={() => void onRefreshConversation(activeConversation.sender_id, selectedEventId)}
                      className="rounded-lg p-2 transition-colors hover:bg-slate-100"
                      aria-label="Refresh conversation"
                    >
                      <RefreshCw className={`h-4 w-4 text-slate-400 ${conversationLoading ? "animate-spin" : ""}`} />
                    </button>
                    {activeConversation.public_slug && (
                      <a
                        href={`/events/${encodeURIComponent(activeConversation.public_slug)}`}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex min-h-8 items-center justify-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-semibold text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-50"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                        Open Page
                      </a>
                    )}
                    {canManageRegistrations && activeConversation.registration_id && (
                      <ActionButton
                        tone="neutral"
                        className="min-h-8 rounded-full px-3 py-1.5 text-[11px]"
                        onClick={() => onOpenRegistration(activeConversation.registration_id || "")}
                      >
                        <Users className="h-3.5 w-3.5" />
                        Open Registration
                      </ActionButton>
                    )}
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  {(["open", "waiting-admin", "waiting-user", "resolved"] as PublicInboxConversationStatus[]).map((status) => (
                    <ActionButton
                      key={status}
                      tone={activeConversation.status === status ? getStatusTone(status) : "neutral"}
                      className="min-h-8 rounded-full px-3 py-1.5 text-[11px]"
                      disabled={!canChangeConversationStatus || statusUpdating || activeConversation.status === status}
                      onClick={() => void onUpdateConversationStatus(status)}
                    >
                      {getStatusLabel(status)}
                    </ActionButton>
                  ))}
                </div>
                {!canChangeConversationStatus && (
                  <p className="mt-2 text-[11px] text-slate-500">
                    Viewer mode can inspect threads but cannot update conversation status.
                  </p>
                )}
              </div>

              <div className="grid gap-3 border-b border-slate-100 bg-white px-4 py-3 md:grid-cols-3">
                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2.5">
                  <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">Last Incoming</p>
                  <p className="mt-1 text-[11px] text-slate-700">
                    {activeConversation.last_incoming_at ? new Date(activeConversation.last_incoming_at).toLocaleString() : "None yet"}
                  </p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2.5">
                  <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">Last Outgoing</p>
                  <p className="mt-1 text-[11px] text-slate-700">
                    {activeConversation.last_outgoing_at ? new Date(activeConversation.last_outgoing_at).toLocaleString() : "None yet"}
                  </p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2.5">
                  <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">Messages</p>
                  <p className="mt-1 text-[11px] text-slate-700">
                    {activeConversation.message_count} total in this public thread
                  </p>
                </div>
              </div>

              <div className="chat-scroll min-h-0 flex-1 overflow-y-auto px-4 py-4">
                {conversationLoading && conversationMessages.length === 0 ? (
                  <div className="flex h-full items-center justify-center py-12 text-center text-sm text-slate-400">
                    Loading conversation history...
                  </div>
                ) : conversationMessages.length === 0 ? (
                  <div className="flex h-full items-center justify-center py-12 text-center text-sm text-slate-400">
                    No messages in this conversation yet.
                  </div>
                ) : (
                  conversationMessages.map((messageItem) => (
                    <ChatBubble
                      key={`${messageItem.id || messageItem.timestamp}-${messageItem.type}`}
                      text={messageItem.text}
                      attachments={messageItem.attachments}
                      type={messageItem.type}
                      timestamp={messageItem.timestamp}
                    />
                  ))
                )}
              </div>

              <form className="border-t border-slate-100 bg-white px-4 py-4" onSubmit={onReplySubmit}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">Reply to Public Page</p>
                    <p className="mt-1 text-xs leading-5 text-slate-500">
                      This reply appears in the attendee&apos;s public event chat when they reopen or keep the page open.
                    </p>
                  </div>
                  {chatChannelBadge}
                </div>
                <div className="mt-3 flex flex-col gap-3">
                  <textarea
                    value={replyText}
                    onChange={(event) => onReplyTextChange(event.target.value)}
                    rows={3}
                    placeholder="Type a reply for the attendee"
                    disabled={!canSendManualOverride || replySending}
                    className="min-h-[7rem] w-full resize-y rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
                    style={{ fontFamily: "var(--font-edit)" }}
                  />
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    {!canSendManualOverride && (
                      <p className="text-xs text-slate-500">
                        Viewer mode can inspect messages but cannot send replies.
                      </p>
                    )}
                    <button
                      type="submit"
                      disabled={!canSendManualOverride || replySending || !replyText.trim()}
                      className="inline-flex items-center justify-center gap-2 rounded-2xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {replySending ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                      Send Reply
                    </button>
                  </div>
                </div>
              </form>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

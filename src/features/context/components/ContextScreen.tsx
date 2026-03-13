import type { RefObject } from "react";
import { motion } from "motion/react";
import {
  Activity,
  AlertCircle,
  ChevronDown,
  ExternalLink,
  Eye,
  PencilLine,
  Power,
  RefreshCw,
  Save,
  Search,
  X,
} from "lucide-react";

import {
  ActionButton,
  CollapseIconButton,
  HelpPopover,
  InlineActionsMenu,
  MenuActionItem,
  MenuActionLink,
  SelectionMarker,
  StatusBadge,
  StatusLine,
  type BadgeTone,
} from "../../../components/shared/AppUi";
import type {
  EmbeddingPreviewResponse,
  EventDocumentChunkRecord,
  EventDocumentRecord,
  EventRecord,
  LlmUsageSummary,
  RetrievalDebugResponse,
  Settings,
} from "../../../types";

type UsageTotals = {
  total_tokens: number;
  estimated_cost_usd: number;
  request_count: number;
};

type ContextScreenProps = {
  selectedEvent: EventRecord | null;
  getEventStatusTone: (status: EventRecord["effective_status"]) => BadgeTone;
  getEventStatusLabel: (status: EventRecord["effective_status"]) => string;
  eventContextDirty: boolean;
  eventCollapsed: boolean;
  onToggleEventCollapsed: () => void;
  onSaveEventContext: () => unknown;
  saving: boolean;
  canManageKnowledge: boolean;
  knowledgeActionsRef: RefObject<HTMLDivElement | null>;
  knowledgeActionsOpen: boolean;
  onKnowledgeActionsOpenChange: (open: boolean) => void;
  knowledgeResetting: boolean;
  selectedEventId: string;
  onResetEventKnowledge: (resetContext: boolean) => unknown;
  settings: Settings;
  onSettingsChange: (nextSettings: Settings) => void;
  settingsMessage: string;
  knowledgeDocumentsCollapsed: boolean;
  onToggleKnowledgeDocumentsCollapsed: () => void;
  documentFileInputRef: RefObject<HTMLInputElement | null>;
  onImportDocumentFile: (file: File | null) => unknown;
  documentsLoading: boolean;
  editingDocumentId: string;
  onResetDocumentForm: () => void;
  documentTitle: string;
  onDocumentTitleChange: (value: string) => void;
  documentSourceType: "note" | "document" | "url";
  onDocumentSourceTypeChange: (value: "note" | "document" | "url") => void;
  documentSourceUrl: string;
  onDocumentSourceUrlChange: (value: string) => void;
  documentContent: string;
  onDocumentContentChange: (value: string) => void;
  onSaveDocument: () => unknown;
  documentsMessage: string;
  attachedDocumentsCollapsed: boolean;
  onToggleAttachedDocumentsCollapsed: () => void;
  filteredDocuments: EventDocumentRecord[];
  deferredDocumentListQuery: string;
  documentListQuery: string;
  onDocumentListQueryChange: (value: string) => void;
  onRefreshDocuments: (eventId: string) => unknown;
  isContextDocumentCollapsed: (documentId: string) => boolean;
  onToggleContextDocumentCollapsed: (documentId: string) => void;
  selectedDocumentForChunksId: string;
  onSelectDocumentForChunks: (documentId: string) => void;
  getSearchTargetDomId: (kind: "document", id: string) => string;
  isSearchFocused: (kind: "document", id: string) => boolean;
  onLoadDocumentIntoForm: (document: EventDocumentRecord) => void;
  onDocumentStatusToggle: (documentId: string, isActive: boolean) => unknown;
  chunkInspectorCollapsed: boolean;
  onToggleChunkInspectorCollapsed: () => void;
  selectedDocumentForChunks: EventDocumentRecord | null;
  onFetchDocumentChunks: (documentId: string, eventId: string) => unknown;
  documentChunksLoading: boolean;
  documentChunks: EventDocumentChunkRecord[];
  embeddingPreviewCollapsed: boolean;
  onToggleEmbeddingPreviewCollapsed: () => void;
  embeddingPreviewLoading: boolean;
  embeddingEnqueueLoading: boolean;
  onEnqueueEmbedding: (documentId: string, eventId: string) => unknown;
  onFetchEmbeddingPreview: (documentId: string, eventId: string) => unknown;
  embeddingPreview: EmbeddingPreviewResponse | null;
  embeddingPreviewMessage: string;
  retrievalDebugCollapsed: boolean;
  onToggleRetrievalDebugCollapsed: () => void;
  retrievalQuery: string;
  onRetrievalQueryChange: (value: string) => void;
  retrievalLoading: boolean;
  onFetchRetrievalDebug: () => unknown;
  retrievalDebug: RetrievalDebugResponse | null;
  retrievalMessage: string;
  activeDocumentCount: number;
  llmUsageCollapsed: boolean;
  onToggleLlmUsageCollapsed: () => void;
  onFetchLlmUsageSummary: (eventId: string) => unknown;
  llmUsageLoading: boolean;
  activeLlmModel: string;
  selectedEventUsage: UsageTotals | null;
  overallLlmUsage: UsageTotals | null;
  llmUsageSummary: LlmUsageSummary | null;
  llmUsageError: string;
  formatCompactNumber: (value: number) => string;
  formatUsdCost: (value: number) => string;
};

export function ContextScreen({
  selectedEvent,
  getEventStatusTone,
  getEventStatusLabel,
  eventContextDirty,
  eventCollapsed,
  onToggleEventCollapsed,
  onSaveEventContext,
  saving,
  canManageKnowledge,
  knowledgeActionsRef,
  knowledgeActionsOpen,
  onKnowledgeActionsOpenChange,
  knowledgeResetting,
  selectedEventId,
  onResetEventKnowledge,
  settings,
  onSettingsChange,
  settingsMessage,
  knowledgeDocumentsCollapsed,
  onToggleKnowledgeDocumentsCollapsed,
  documentFileInputRef,
  onImportDocumentFile,
  documentsLoading,
  editingDocumentId,
  onResetDocumentForm,
  documentTitle,
  onDocumentTitleChange,
  documentSourceType,
  onDocumentSourceTypeChange,
  documentSourceUrl,
  onDocumentSourceUrlChange,
  documentContent,
  onDocumentContentChange,
  onSaveDocument,
  documentsMessage,
  attachedDocumentsCollapsed,
  onToggleAttachedDocumentsCollapsed,
  filteredDocuments,
  deferredDocumentListQuery,
  documentListQuery,
  onDocumentListQueryChange,
  onRefreshDocuments,
  isContextDocumentCollapsed,
  onToggleContextDocumentCollapsed,
  selectedDocumentForChunksId,
  onSelectDocumentForChunks,
  getSearchTargetDomId,
  isSearchFocused,
  onLoadDocumentIntoForm,
  onDocumentStatusToggle,
  chunkInspectorCollapsed,
  onToggleChunkInspectorCollapsed,
  selectedDocumentForChunks,
  onFetchDocumentChunks,
  documentChunksLoading,
  documentChunks,
  embeddingPreviewCollapsed,
  onToggleEmbeddingPreviewCollapsed,
  embeddingPreviewLoading,
  embeddingEnqueueLoading,
  onEnqueueEmbedding,
  onFetchEmbeddingPreview,
  embeddingPreview,
  embeddingPreviewMessage,
  retrievalDebugCollapsed,
  onToggleRetrievalDebugCollapsed,
  retrievalQuery,
  onRetrievalQueryChange,
  retrievalLoading,
  onFetchRetrievalDebug,
  retrievalDebug,
  retrievalMessage,
  activeDocumentCount,
  llmUsageCollapsed,
  onToggleLlmUsageCollapsed,
  onFetchLlmUsageSummary,
  llmUsageLoading,
  activeLlmModel,
  selectedEventUsage,
  overallLlmUsage,
  llmUsageSummary,
  llmUsageError,
  formatCompactNumber,
  formatUsdCost,
}: ContextScreenProps) {
  return (
    <motion.div
      key="design"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="space-y-3"
    >
      <div className="rounded-2xl border border-slate-200 bg-white px-4 py-2.5 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-semibold">Context</h2>
          {selectedEvent && (
            <StatusBadge tone={getEventStatusTone(selectedEvent.effective_status)}>
              {getEventStatusLabel(selectedEvent.effective_status)}
            </StatusBadge>
          )}
        </div>
        <StatusLine
          className="mt-1"
          items={[
            "Context note",
            "Knowledge base",
            "Retrieval tools",
            eventContextDirty ? "Unsaved changes" : "Saved",
          ]}
        />
      </div>
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-12">
        <div className="space-y-3 xl:col-span-7">
          <div className={`rounded-2xl border border-slate-200 bg-white shadow-sm ${eventCollapsed ? "p-2.5 sm:p-3" : "p-3 sm:p-4"}`}>
            <div className={`${eventCollapsed ? "mb-0" : "mb-3"} space-y-2`}>
              <div className={`flex flex-col gap-2 lg:flex-row lg:justify-between ${eventCollapsed ? "lg:items-center" : "lg:items-start"}`}>
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-lg font-semibold">Event Context</h2>
                    {!eventCollapsed && (
                      <HelpPopover label="Open note for Event Context">
                        Per-event FAQ, source text, and response guidance for the selected workspace.
                      </HelpPopover>
                    )}
                  </div>
                  <StatusLine items={[eventContextDirty ? "Unsaved changes" : "All changes saved"]} />
                </div>
                <div className="flex w-full items-stretch gap-2 sm:w-auto lg:justify-end">
                  {!eventCollapsed && (
                    <>
                      <ActionButton
                        onClick={() => void onSaveEventContext()}
                        disabled={saving || !canManageKnowledge}
                        tone="blue"
                        active
                        className="min-w-0 flex-1 text-sm sm:flex-none"
                      >
                        {saving ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                        Save Event Context
                      </ActionButton>
                      <div className="relative shrink-0" ref={knowledgeActionsRef}>
                        <ActionButton
                          onClick={() => onKnowledgeActionsOpenChange(!knowledgeActionsOpen)}
                          disabled={knowledgeResetting || saving || !selectedEventId || !canManageKnowledge}
                          tone="rose"
                          className="min-h-full min-w-[3rem] px-3 text-sm"
                          aria-expanded={knowledgeActionsOpen}
                          aria-haspopup="menu"
                        >
                          {knowledgeResetting ? <RefreshCw className="h-4 w-4 animate-spin" /> : <AlertCircle className="h-4 w-4" />}
                          <span className="sr-only sm:not-sr-only">Danger</span>
                          <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${knowledgeActionsOpen ? "rotate-180" : ""}`} />
                        </ActionButton>
                        {knowledgeActionsOpen && (
                          <div className="app-overlay-surface absolute right-0 top-full z-20 mt-2 w-[min(18rem,calc(100vw-2.5rem))] max-w-[calc(100vw-2.5rem)] rounded-2xl border border-slate-200 bg-white p-2 shadow-xl">
                            <button
                              onClick={() => {
                                onKnowledgeActionsOpenChange(false);
                                void onResetEventKnowledge(false);
                              }}
                              className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm text-amber-700 transition-colors hover:bg-amber-50"
                              role="menuitem"
                            >
                              <AlertCircle className="h-4 w-4 shrink-0" />
                              <span className="font-medium">Clear Knowledge Docs</span>
                            </button>
                            <button
                              onClick={() => {
                                onKnowledgeActionsOpenChange(false);
                                void onResetEventKnowledge(true);
                              }}
                              className="mt-1 flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm text-rose-700 transition-colors hover:bg-rose-50"
                              role="menuitem"
                            >
                              <AlertCircle className="h-4 w-4 shrink-0" />
                              <span className="font-medium">Reset All Knowledge</span>
                            </button>
                          </div>
                        )}
                      </div>
                    </>
                  )}
                  <CollapseIconButton collapsed={eventCollapsed} onClick={onToggleEventCollapsed} />
                </div>
              </div>
            </div>
            {!eventCollapsed && (
              <>
                <textarea
                  rows={10}
                  value={settings.context}
                  onChange={(event) => onSettingsChange({ ...settings, context: event.target.value })}
                  className="min-h-[16rem] w-full resize-y rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm outline-none focus:border-transparent focus:ring-2 focus:ring-blue-500"
                  placeholder="Event-specific FAQ, speaker details, agenda, venue notes, policies, etc."
                />
                {settingsMessage && (
                  <p className={`mt-3 text-xs ${settingsMessage.toLowerCase().includes("failed") || settingsMessage.toLowerCase().includes("error") ? "text-rose-600" : "text-emerald-600"}`}>
                    {settingsMessage}
                  </p>
                )}
              </>
            )}
          </div>

          <div className={`rounded-2xl border border-slate-200 bg-white shadow-sm ${knowledgeDocumentsCollapsed ? "p-2.5 sm:p-3" : "p-3 sm:p-4"}`}>
            <div className={`${knowledgeDocumentsCollapsed ? "mb-0" : "mb-3"} flex flex-col gap-2 sm:flex-row sm:justify-between ${knowledgeDocumentsCollapsed ? "sm:items-center" : "sm:items-start"}`}>
              <div className="flex items-center gap-2">
                <h3 className="text-lg font-semibold">Knowledge Documents</h3>
                {!knowledgeDocumentsCollapsed && (
                  <HelpPopover label="Open note for Knowledge Documents">
                    Attach reusable notes, FAQ fragments, policy text, URLs, or import text-based files into the selected event.
                  </HelpPopover>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {!knowledgeDocumentsCollapsed && (
                  <>
                    <input
                      ref={documentFileInputRef}
                      type="file"
                      accept=".txt,.md,.markdown,.csv,.json,.html,.htm,.xml,text/plain,text/markdown,text/csv,application/json,application/xml,text/html"
                      className="hidden"
                      onChange={(event) => void onImportDocumentFile(event.target.files?.[0] || null)}
                    />
                    <ActionButton
                      onClick={() => documentFileInputRef.current?.click()}
                      disabled={documentsLoading}
                      tone="neutral"
                      className="text-sm"
                    >
                      Import File
                    </ActionButton>
                    {editingDocumentId && (
                      <ActionButton
                        onClick={onResetDocumentForm}
                        tone="neutral"
                        className="text-sm"
                      >
                        Cancel Edit
                      </ActionButton>
                    )}
                  </>
                )}
                <CollapseIconButton collapsed={knowledgeDocumentsCollapsed} onClick={onToggleKnowledgeDocumentsCollapsed} />
              </div>
            </div>

            {!knowledgeDocumentsCollapsed && (
              <>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-xs font-bold uppercase text-slate-500">Title</label>
                    <input
                      value={documentTitle}
                      onChange={(event) => onDocumentTitleChange(event.target.value)}
                      className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="e.g. Venue parking rules"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-bold uppercase text-slate-500">Source Type</label>
                    <select
                      value={documentSourceType}
                      onChange={(event) => onDocumentSourceTypeChange(event.target.value as "note" | "document" | "url")}
                      className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="note">Note</option>
                      <option value="document">Document</option>
                      <option value="url">URL</option>
                    </select>
                  </div>
                  <div className="md:col-span-2">
                    <label className="mb-1 block text-xs font-bold uppercase text-slate-500">Source URL (Optional)</label>
                    <input
                      value={documentSourceUrl}
                      onChange={(event) => onDocumentSourceUrlChange(event.target.value)}
                      className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="https://example.com/reference"
                    />
                  </div>
                  <div className="md:col-span-2">
                    <label className="mb-1 block text-xs font-bold uppercase text-slate-500">Document Content</label>
                    <textarea
                      rows={7}
                      value={documentContent}
                      onChange={(event) => onDocumentContentChange(event.target.value)}
                      className="min-h-[11rem] w-full resize-y rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm outline-none focus:border-transparent focus:ring-2 focus:ring-blue-500"
                      placeholder="Paste FAQ answers, rules, agenda details, speaker notes, or any event-specific reference content here."
                    />
                  </div>
                </div>

                <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
                  <ActionButton
                    onClick={() => void onSaveDocument()}
                    disabled={!selectedEventId || documentsLoading || !documentTitle.trim() || !documentContent.trim()}
                    tone="blue"
                    active
                    className="w-full text-sm sm:w-auto"
                  >
                    {documentsLoading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                    {editingDocumentId ? "Update Document" : "Save Document"}
                  </ActionButton>
                  <p className="text-xs text-slate-500">
                    Imported text is chunked after save so the same document store stays clean and reusable.
                  </p>
                </div>

                {documentsMessage && (
                  <p className={`mt-3 text-xs ${documentsMessage.toLowerCase().includes("failed") || documentsMessage.toLowerCase().includes("error") || documentsMessage.toLowerCase().includes("required") ? "text-rose-600" : "text-emerald-600"}`}>
                    {documentsMessage}
                  </p>
                )}
              </>
            )}
          </div>
        </div>

        <div className="space-y-3 xl:col-span-5">
          <div className={`rounded-2xl border border-slate-200 bg-white shadow-sm ${attachedDocumentsCollapsed ? "p-2.5 sm:p-3" : "p-3 sm:p-4"}`}>
            <div className={`${attachedDocumentsCollapsed ? "mb-0 items-center" : "mb-2.5 items-start"} flex justify-between gap-2`}>
              <button
                type="button"
                onClick={onToggleAttachedDocumentsCollapsed}
                className="min-w-0 flex-1 text-left"
                aria-label={`${attachedDocumentsCollapsed ? "Expand" : "Collapse"} Attached Documents`}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-lg font-semibold">Attached Documents</h3>
                  <span className="text-xs font-medium text-slate-500">{filteredDocuments.length}</span>
                </div>
                {!attachedDocumentsCollapsed && (
                  <p className="mt-1 text-xs text-slate-500">Only active documents are used during retrieval.</p>
                )}
              </button>
              <div className="flex items-center gap-2">
                {!attachedDocumentsCollapsed && (
                  <HelpPopover label="Open note for Attached Documents">
                    Only active documents are used during retrieval.
                  </HelpPopover>
                )}
                {!attachedDocumentsCollapsed && (
                  <button
                    onClick={() => void onRefreshDocuments(selectedEventId)}
                    disabled={documentsLoading || !selectedEventId}
                    className="rounded-xl p-2 transition-colors hover:bg-slate-100 disabled:opacity-50"
                    title="Refresh documents"
                  >
                    <RefreshCw className={`h-4 w-4 text-slate-500 ${documentsLoading ? "animate-spin" : ""}`} />
                  </button>
                )}
                <CollapseIconButton collapsed={attachedDocumentsCollapsed} onClick={onToggleAttachedDocumentsCollapsed} />
              </div>
            </div>

            {!attachedDocumentsCollapsed && (
              <>
                <div className="relative mb-3">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    value={documentListQuery}
                    onChange={(event) => onDocumentListQueryChange(event.target.value)}
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2 pl-10 pr-10 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Search documents by title, content, source, or status"
                  />
                  {documentListQuery && (
                    <button
                      onClick={() => onDocumentListQueryChange("")}
                      className="absolute right-3 top-1/2 inline-flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-slate-200 hover:text-slate-600"
                      aria-label="Clear document search"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>

                <div className="space-y-3">
                  {filteredDocuments.length === 0 && (
                    <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-3 text-sm text-slate-500">
                      {deferredDocumentListQuery ? "No documents match this search." : "No documents attached to this event yet."}
                    </div>
                  )}
                  {filteredDocuments.map((document) => {
                    const documentCollapsed = isContextDocumentCollapsed(document.id);
                    return (
                      <div
                        key={document.id}
                        id={getSearchTargetDomId("document", document.id)}
                        className={`rounded-2xl border p-4 ${
                          documentCollapsed ? "space-y-0" : "space-y-3"
                        } ${
                          selectedDocumentForChunksId === document.id ? "border-blue-200 bg-blue-50" : "border-slate-200 bg-slate-50"
                        } ${
                          isSearchFocused("document", document.id) ? "ring-2 ring-blue-200 ring-offset-2" : ""
                        }`}
                      >
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                          <div className="min-w-0">
                            <p className="truncate font-semibold text-slate-900">{document.title}</p>
                            <StatusLine
                              className="mt-2"
                              items={[
                                document.source_type,
                                `${document.chunk_count || 0} chunks`,
                                document.is_active ? "Active" : "Inactive",
                                `Embed ${document.embedding_status || "pending"}`,
                              ]}
                            />
                            {selectedDocumentForChunksId === document.id && <SelectionMarker className="mt-1" />}
                          </div>
                          <CollapseIconButton
                            collapsed={documentCollapsed}
                            onClick={() => onToggleContextDocumentCollapsed(document.id)}
                            label="document"
                            className="self-start"
                          />
                        </div>
                        {!documentCollapsed && (
                          <>
                            <p className="whitespace-pre-wrap text-sm text-slate-600">
                              {document.content.length > 180 ? `${document.content.slice(0, 180)}...` : document.content}
                            </p>
                            <div className="flex flex-wrap items-center gap-2">
                              <ActionButton
                                onClick={() => onLoadDocumentIntoForm(document)}
                                tone="neutral"
                                className="px-3"
                              >
                                <PencilLine className="h-3.5 w-3.5" />
                                Edit
                              </ActionButton>
                              <InlineActionsMenu
                                label="Actions"
                                tone={document.is_active ? "amber" : "neutral"}
                              >
                                <MenuActionItem
                                  onClick={() => onSelectDocumentForChunks(document.id)}
                                  tone={selectedDocumentForChunksId === document.id ? "blue" : "neutral"}
                                >
                                  <Eye className="h-3.5 w-3.5" />
                                  <span className="font-medium">
                                    {selectedDocumentForChunksId === document.id ? "Viewing Chunks" : "View Chunks"}
                                  </span>
                                </MenuActionItem>
                                {document.source_url && (
                                  <MenuActionLink
                                    href={document.source_url}
                                    target="_blank"
                                    rel="noreferrer"
                                    tone="neutral"
                                    className="mt-1"
                                  >
                                    <ExternalLink className="h-3.5 w-3.5" />
                                    <span className="font-medium">Open Source URL</span>
                                  </MenuActionLink>
                                )}
                                <MenuActionItem
                                  onClick={() => void onDocumentStatusToggle(document.id, document.is_active)}
                                  disabled={documentsLoading}
                                  tone={document.is_active ? "amber" : "emerald"}
                                  className="mt-1"
                                >
                                  <Power className="h-3.5 w-3.5" />
                                  <span className="font-medium">
                                    {document.is_active ? "Disable Document" : "Enable Document"}
                                  </span>
                                </MenuActionItem>
                              </InlineActionsMenu>
                            </div>
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>

          <div className={`rounded-2xl border border-slate-200 bg-slate-50 text-sm text-slate-600 shadow-sm ${chunkInspectorCollapsed ? "p-2.5 sm:p-3" : "p-3 sm:p-4"}`}>
            <div className={`${chunkInspectorCollapsed ? "mb-0" : "mb-2"} flex items-center justify-between gap-2`}>
              <button
                type="button"
                onClick={onToggleChunkInspectorCollapsed}
                className="min-w-0 flex-1 text-left"
                aria-label={`${chunkInspectorCollapsed ? "Expand" : "Collapse"} Chunk Inspector`}
              >
                <h3 className="font-semibold text-slate-900">Chunk Inspector</h3>
              </button>
              <div className="flex items-center gap-2">
                {!chunkInspectorCollapsed && (
                  <HelpPopover label="Open note for Chunk Inspector">
                    Preview the exact chunks available for retrieval from the selected document.
                  </HelpPopover>
                )}
                {!chunkInspectorCollapsed && selectedDocumentForChunks && (
                  <button
                    onClick={() => void onFetchDocumentChunks(selectedDocumentForChunks.id, selectedEventId)}
                    disabled={documentChunksLoading}
                    className="rounded-xl p-2 transition-colors hover:bg-slate-200 disabled:opacity-50"
                    title="Refresh chunks"
                  >
                    <RefreshCw className={`h-4 w-4 text-slate-500 ${documentChunksLoading ? "animate-spin" : ""}`} />
                  </button>
                )}
                <CollapseIconButton collapsed={chunkInspectorCollapsed} onClick={onToggleChunkInspectorCollapsed} />
              </div>
            </div>

            {!chunkInspectorCollapsed && (
              <>
                {!selectedDocumentForChunks ? (
                  <div className="rounded-xl border border-dashed border-slate-200 bg-white px-3 py-2.5 text-xs text-slate-500">
                    Select a document to inspect its chunks.
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    <div className="rounded-xl border border-slate-200 bg-white p-3">
                      <p className="font-semibold text-slate-900">{selectedDocumentForChunks.title}</p>
                      <StatusLine
                        className="mt-2"
                        items={[
                          selectedDocumentForChunks.source_type,
                          `${selectedDocumentForChunks.chunk_count || 0} chunks`,
                          selectedDocumentForChunks.is_active ? "active" : "inactive",
                          `embed ${selectedDocumentForChunks.embedding_status || "pending"}`,
                        ]}
                      />
                    </div>

                    <div className="max-h-[24rem] space-y-2 overflow-y-auto pr-1">
                      {documentChunksLoading && (
                        <div className="rounded-xl border border-slate-200 bg-white p-3 text-xs text-slate-500">
                          Loading chunks...
                        </div>
                      )}
                      {!documentChunksLoading && documentChunks.length === 0 && (
                        <div className="rounded-xl border border-dashed border-slate-200 bg-white p-3 text-xs text-slate-500">
                          No chunks generated for this document yet.
                        </div>
                      )}
                      {!documentChunksLoading && documentChunks.map((chunk) => (
                        <div key={chunk.id} className="rounded-xl border border-slate-200 bg-white p-3">
                          <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                            Chunk {chunk.chunk_index + 1}
                          </p>
                          <p className="whitespace-pre-wrap text-sm text-slate-700">{chunk.content}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

          <div className={`rounded-2xl border border-slate-200 bg-slate-50 text-sm text-slate-600 shadow-sm ${embeddingPreviewCollapsed ? "p-2.5 sm:p-3" : "p-3 sm:p-4"}`}>
            <div className={`${embeddingPreviewCollapsed ? "mb-0" : "mb-2"} flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between`}>
              <button
                type="button"
                onClick={onToggleEmbeddingPreviewCollapsed}
                className="min-w-0 flex-1 text-left"
                aria-label={`${embeddingPreviewCollapsed ? "Expand" : "Collapse"} Embedding Preview`}
              >
                <h3 className="font-semibold text-slate-900">Embedding Preview</h3>
              </button>
              <div className="flex w-full items-center gap-2 sm:w-auto sm:justify-end">
                {!embeddingPreviewCollapsed && (
                  <HelpPopover label="Open note for Embedding Preview">
                    Vector-ready metadata and hook payload for the selected document.
                  </HelpPopover>
                )}
                {!embeddingPreviewCollapsed && selectedDocumentForChunks && (
                  <div className="flex w-full items-center gap-2 sm:w-auto">
                    <ActionButton
                      onClick={() => void onEnqueueEmbedding(selectedDocumentForChunks.id, selectedEventId)}
                      disabled={embeddingPreviewLoading || embeddingEnqueueLoading}
                      tone="neutral"
                      active
                      className="min-w-0 flex-1 text-sm sm:flex-none"
                    >
                      {embeddingPreviewLoading || embeddingEnqueueLoading ? (
                        <RefreshCw className="h-4 w-4 animate-spin" />
                      ) : (
                        <Save className="h-4 w-4" />
                      )}
                      Queue Embedding
                    </ActionButton>
                    <button
                      onClick={() => void onFetchEmbeddingPreview(selectedDocumentForChunks.id, selectedEventId)}
                      disabled={embeddingPreviewLoading || embeddingEnqueueLoading}
                      className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl p-2 transition-colors hover:bg-slate-200 disabled:opacity-50"
                      title="Refresh embedding preview"
                    >
                      <RefreshCw className={`h-4 w-4 text-slate-500 ${embeddingPreviewLoading ? "animate-spin" : ""}`} />
                    </button>
                  </div>
                )}
                <CollapseIconButton collapsed={embeddingPreviewCollapsed} onClick={onToggleEmbeddingPreviewCollapsed} />
              </div>
            </div>

            {!embeddingPreviewCollapsed && (
              <>
                {!selectedDocumentForChunks ? (
                  <div className="rounded-xl border border-dashed border-slate-200 bg-white px-3 py-2.5 text-xs text-slate-500">
                    Select a document to inspect its vector-ready metadata.
                  </div>
                ) : (
                  <div className="min-w-0 space-y-3">
                    <div className="rounded-xl border border-blue-100 bg-blue-50 p-3 text-xs leading-relaxed text-blue-800">
                      After a successful queue run, the worker generates embeddings and stores vectors in this system first, so retrieval can use cosine similarity together with keyword ranking.{" "}
                      <span className="font-semibold">Queue Embedding</span>{" "}
                      can also send the payload to{" "}
                      <span className="font-mono">EMBEDDING_HOOK_URL</span>{" "}
                      if you also want to sync the result to an external system.
                    </div>

                    <div className="grid grid-cols-1 gap-3 2xl:grid-cols-2">
                      <div className="min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-white p-3">
                        <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500">Document Embedding State</p>
                        <div className="space-y-2 text-sm">
                          <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
                            <span className="text-slate-600">Embedding model</span>
                            <span className="self-start text-xs font-medium text-slate-700 sm:self-auto">
                              {embeddingPreview?.embedding_model || "text-embedding-3-small"}
                            </span>
                          </div>
                          <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
                            <span className="text-slate-600">Document status</span>
                            <span className="self-start text-xs font-medium text-slate-700 sm:self-auto">
                              {embeddingPreview?.document.embedding_status || selectedDocumentForChunks.embedding_status || "pending"}
                            </span>
                          </div>
                          <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
                            <span className="text-slate-600">Document content hash</span>
                            <span className="w-full min-w-0 break-all text-left font-mono text-xs text-slate-500 sm:max-w-[14rem] sm:text-right">
                              {embeddingPreview?.document.content_hash || selectedDocumentForChunks.content_hash || "-"}
                            </span>
                          </div>
                          <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
                            <span className="text-slate-600">Chunk count</span>
                            <span className="self-start text-xs font-medium text-slate-700 sm:self-auto">
                              {embeddingPreview?.chunks.length ?? selectedDocumentForChunks.chunk_count ?? 0}
                            </span>
                          </div>
                        </div>
                        {embeddingPreviewMessage && (
                          <p className={`mt-3 text-xs ${embeddingPreviewMessage.toLowerCase().includes("failed") || embeddingPreviewMessage.toLowerCase().includes("error") ? "text-rose-600" : "text-slate-500"}`}>
                            {embeddingPreviewMessage}
                          </p>
                        )}
                      </div>

                      <div className="min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-white p-3">
                        <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500">Chunk Metadata</p>
                        <div className="max-h-[14rem] space-y-2 overflow-y-auto overflow-x-hidden pr-1">
                          {embeddingPreviewLoading && (
                            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-500">
                              Loading embedding preview...
                            </div>
                          )}
                          {!embeddingPreviewLoading && !embeddingPreview?.chunks.length && (
                            <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-3 text-xs text-slate-500">
                              No chunks available for embedding yet.
                            </div>
                          )}
                          {!embeddingPreviewLoading && embeddingPreview?.chunks.map((chunk) => (
                            <div key={chunk.id} className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 p-3">
                              <StatusLine
                                className="mb-2"
                                items={[
                                  <>chunk {chunk.chunk_index + 1}</>,
                                  `${chunk.char_count || chunk.content.length} chars`,
                                  `~${chunk.token_estimate || 0} tokens`,
                                  chunk.embedding_status || "pending",
                                ]}
                              />
                              <p className="break-all font-mono text-xs text-slate-500">{chunk.content_hash || "-"}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>

                    <div className="min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-white p-3">
                      <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500">Embedding Hook Payload</p>
                      <div className="max-h-[22rem] overflow-y-auto overflow-x-hidden rounded-xl border border-slate-200 bg-slate-50 p-3">
                        <pre className="whitespace-pre-wrap break-all font-mono text-xs text-slate-700">
                          {embeddingPreview ? JSON.stringify(embeddingPreview.payload, null, 2) : "Select a document to preview the embedding payload."}
                        </pre>
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

          <div className={`rounded-2xl border border-slate-200 bg-slate-50 text-sm text-slate-600 shadow-sm ${retrievalDebugCollapsed ? "p-2.5 sm:p-3" : "p-3 sm:p-4"}`}>
            <div className={`${retrievalDebugCollapsed ? "mb-0" : "mb-2"} flex items-center justify-between gap-2`}>
              <button
                type="button"
                onClick={onToggleRetrievalDebugCollapsed}
                className="min-w-0 flex-1 text-left"
                aria-label={`${retrievalDebugCollapsed ? "Expand" : "Collapse"} Retrieval Debug`}
              >
                <h3 className="font-semibold text-slate-900">Retrieval Debug</h3>
              </button>
              <div className="flex items-center gap-2">
                {!retrievalDebugCollapsed && (
                  <HelpPopover label="Open note for Retrieval Debug">
                    Inspect which event chunks this workspace would send into the prompt for a specific question.
                  </HelpPopover>
                )}
                <CollapseIconButton collapsed={retrievalDebugCollapsed} onClick={onToggleRetrievalDebugCollapsed} />
              </div>
            </div>

            {!retrievalDebugCollapsed && (
              <div className="space-y-3">
                <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1.4fr,0.9fr]">
                  <div className="rounded-xl border border-slate-200 bg-white p-3">
                    <label className="mb-2 block text-xs font-semibold uppercase tracking-wider text-slate-500">Test Query</label>
                    <textarea
                      value={retrievalQuery}
                      onChange={(event) => onRetrievalQueryChange(event.target.value)}
                      rows={2}
                      placeholder="Example: Where is this event held, how do attendees get there, and when does registration close?"
                      className="w-full resize-none rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <div className="mt-3 flex items-center gap-2">
                      <ActionButton
                        onClick={() => void onFetchRetrievalDebug()}
                        disabled={!selectedEventId || retrievalLoading || !retrievalQuery.trim()}
                        tone="neutral"
                        active
                        className="text-sm"
                      >
                        {retrievalLoading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                        Analyze Retrieval
                      </ActionButton>
                      {retrievalDebug && (
                        <span className="text-xs text-slate-500">
                          Event-scoped results for <span className="font-semibold text-slate-700">{selectedEvent?.name || "selected event"}</span>
                        </span>
                      )}
                    </div>
                    {retrievalMessage && (
                      <p className={`mt-3 text-xs ${retrievalMessage.toLowerCase().includes("failed") || retrievalMessage.toLowerCase().includes("error") ? "text-rose-600" : "text-amber-700"}`}>
                        {retrievalMessage}
                      </p>
                    )}
                  </div>

                  <div className="rounded-xl border border-slate-200 bg-white p-3">
                    <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500">Prompt Layers</p>
                    <div className="space-y-2 text-sm">
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-slate-600">Retrieval mode</span>
                        <span className="text-xs font-medium text-slate-700">
                          {retrievalDebug?.layers.retrieval_mode || "lexical"}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-slate-600">Global system prompt</span>
                        <span className="text-xs font-medium text-slate-700">
                          {retrievalDebug?.layers.global_system_prompt_present ? `${retrievalDebug.layers.global_system_prompt_chars} chars` : "empty"}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-slate-600">Event context</span>
                        <span className="text-xs font-medium text-slate-700">
                          {retrievalDebug?.layers.event_context_present ? `${retrievalDebug.layers.event_context_chars} chars` : "empty"}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-slate-600">Active documents</span>
                        <span className="text-xs font-medium text-slate-700">
                          {retrievalDebug?.layers.active_document_count ?? activeDocumentCount}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-slate-600">Active chunks</span>
                        <span className="text-xs font-medium text-slate-700">
                          {retrievalDebug?.layers.active_chunk_count ?? documentChunks.length}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-slate-600">Vector-ready chunks</span>
                        <span className="text-xs font-medium text-slate-700">
                          {retrievalDebug?.layers.vector_ready_chunk_count ?? 0}
                        </span>
                      </div>
                      {retrievalDebug?.layers.query_embedding_model && (
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-slate-600">Query embedding model</span>
                          <span className="text-xs font-medium text-slate-700">
                            {retrievalDebug.layers.query_embedding_model}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {retrievalDebug && (
                  <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.2fr,0.9fr]">
                    <div className="rounded-2xl border border-slate-200 bg-white p-4">
                      <div className="mb-3 flex items-center justify-between gap-3">
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Matched Chunks</p>
                          <p className="text-xs text-slate-500">Top ranked event chunks for this query.</p>
                        </div>
                        <span className="text-xs font-medium text-slate-700">{retrievalDebug.matches.length} matches</span>
                      </div>

                      <div className="max-h-[26rem] space-y-3 overflow-y-auto pr-1">
                        {retrievalDebug.matches.length === 0 && (
                          <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-4 text-xs text-slate-500">
                            No ranked chunks for this query. The bot will answer from global rules and event context only.
                          </div>
                        )}
                        {retrievalDebug.matches.map((match) => (
                          <div key={`${match.document_id}:${match.chunk_index}:${match.rank}`} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                            <StatusLine
                              className="mb-3"
                              items={[
                                <>#{match.rank}</>,
                                `score ${match.score.toFixed(2)}`,
                                match.strategy || null,
                                typeof match.vector_score === "number" ? `vector ${match.vector_score.toFixed(2)}` : null,
                                typeof match.lexical_score === "number" ? `lexical ${match.lexical_score}` : null,
                                match.source_type,
                                `chunk ${match.chunk_index + 1}`,
                              ]}
                            />
                            <p className="font-semibold text-slate-900">{match.document_title}</p>
                            {match.source_url && (
                              <a
                                href={match.source_url}
                                target="_blank"
                                rel="noreferrer"
                                className="mt-1 inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700"
                              >
                                <ExternalLink className="h-3 w-3" />
                                Open source URL
                              </a>
                            )}
                            <p className="mt-3 whitespace-pre-wrap text-sm text-slate-700">{match.chunk_content}</p>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="rounded-2xl border border-slate-200 bg-white p-4">
                      <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500">Injected Knowledge Context</p>
                      <div className="max-h-[26rem] overflow-y-auto rounded-2xl border border-slate-200 bg-slate-50 p-4">
                        <pre className="whitespace-pre-wrap font-mono text-xs text-slate-700">
                          {retrievalDebug.composed_knowledge_context || "No knowledge context was composed for this query."}
                        </pre>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className={`rounded-2xl border border-slate-200 bg-white shadow-sm ${llmUsageCollapsed ? "p-2.5 sm:p-3" : "p-3 sm:p-4"}`}>
            <div className={`${llmUsageCollapsed ? "mb-0 items-center" : "mb-3 items-start"} flex flex-col gap-2 sm:flex-row sm:justify-between`}>
              <div>
                <h3 className="flex items-center gap-2 text-lg font-semibold">
                  <Activity className="h-5 w-5 text-blue-600" />
                  LLM Usage
                </h3>
                {!llmUsageCollapsed && (
                  <p className="text-sm text-slate-500">Track token burn and estimated spend per event before turning this into credits.</p>
                )}
              </div>
              <div className="flex items-center gap-2">
                {!llmUsageCollapsed && (
                  <button
                    onClick={() => void onFetchLlmUsageSummary(selectedEventId)}
                    disabled={llmUsageLoading}
                    className="inline-flex h-10 items-center justify-center rounded-2xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50"
                    title="Refresh LLM usage"
                  >
                    <RefreshCw className={`h-4 w-4 ${llmUsageLoading ? "animate-spin" : ""}`} />
                  </button>
                )}
                <CollapseIconButton collapsed={llmUsageCollapsed} onClick={onToggleLlmUsageCollapsed} label="LLM usage" />
              </div>
            </div>
            {!llmUsageCollapsed && (
              <>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 2xl:grid-cols-4">
                  <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
                    <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">Gateway</p>
                    <p className="mt-1 break-words text-sm font-semibold leading-snug text-slate-900">OpenRouter API</p>
                    <p className="mt-1 text-[11px] leading-relaxed text-slate-500">Central billing point for all event chats.</p>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
                    <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">Active Model</p>
                    <p className="mt-1 break-all text-sm font-semibold leading-snug text-slate-900">{activeLlmModel}</p>
                    <p className="mt-1 text-[11px] leading-relaxed text-slate-500">Current workspace resolves to this model.</p>
                  </div>
                  <div className="rounded-xl border border-blue-100 bg-blue-50 px-3 py-3">
                    <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-blue-600">Selected Event</p>
                    <p className="mt-1 text-sm font-semibold leading-snug text-blue-900">
                      {formatCompactNumber(selectedEventUsage?.total_tokens || 0)} tokens
                    </p>
                    <p className="mt-1 text-[11px] leading-relaxed text-blue-700">
                      {formatUsdCost(selectedEventUsage?.estimated_cost_usd || 0)} across {formatCompactNumber(selectedEventUsage?.request_count || 0)} requests
                    </p>
                  </div>
                  <div className="rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-3">
                    <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-emerald-600">All Workspaces</p>
                    <p className="mt-1 text-sm font-semibold leading-snug text-emerald-900">
                      {formatCompactNumber(overallLlmUsage?.total_tokens || 0)} tokens
                    </p>
                    <p className="mt-1 text-[11px] leading-relaxed text-emerald-700">
                      {formatUsdCost(overallLlmUsage?.estimated_cost_usd || 0)} across {formatCompactNumber(overallLlmUsage?.request_count || 0)} requests
                    </p>
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-1 gap-3 xl:grid-cols-2">
                  <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">Top Models In Event</p>
                      <span className="text-xs font-medium text-slate-500">{llmUsageSummary?.selected_event_models.length || 0}</span>
                    </div>
                    <div className="mt-3 space-y-2">
                      {(llmUsageSummary?.selected_event_models.length || 0) === 0 ? (
                        <p className="text-xs text-slate-500">No usage captured for this event yet.</p>
                      ) : (
                        llmUsageSummary?.selected_event_models.map((item) => (
                          <div key={`event-model-${item.provider}-${item.model}`} className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2">
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium text-slate-900">{item.model}</p>
                              <p className="text-[11px] text-slate-500">{formatCompactNumber(item.request_count)} requests</p>
                            </div>
                            <div className="text-right">
                              <p className="text-xs font-semibold text-slate-900">{formatCompactNumber(item.total_tokens)} tk</p>
                              <p className="text-[11px] text-slate-500">{formatUsdCost(item.estimated_cost_usd)}</p>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">Top Models Overall</p>
                      <span className="text-xs font-medium text-slate-500">{llmUsageSummary?.overall_models.length || 0}</span>
                    </div>
                    <div className="mt-3 space-y-2">
                      {(llmUsageSummary?.overall_models.length || 0) === 0 ? (
                        <p className="text-xs text-slate-500">No global usage captured yet.</p>
                      ) : (
                        llmUsageSummary?.overall_models.map((item) => (
                          <div key={`all-model-${item.provider}-${item.model}`} className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2">
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium text-slate-900">{item.model}</p>
                              <p className="text-[11px] text-slate-500">{formatCompactNumber(item.request_count)} requests</p>
                            </div>
                            <div className="text-right">
                              <p className="text-xs font-semibold text-slate-900">{formatCompactNumber(item.total_tokens)} tk</p>
                              <p className="text-[11px] text-slate-500">{formatUsdCost(item.estimated_cost_usd)}</p>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>

                {llmUsageError && <p className="mt-3 text-xs text-rose-600">{llmUsageError}</p>}
                {!llmUsageError && (
                  <p className="mt-3 text-xs text-slate-500">
                    Usage is captured from the OpenRouter response payload at request time, so this can become the ledger for credit deduction later.
                  </p>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  );
}

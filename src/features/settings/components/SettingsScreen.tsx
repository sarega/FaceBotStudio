import { useState, type ReactNode } from "react";
import { motion } from "motion/react";
import {
  Bot,
  CheckCircle2,
  Copy,
  Link2,
  PencilLine,
  Plus,
  Power,
  RefreshCw,
  Save,
  Settings as SettingsIcon,
} from "lucide-react";

import {
  ActionButton,
  ChannelPlatformLogo,
  CollapseIconButton,
  HelpPopover,
  InlineWarning,
  PageBanner,
  SelectionMarker,
  StatusBadge,
  StatusLine,
  type BannerTone,
} from "../../../components/shared/AppUi";
import type { ChannelAccountRecord, EventRecord, Settings } from "../../../types";

type LlmModelOption = {
  id: string;
  context_length?: number;
};

type WebhookConfigKey = string;

type WebhookConfigItem = {
  key: WebhookConfigKey;
  label: string;
  value: string;
  help?: ReactNode;
};

type ChannelTokenStatusMeta = {
  label: string;
  className: string;
  icon: ReactNode;
};

type SettingsScreenProps = {
  settings: Settings;
  onSettingsChange: (nextSettings: Settings) => void;
  aiSettingsDirty: boolean;
  llmModelsLoading: boolean;
  onSaveAiSettings: () => unknown;
  saving: boolean;
  llmModels: LlmModelOption[];
  selectedEvent: EventRecord | null;
  settingsMessage: string;
  llmModelsError: string;
  workspaceChannelCount: number;
  workspaceActiveChannelCount: number;
  workspaceChannelPlatformCount: number;
  workspaceChannelEventCount: number;
  workspaceChannelPreview: ChannelAccountRecord[];
  workspaceOtherEventChannels: ChannelAccountRecord[];
  setupSelectedChannelId: string;
  eventNameById: Map<string, string>;
  onFocusSetupChannel: (channel: ChannelAccountRecord) => void;
  onOpenChannelConfigDialog: (channel?: ChannelAccountRecord) => void;
  onAssignChannelToSelectedEvent: (channel: ChannelAccountRecord) => unknown;
  eventLoading: boolean;
  selectedEventChannelWritesLocked: boolean;
  visibleSelectedEventChannels: ChannelAccountRecord[];
  getEventStatusLabel: (status: EventRecord["effective_status"]) => string;
  getRegistrationAvailabilityLabel: (status: EventRecord["registration_availability"]) => string;
  channelsCollapsed: boolean;
  onToggleChannelsCollapsed: () => void;
  eventOperatorGuardTone: BannerTone;
  eventOperatorGuardBody: ReactNode;
  setupSelectedChannel: ChannelAccountRecord | null;
  onSelectSetupChannel: (channel: ChannelAccountRecord) => void;
  getSearchTargetDomId: (kind: "channel", id: string) => string;
  isSearchFocused: (kind: "channel", id: string) => boolean;
  getChannelTokenStatusMeta: (channel: ChannelAccountRecord) => ChannelTokenStatusMeta;
  onUnassignChannelFromSelectedEvent: (channel: ChannelAccountRecord) => unknown;
  onToggleChannel: (channel: ChannelAccountRecord) => unknown;
  webhookConfigCollapsed: boolean;
  onToggleWebhookConfigCollapsed: () => void;
  selectedWebhookConfigKey: WebhookConfigKey;
  onSelectedWebhookConfigKeyChange: (key: WebhookConfigKey) => void;
  setupWebhookItems: WebhookConfigItem[];
  selectedWebhookConfigItem: WebhookConfigItem;
  copied: boolean;
  onCopyToClipboard: (value: string) => unknown;
  buildWebChatEmbedSnippet: (appUrl: string, externalId: string) => string;
  appUrl: string;
  webhookSettingsDirty: boolean;
  onSaveWebhookSettings: () => unknown;
};

export function SettingsScreen({
  settings,
  onSettingsChange,
  aiSettingsDirty,
  llmModelsLoading,
  onSaveAiSettings,
  saving,
  llmModels,
  selectedEvent,
  settingsMessage,
  llmModelsError,
  workspaceChannelCount,
  workspaceActiveChannelCount,
  workspaceChannelPlatformCount,
  workspaceChannelEventCount,
  workspaceChannelPreview,
  workspaceOtherEventChannels,
  setupSelectedChannelId,
  eventNameById,
  onFocusSetupChannel,
  onOpenChannelConfigDialog,
  onAssignChannelToSelectedEvent,
  eventLoading,
  selectedEventChannelWritesLocked,
  visibleSelectedEventChannels,
  getEventStatusLabel,
  getRegistrationAvailabilityLabel,
  channelsCollapsed,
  onToggleChannelsCollapsed,
  eventOperatorGuardTone,
  eventOperatorGuardBody,
  setupSelectedChannel,
  onSelectSetupChannel,
  getSearchTargetDomId,
  isSearchFocused,
  getChannelTokenStatusMeta,
  onUnassignChannelFromSelectedEvent,
  onToggleChannel,
  webhookConfigCollapsed,
  onToggleWebhookConfigCollapsed,
  selectedWebhookConfigKey,
  onSelectedWebhookConfigKeyChange,
  setupWebhookItems,
  selectedWebhookConfigItem,
  copied,
  onCopyToClipboard,
  buildWebChatEmbedSnippet,
  appUrl,
  webhookSettingsDirty,
  onSaveWebhookSettings,
}: SettingsScreenProps) {
  const [showCustomModelInput, setShowCustomModelInput] = useState(false);
  const knownEventOverrideModelIds = new Set([
    "google/gemini-3-flash-preview",
    "openrouter/auto",
    ...llmModels.map((model) => model.id),
  ]);
  const trimmedEventOverrideModel = settings.llm_model.trim();
  const selectedEventUsesCustomModel = Boolean(trimmedEventOverrideModel) && !knownEventOverrideModelIds.has(trimmedEventOverrideModel);
  const customModelInputVisible = showCustomModelInput || selectedEventUsesCustomModel;
  const selectedEventOverrideSelectValue =
    selectedEventUsesCustomModel || (showCustomModelInput && !trimmedEventOverrideModel)
      ? "__custom__"
      : settings.llm_model;

  return (
    <motion.div
      key="settings"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="space-y-4"
    >
      <PageBanner tone="blue" icon={<SettingsIcon className="h-4 w-4" />}>
        AI defaults and webhook settings apply organization-wide by default. Channel credentials are now managed as shared workspace connections, then assigned explicitly to the selected event when needed.
      </PageBanner>
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-12">
        <div className="space-y-4 xl:col-span-8">
          <div className="surface-panel rounded-2xl p-4 sm:p-5">
            <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="flex items-center gap-2 text-lg font-semibold">
                    <Bot className="h-5 w-5 text-blue-600" />
                    AI Defaults
                  </h3>
                  <HelpPopover label="Open note for AI Defaults">
                    Organization-wide prompt policy and baseline model are configured here. Only create per-event overrides when a workspace genuinely needs different behavior than the shared default.
                  </HelpPopover>
                </div>
                <p className="text-sm text-slate-500">Organization-wide prompt and baseline model.</p>
                <StatusLine
                  className="mt-1"
                  items={[
                    aiSettingsDirty ? "Unsaved changes" : "All changes saved",
                    llmModelsLoading ? "Syncing model list" : null,
                  ]}
                />
              </div>
              <ActionButton
                onClick={() => void onSaveAiSettings()}
                disabled={saving}
                tone="blue"
                active
                className="w-full text-sm sm:w-auto"
              >
                {saving ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Save AI Policy
              </ActionButton>
            </div>
            <div className="space-y-4">
              <div className="surface-subpanel space-y-4 rounded-2xl p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">Organization Defaults</p>
                      <HelpPopover label="Open note for Organization Defaults">
                        Every event inherits these settings unless an event-specific override is enabled. Keep universal tone, model choice, and escalation behavior here rather than repeating it on each event.
                      </HelpPopover>
                    </div>
                    <p className="mt-1 text-sm text-slate-500">Inherited unless an event override is enabled.</p>
                  </div>
                  <StatusLine items={["Applies to all events"]} />
                </div>

                <div>
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <label className="block text-xs font-bold uppercase text-slate-500">Organization System Prompt</label>
                    <HelpPopover label="Open note for Organization System Prompt">
                      Organization-wide tone, safety rules, and escalation behavior belong here. Event-specific content should stay in Context.
                    </HelpPopover>
                  </div>
                  <textarea
                    value={settings.global_system_prompt}
                    onChange={(event) => onSettingsChange({ ...settings, global_system_prompt: event.target.value })}
                    className="h-40 w-full resize-none rounded-xl border border-slate-200 bg-white p-4 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Global operating rules for the bot across all events and channels."
                  />
                </div>

                <div>
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <label className="block text-xs font-bold uppercase text-slate-500">Organization Default Model</label>
                    <HelpPopover label="Open note for Organization Default Model">
                      Keep one stable default model here unless an event has a real reason to override it.
                    </HelpPopover>
                  </div>
                  <select
                    value={settings.global_llm_model}
                    onChange={(event) => onSettingsChange({ ...settings, global_llm_model: event.target.value })}
                    className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="google/gemini-3-flash-preview">google/gemini-3-flash-preview (recommended)</option>
                    <option value="openrouter/auto">openrouter/auto</option>
                    {llmModels.map((model) => (
                      <option key={`global-${model.id}`} value={model.id}>
                        {model.id}
                        {model.context_length ? ` (${model.context_length.toLocaleString()} ctx)` : ""}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="surface-subpanel space-y-3 rounded-2xl p-3.5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">Selected Event Override</p>
                      <HelpPopover label="Open note for Selected Event Override">
                        Use an event override only when the selected workspace truly needs a different model than the organization default. Event-specific instructions still belong in Context or Event Setup, not here.
                      </HelpPopover>
                    </div>
                    <p className="mt-1 text-sm text-slate-500">
                      {selectedEvent
                        ? `${selectedEvent.name} only needs an override when the default model is genuinely not a fit.`
                        : "Select an event to manage overrides."}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge tone={settings.llm_model ? "amber" : "neutral"}>
                      {settings.llm_model ? "Override active" : "Using org default"}
                    </StatusBadge>
                    {selectedEventUsesCustomModel && <StatusBadge tone="blue">Custom ID</StatusBadge>}
                    {!selectedEventUsesCustomModel && (
                      <ActionButton
                        onClick={() => setShowCustomModelInput((current) => !current)}
                        tone="neutral"
                        className="px-3 text-sm"
                      >
                        {showCustomModelInput ? "Hide Custom ID" : "Custom Model ID"}
                      </ActionButton>
                    )}
                    {settings.llm_model && (
                      <ActionButton
                        onClick={() => {
                          setShowCustomModelInput(false);
                          onSettingsChange({ ...settings, llm_model: "" });
                        }}
                        tone="neutral"
                        className="px-3 text-sm"
                      >
                        Reset to default
                      </ActionButton>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
                  <div>
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <label className="block text-xs font-bold uppercase text-slate-500">Override Model</label>
                      <HelpPopover label="Open note for Preset Override Model">
                        Set an event override only when this workspace truly needs different model behavior than the organization default.
                      </HelpPopover>
                    </div>
                    <select
                      value={selectedEventOverrideSelectValue}
                      onChange={(event) => {
                        const nextValue = event.target.value;
                        if (nextValue === "__custom__") {
                          setShowCustomModelInput(true);
                          if (!selectedEventUsesCustomModel) {
                            onSettingsChange({ ...settings, llm_model: "" });
                          }
                          return;
                        }

                        setShowCustomModelInput(false);
                        onSettingsChange({ ...settings, llm_model: nextValue });
                      }}
                      className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="">Use organization default model</option>
                      <option value="google/gemini-3-flash-preview">google/gemini-3-flash-preview</option>
                      <option value="openrouter/auto">openrouter/auto</option>
                      {llmModels.map((model) => (
                        <option key={`event-${model.id}`} value={model.id}>
                          {model.id}
                          {model.context_length ? ` (${model.context_length.toLocaleString()} ctx)` : ""}
                        </option>
                      ))}
                      <option value="__custom__">Use custom model ID below</option>
                    </select>
                    <p className="mt-1 text-[11px] text-slate-500">
                      Keep this empty unless the selected event must break from the organization default.
                    </p>
                  </div>

                  <StatusLine
                    className="lg:justify-self-end"
                    items={[
                      selectedEvent ? "Saved on selected event" : null,
                      customModelInputVisible ? "Advanced visible" : null,
                    ]}
                  />
                </div>

                {customModelInputVisible && (
                  <div className="border-t border-slate-200 pt-3">
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <label className="block text-xs font-bold uppercase text-slate-500">Advanced: Custom Model ID</label>
                      <HelpPopover label="Open note for Advanced Custom Model ID">
                        Leave this blank to inherit the organization default. When filled, only the selected event uses this specific model ID.
                      </HelpPopover>
                    </div>
                    <input
                      value={selectedEventUsesCustomModel ? settings.llm_model : ""}
                      onChange={(event) => onSettingsChange({ ...settings, llm_model: event.target.value })}
                      className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2 font-mono text-sm outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="Paste a specific event model ID if needed."
                    />
                    <p className="mt-1 text-[11px] text-slate-500">
                      Only needed when the required model is not in the preset list above.
                    </p>
                  </div>
                )}
              </div>

              {llmModelsError && <p className="text-xs text-rose-600">{llmModelsError}</p>}
              {settingsMessage && (
                <p className={`text-xs ${settingsMessage.toLowerCase().includes("failed") || settingsMessage.toLowerCase().includes("error") ? "text-rose-600" : "text-emerald-600"}`}>
                  {settingsMessage}
                </p>
              )}
            </div>
          </div>

          <div className="surface-panel space-y-4 rounded-2xl p-4 sm:p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="flex items-center gap-2 text-lg font-semibold">
                    <Link2 className="h-5 w-5 text-blue-600" />
                    Workspace Channel Inventory
                  </h3>
                  <HelpPopover label="Open note for Workspace Channel Inventory">
                    Connection credentials are managed once at the workspace level, then explicitly assigned or moved into events. This keeps shared channels reusable instead of recreating credentials per event.
                  </HelpPopover>
                </div>
                <p className="mt-1 text-sm text-slate-500">Shared connections available across events.</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
              <div className="surface-tile rounded-xl px-3 py-3">
                <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">Configs</p>
                <p className="mt-1 text-lg font-bold text-slate-900">{workspaceChannelCount}</p>
              </div>
              <div className="surface-tile rounded-xl px-3 py-3">
                <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">Active</p>
                <p className="mt-1 text-lg font-bold text-slate-900">{workspaceActiveChannelCount}</p>
              </div>
              <div className="surface-tile rounded-xl px-3 py-3">
                <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">Platforms</p>
                <p className="mt-1 text-lg font-bold text-slate-900">{workspaceChannelPlatformCount}</p>
              </div>
              <div className="surface-tile rounded-xl px-3 py-3">
                <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">Events Wired</p>
                <p className="mt-1 text-lg font-bold text-slate-900">{workspaceChannelEventCount}</p>
              </div>
            </div>

            {workspaceChannelPreview.length === 0 ? (
              <div className="surface-dashed rounded-xl border border-dashed p-4 text-sm text-slate-400">
                {workspaceChannelCount === 0
                  ? "No channels configured anywhere in this workspace yet."
                  : "All configured channels currently belong to the selected event. Use Selected Event Channels below to manage them."}
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                {workspaceChannelPreview.map((channel) => {
                  const isSelected = setupSelectedChannelId === channel.id;
                  return (
                    <div
                      key={`workspace-${channel.id}`}
                      role="button"
                      tabIndex={0}
                      onClick={() => onFocusSetupChannel(channel)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          onFocusSetupChannel(channel);
                        }
                      }}
                      className={`cursor-pointer rounded-2xl border p-3 transition ${
                        isSelected
                          ? "border-blue-200 bg-blue-50"
                          : "border-slate-200 bg-slate-50 hover:border-slate-300"
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <ChannelPlatformLogo platform={channel.platform} />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-sm font-semibold leading-snug text-slate-900">{channel.display_name}</p>
                            {isSelected && <SelectionMarker />}
                          </div>
                          <p className="mt-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">
                            {channel.platform_label || channel.platform}
                          </p>
                          <p className="mt-1 text-[11px] text-slate-500">
                            {channel.event_id
                              ? `Assigned to ${eventNameById.get(channel.event_id) || channel.event_id}`
                              : "Currently unassigned"}
                          </p>
                          <div className="mt-3 flex flex-wrap items-center gap-2">
                            <ActionButton
                              onClick={(event) => {
                                event.stopPropagation();
                                onOpenChannelConfigDialog(channel);
                              }}
                              tone="blue"
                              className="px-3 text-sm"
                            >
                              <PencilLine className="h-3.5 w-3.5" />
                              Configure
                            </ActionButton>
                            <ActionButton
                              onClick={(event) => {
                                event.stopPropagation();
                                void onAssignChannelToSelectedEvent(channel);
                              }}
                              disabled={eventLoading || selectedEventChannelWritesLocked}
                              tone="neutral"
                              className="px-3 text-sm"
                            >
                              <Link2 className="h-3.5 w-3.5" />
                              {channel.event_id ? "Move to Selected Event" : "Assign to Selected Event"}
                            </ActionButton>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {workspaceOtherEventChannels.length > workspaceChannelPreview.length && (
              <p className="text-xs text-slate-500">
                Showing {workspaceChannelPreview.length} of {workspaceOtherEventChannels.length} channels not currently assigned to the selected event.
              </p>
            )}
          </div>

          <div className="surface-panel space-y-4 rounded-2xl p-4 sm:p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="flex items-center gap-2 text-lg font-semibold">
                    <Link2 className="h-5 w-5 text-blue-600" />
                    Selected Event Channels
                  </h3>
                  <HelpPopover label="Open note for Selected Event Channels">
                    These assignments apply only to the currently selected event. Use this section for fast routing control, channel health checks, and event-specific enable or disable actions.
                  </HelpPopover>
                </div>
                <StatusLine
                  className="mt-1"
                  items={[
                    `${visibleSelectedEventChannels.length} linked`,
                    selectedEvent ? getEventStatusLabel(selectedEvent.effective_status) : null,
                    selectedEvent?.registration_availability && selectedEvent.registration_availability !== "open"
                      ? getRegistrationAvailabilityLabel(selectedEvent.registration_availability)
                      : null,
                  ]}
                />
                {!channelsCollapsed && (
                  <p className="text-sm text-slate-500">Assignments that apply only to the selected event.</p>
                )}
              </div>
              <div className="flex items-center gap-2">
                {!channelsCollapsed && (
                  <ActionButton
                    onClick={() => onOpenChannelConfigDialog()}
                    disabled={selectedEventChannelWritesLocked}
                    tone="blue"
                    active
                    className="px-3 text-sm"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    New Connection
                  </ActionButton>
                )}
                <CollapseIconButton collapsed={channelsCollapsed} onClick={onToggleChannelsCollapsed} />
              </div>
            </div>

            {!channelsCollapsed && (
              <>
                {selectedEvent && selectedEvent.registration_availability && selectedEvent.registration_availability !== "open" ? (
                  <InlineWarning tone="amber">
                    Channels remain connected, but closed-registration guardrails are active.
                  </InlineWarning>
                ) : (
                  <InlineWarning tone={eventOperatorGuardTone}>
                    {eventOperatorGuardBody}
                  </InlineWarning>
                )}

                {visibleSelectedEventChannels.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-slate-200 p-4 text-sm text-slate-400">
                    No channels assigned to this event yet. Use New Connection to create one, or assign an existing connection from Workspace Channel Inventory above.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                    {visibleSelectedEventChannels.map((channel) => {
                      const isSelected = setupSelectedChannel?.id === channel.id;
                      const isFocused = isSearchFocused("channel", channel.id);
                      const disableToggle = selectedEventChannelWritesLocked && !channel.is_active;
                      const tokenStatusMeta = getChannelTokenStatusMeta(channel);
                      const toggleLabel = disableToggle ? "Locked" : channel.is_active ? "Disable" : "Enable";

                      return (
                        <div
                          key={channel.id}
                          id={getSearchTargetDomId("channel", channel.id)}
                          role="button"
                          tabIndex={0}
                          onClick={() => onSelectSetupChannel(channel)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              onSelectSetupChannel(channel);
                            }
                          }}
                          className={`cursor-pointer rounded-2xl border p-3 transition ${
                            isSelected ? "border-blue-200 bg-blue-50" : "border-slate-200 bg-slate-50 hover:border-slate-300"
                          } ${isFocused ? "ring-2 ring-blue-200 ring-offset-2" : ""}`}
                        >
                          <div className="space-y-2.5">
                            <div className="flex items-start gap-3">
                              <ChannelPlatformLogo platform={channel.platform} />
                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-2">
                                  <p className="text-sm font-semibold leading-snug text-slate-900">{channel.display_name}</p>
                                  {isSelected && <SelectionMarker />}
                                </div>
                                <p className="mt-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">
                                  {channel.platform_label || channel.platform}
                                </p>
                                <p className="mt-1 break-all font-mono text-[11px] text-slate-500">{channel.external_id}</p>
                              </div>
                            </div>
                            <StatusLine
                              items={[
                                channel.connection_status ? `Connected ${channel.connection_status}` : "Connection incomplete",
                                channel.is_active ? "Channel active" : "Channel inactive",
                                <span className={`inline-flex items-center gap-1.5 ${tokenStatusMeta.className}`}>
                                  {tokenStatusMeta.icon}
                                  {tokenStatusMeta.label}
                                </span>,
                              ]}
                            />
                            {channel.missing_requirements && channel.missing_requirements.length > 0 && (
                              <p className="text-xs text-amber-700">Missing: {channel.missing_requirements.join(", ")}</p>
                            )}
                            <div className="flex flex-wrap items-center gap-2 pt-1">
                              <ActionButton
                                onClick={(event) => {
                                  event.stopPropagation();
                                  onOpenChannelConfigDialog(channel);
                                }}
                                tone="blue"
                                className="px-3 text-sm"
                              >
                                <PencilLine className="h-3.5 w-3.5" />
                                Configure
                              </ActionButton>
                              <ActionButton
                                onClick={(event) => {
                                  event.stopPropagation();
                                  void onUnassignChannelFromSelectedEvent(channel);
                                }}
                                disabled={eventLoading}
                                tone="neutral"
                                className="px-3 text-sm"
                              >
                                <Link2 className="h-3.5 w-3.5" />
                                Remove from Event
                              </ActionButton>
                              <ActionButton
                                onClick={(event) => {
                                  event.stopPropagation();
                                  void onToggleChannel(channel);
                                }}
                                disabled={eventLoading || disableToggle}
                                tone={disableToggle ? "neutral" : channel.is_active ? "amber" : "emerald"}
                                className="px-3 text-sm"
                              >
                                <Power className="h-3.5 w-3.5" />
                                {toggleLabel}
                              </ActionButton>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
                {selectedEvent && selectedEventChannelWritesLocked && (
                  <p className="text-xs text-amber-700">
                    Archived, closed, or cancelled events cannot link or re-enable channels. You can still remove an assignment or disable an active channel if you want to stop replies entirely.
                  </p>
                )}
                {selectedEvent && !selectedEventChannelWritesLocked && selectedEvent.registration_availability && selectedEvent.registration_availability !== "open" && (
                  <p className="text-xs text-slate-500">
                    Channel wiring stays available, but this event currently responds with guardrails for <span className="font-semibold">{getRegistrationAvailabilityLabel(selectedEvent.registration_availability)}</span> instead of accepting normal registrations.
                  </p>
                )}
              </>
            )}
          </div>
        </div>

        <div className="space-y-4 xl:col-span-4">
          <div className={`surface-panel rounded-2xl ${webhookConfigCollapsed ? "p-3 sm:p-3" : "space-y-4 p-4 sm:p-5"}`}>
            <div className={`${webhookConfigCollapsed ? "mb-0" : "mb-4"} flex items-center justify-between gap-2`}>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="flex items-center gap-2 text-lg font-semibold">
                    <SettingsIcon className="h-5 w-5 text-blue-600" />
                    Webhook & Sync
                  </h3>
                  <HelpPopover label="Open note for Webhook & Sync">
                    Organization-level endpoints live here. Selecting a channel card only changes which event assignment you are inspecting, not the underlying shared endpoint configuration.
                  </HelpPopover>
                </div>
                {!webhookConfigCollapsed && (
                  <p className="text-sm text-slate-500">Shared endpoints and sync secrets for connected channels.</p>
                )}
              </div>
              <CollapseIconButton collapsed={webhookConfigCollapsed} onClick={onToggleWebhookConfigCollapsed} />
            </div>
            {!webhookConfigCollapsed && (
              <div className="space-y-4">
                <div className="surface-subpanel rounded-2xl p-4">
                  {setupSelectedChannel ? (
                    <div className="space-y-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex min-w-0 items-start gap-3">
                          <ChannelPlatformLogo platform={setupSelectedChannel.platform} className="h-11 w-11 rounded-2xl" />
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-slate-900">{setupSelectedChannel.display_name}</p>
                            <p className="mt-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">
                              {setupSelectedChannel.platform_label || setupSelectedChannel.platform}
                            </p>
                            <p className="mt-1 break-all font-mono text-xs text-slate-500">{setupSelectedChannel.external_id}</p>
                          </div>
                        </div>
                        <ActionButton
                          onClick={() => onOpenChannelConfigDialog(setupSelectedChannel)}
                          tone="blue"
                          className="px-3 text-sm"
                        >
                          <PencilLine className="h-3.5 w-3.5" />
                          Configure
                        </ActionButton>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <StatusLine
                          items={[
                            setupSelectedChannel.connection_status || "incomplete",
                            setupSelectedChannel.is_active ? "active" : "inactive",
                          ]}
                        />
                      </div>
                      {setupSelectedChannel.platform_description && (
                        <p className="text-xs text-slate-600">{setupSelectedChannel.platform_description}</p>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <p className="text-sm font-semibold text-slate-900">No channel selected</p>
                      <p className="text-xs text-slate-500">Assign the first event channel to load endpoint setup details here.</p>
                      <ActionButton
                        onClick={() => onOpenChannelConfigDialog()}
                        tone="blue"
                        active
                        className="px-3 text-sm"
                      >
                        <Plus className="h-3.5 w-3.5" />
                        Assign Channel
                      </ActionButton>
                    </div>
                  )}
                </div>
                <div className="surface-subpanel rounded-2xl p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                    <div className="min-w-0 flex-1">
                      <label className="block text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">Webhook Endpoint</label>
                      <div className="mt-2 flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2">
                        <Link2 className="h-4 w-4 shrink-0 text-slate-400" />
                        <select
                          value={selectedWebhookConfigKey}
                          onChange={(event) => onSelectedWebhookConfigKeyChange(event.target.value)}
                          className="min-w-0 w-full bg-transparent text-sm font-medium outline-none"
                        >
                          {setupWebhookItems.map((item) => (
                            <option key={item.key} value={item.key}>
                              {item.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <button
                      onClick={() => void onCopyToClipboard(selectedWebhookConfigItem.value)}
                      className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
                      aria-label={`Copy ${selectedWebhookConfigItem.label}`}
                    >
                      {copied ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4 text-slate-400" />}
                      <span>Copy URL</span>
                    </button>
                  </div>
                  <div className="mt-4">
                    <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">Selected Endpoint</p>
                    <p className="mt-2 text-sm font-semibold text-slate-900">{selectedWebhookConfigItem.label}</p>
                  </div>
                  <textarea
                    readOnly
                    value={selectedWebhookConfigItem.value}
                    rows={4}
                    className="mt-3 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 font-mono text-sm leading-relaxed outline-none"
                  />
                  {selectedWebhookConfigItem.help ? (
                    <div className="mt-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-xs leading-relaxed text-slate-600">
                      {selectedWebhookConfigItem.help}
                    </div>
                  ) : null}
                  {setupSelectedChannel?.platform === "web_chat" && (
                    <div className="mt-3 space-y-2 rounded-2xl border border-violet-100 bg-violet-50 p-3">
                      <p className="text-xs font-semibold text-violet-800">Web Chat Embed Snippet</p>
                      <pre className="overflow-x-auto rounded-lg border border-violet-100 bg-white p-3 text-[11px] leading-relaxed text-slate-700">
                        <code>{buildWebChatEmbedSnippet(appUrl, setupSelectedChannel.external_id)}</code>
                      </pre>
                      <div className="flex flex-wrap items-center gap-2">
                        <ActionButton
                          onClick={() => void onCopyToClipboard(buildWebChatEmbedSnippet(appUrl, setupSelectedChannel.external_id))}
                          tone="violet"
                        >
                          Copy Embed
                        </ActionButton>
                        <ActionButton
                          onClick={() => void onCopyToClipboard(`${appUrl}/api/webchat/config/${encodeURIComponent(setupSelectedChannel.external_id)}`)}
                          tone="neutral"
                        >
                          Copy Config URL
                        </ActionButton>
                      </div>
                    </div>
                  )}
                  <p className="mt-3 text-xs text-slate-500">Endpoint list auto-filters by the selected channel platform.</p>
                </div>
                <div className="surface-subpanel rounded-2xl p-4">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <label className="block text-xs font-bold uppercase tracking-[0.18em] text-slate-500">Verify Token</label>
                    <StatusLine items={[webhookSettingsDirty ? "Unsaved" : "Saved"]} />
                  </div>
                  <div className="flex gap-2">
                    <input
                      value={settings.verify_token}
                      onChange={(event) => onSettingsChange({ ...settings, verify_token: event.target.value })}
                      className="flex-1 rounded-xl border border-slate-200 bg-white px-4 py-2 font-mono text-sm outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <ActionButton
                      onClick={() => void onSaveWebhookSettings()}
                      tone="blue"
                      active
                      className="px-3"
                    >
                      <Save className="h-5 w-5" />
                      Save
                    </ActionButton>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  );
}

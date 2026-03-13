import { motion } from "motion/react";
import {
  Bot,
  Copy,
  Link2,
  RefreshCw,
  Save,
} from "lucide-react";

import {
  ActionButton,
  CollapseIconButton,
  HelpPopover,
  StatusBadge,
} from "../../../components/shared/AppUi";
import type { Settings } from "../../../types";

type AgentSetupScreenProps = {
  onSaveAgentSettings: () => unknown;
  saving: boolean;
  canEditSettings: boolean;
  settings: Settings;
  onSettingsChange: (nextSettings: Settings) => void;
  agentRuntimeCollapsed: boolean;
  onToggleAgentRuntimeCollapsed: () => void;
  recommendedAdminAgentPrompt: string;
  desktopNotifyEnabled: boolean;
  onDesktopNotifyEnabledChange: (enabled: boolean) => void;
  desktopNotificationSupported: boolean;
  desktopNotifyPermission: "default" | "granted" | "denied" | "unsupported";
  desktopNotifyPermissionLabel: string;
  onRequestDesktopNotificationPermission: () => unknown;
  selectedEventId: string;
  agentExternalChannelCollapsed: boolean;
  onToggleAgentExternalChannelCollapsed: () => void;
  adminAgentTelegramWebhookUrl: string;
  adminAgentTelegramSetWebhookUrl: string;
  onCopyToClipboard: (value: string) => unknown;
  settingsMessage: string;
};

export function AgentSetupScreen({
  onSaveAgentSettings,
  saving,
  canEditSettings,
  settings,
  onSettingsChange,
  agentRuntimeCollapsed,
  onToggleAgentRuntimeCollapsed,
  recommendedAdminAgentPrompt,
  desktopNotifyEnabled,
  onDesktopNotifyEnabledChange,
  desktopNotificationSupported,
  desktopNotifyPermission,
  desktopNotifyPermissionLabel,
  onRequestDesktopNotificationPermission,
  selectedEventId,
  agentExternalChannelCollapsed,
  onToggleAgentExternalChannelCollapsed,
  adminAgentTelegramWebhookUrl,
  adminAgentTelegramSetWebhookUrl,
  onCopyToClipboard,
  settingsMessage,
}: AgentSetupScreenProps) {
  return (
    <motion.div
      key="agent-setup"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="space-y-4 xl:max-w-4xl"
    >
      <div className="flex items-center justify-end">
        <ActionButton
          onClick={() => void onSaveAgentSettings()}
          disabled={saving || !canEditSettings}
          tone="violet"
          active
          className="whitespace-nowrap px-3 text-sm"
        >
          {saving ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Save Agent Setup
        </ActionButton>
      </div>

      <div className={`rounded-2xl border border-slate-200 bg-white shadow-sm ${agentRuntimeCollapsed ? "p-3" : "space-y-4 p-4"}`}>
        <div className={`flex justify-between gap-3 ${agentRuntimeCollapsed ? "items-center" : "items-start"}`}>
          <button
            type="button"
            onClick={onToggleAgentRuntimeCollapsed}
            className="min-w-0 flex-1 text-left"
            aria-label={`${agentRuntimeCollapsed ? "Expand" : "Collapse"} Agent Runtime`}
          >
            <h3 className="flex items-center gap-2 text-lg font-semibold">
              <Bot className="h-5 w-5 text-violet-600" />
              Agent Runtime
            </h3>
            {!agentRuntimeCollapsed && (
              <p className="text-sm text-slate-500">
                Separate prompt/model and routing for Admin Agent, independent from event chat bot setup.
              </p>
            )}
          </button>
          <CollapseIconButton
            collapsed={agentRuntimeCollapsed}
            onClick={onToggleAgentRuntimeCollapsed}
            label="Agent Runtime"
          />
        </div>

        {!agentRuntimeCollapsed && (
          <>
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
              <label className="flex items-start gap-3 text-sm">
                <input
                  type="checkbox"
                  checked={settings.admin_agent_enabled === "1"}
                  onChange={(event) => onSettingsChange({ ...settings, admin_agent_enabled: event.target.checked ? "1" : "0" })}
                  disabled={!canEditSettings}
                  className="mt-0.5 h-4 w-4 rounded border-slate-300 text-violet-600 focus:ring-violet-500"
                />
                <span>
                  <span className="font-semibold text-slate-800">Enable Admin Agent</span>
                  <span className="mt-0.5 block text-xs text-slate-500">Controls both in-app Agent console and external Agent endpoints.</span>
                </span>
              </label>
            </div>

            <div>
              <div className="mb-1 flex items-center justify-between gap-2">
                <label className="block text-xs font-bold uppercase tracking-[0.16em] text-slate-500">Agent System Prompt (Admin)</label>
                <ActionButton
                  onClick={() => onSettingsChange({ ...settings, admin_agent_system_prompt: recommendedAdminAgentPrompt })}
                  disabled={!canEditSettings}
                  tone="neutral"
                  className="min-h-0 px-2 py-1 text-[11px]"
                >
                  Use Recommended
                </ActionButton>
              </div>
              <textarea
                value={settings.admin_agent_system_prompt}
                onChange={(event) => onSettingsChange({ ...settings, admin_agent_system_prompt: event.target.value })}
                disabled={!canEditSettings}
                className="h-28 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-violet-500"
                placeholder="System prompt for internal admin operations (separate from attendee chat bot)"
              />
              <p className="mt-1 text-[11px] text-slate-500">This prompt applies only to Admin Agent and does not affect the public-facing attendee bot.</p>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-bold uppercase tracking-[0.16em] text-slate-500">Agent Model Override</label>
                <input
                  value={settings.admin_agent_model}
                  onChange={(event) => onSettingsChange({ ...settings, admin_agent_model: event.target.value })}
                  disabled={!canEditSettings}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-sm outline-none focus:ring-2 focus:ring-violet-500"
                  placeholder="Blank = use event/global model"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-bold uppercase tracking-[0.16em] text-slate-500">Default Event ID (External)</label>
                <div className="flex gap-2">
                  <input
                    value={settings.admin_agent_default_event_id}
                    onChange={(event) => onSettingsChange({ ...settings, admin_agent_default_event_id: event.target.value })}
                    disabled={!canEditSettings}
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-sm outline-none focus:ring-2 focus:ring-violet-500"
                    placeholder="evt_default"
                  />
                  <ActionButton
                    onClick={() => onSettingsChange({ ...settings, admin_agent_default_event_id: selectedEventId })}
                    disabled={!canEditSettings || !selectedEventId}
                    tone="neutral"
                    className="shrink-0 px-2.5 text-[11px]"
                  >
                    Use Current
                  </ActionButton>
                </div>
              </div>
            </div>

            <details className="rounded-xl border border-slate-200 bg-slate-50">
              <summary className="cursor-pointer list-none px-3 py-2.5 text-sm font-semibold text-slate-800">
                Advanced Action Policy
              </summary>
              <div className="space-y-2 border-t border-slate-200 px-3 py-3 text-sm">
                <label className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    checked={settings.admin_agent_policy_read_event !== "0"}
                    onChange={(event) => onSettingsChange({ ...settings, admin_agent_policy_read_event: event.target.checked ? "1" : "0" })}
                    disabled={!canEditSettings}
                    className="mt-0.5 h-4 w-4 rounded border-slate-300 text-violet-600 focus:ring-violet-500"
                  />
                  <span><span className="font-medium">Event Read</span> <span className="text-xs text-slate-500">find_event, event overview</span></span>
                </label>
                <label className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    checked={settings.admin_agent_policy_manage_event_setup === "1"}
                    onChange={(event) => onSettingsChange({ ...settings, admin_agent_policy_manage_event_setup: event.target.checked ? "1" : "0" })}
                    disabled={!canEditSettings}
                    className="mt-0.5 h-4 w-4 rounded border-slate-300 text-violet-600 focus:ring-violet-500"
                  />
                  <span><span className="font-medium">Event Setup Write</span> <span className="text-xs text-slate-500">create event + set detail/rules</span></span>
                </label>
                <label className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    checked={settings.admin_agent_policy_manage_event_status === "1"}
                    onChange={(event) => onSettingsChange({ ...settings, admin_agent_policy_manage_event_status: event.target.checked ? "1" : "0" })}
                    disabled={!canEditSettings}
                    className="mt-0.5 h-4 w-4 rounded border-slate-300 text-violet-600 focus:ring-violet-500"
                  />
                  <span><span className="font-medium">Event Status Write</span> <span className="text-xs text-slate-500">set pending/active/inactive/cancelled/archived</span></span>
                </label>
                <label className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    checked={settings.admin_agent_policy_manage_event_context === "1"}
                    onChange={(event) => onSettingsChange({ ...settings, admin_agent_policy_manage_event_context: event.target.checked ? "1" : "0" })}
                    disabled={!canEditSettings}
                    className="mt-0.5 h-4 w-4 rounded border-slate-300 text-violet-600 focus:ring-violet-500"
                  />
                  <span><span className="font-medium">Event Context Write</span> <span className="text-xs text-slate-500">update context knowledge</span></span>
                </label>
                <label className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    checked={settings.admin_agent_policy_read_registration !== "0"}
                    onChange={(event) => onSettingsChange({ ...settings, admin_agent_policy_read_registration: event.target.checked ? "1" : "0" })}
                    disabled={!canEditSettings}
                    className="mt-0.5 h-4 w-4 rounded border-slate-300 text-violet-600 focus:ring-violet-500"
                  />
                  <span><span className="font-medium">Registration Read</span> <span className="text-xs text-slate-500">find/list/count/timeline</span></span>
                </label>
                <label className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    checked={settings.admin_agent_policy_manage_registration !== "0"}
                    onChange={(event) => onSettingsChange({ ...settings, admin_agent_policy_manage_registration: event.target.checked ? "1" : "0" })}
                    disabled={!canEditSettings}
                    className="mt-0.5 h-4 w-4 rounded border-slate-300 text-violet-600 focus:ring-violet-500"
                  />
                  <span><span className="font-medium">Registration Write</span> <span className="text-xs text-slate-500">set status, resend ticket/email</span></span>
                </label>
                <label className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    checked={settings.admin_agent_policy_message_user !== "0"}
                    onChange={(event) => onSettingsChange({ ...settings, admin_agent_policy_message_user: event.target.checked ? "1" : "0" })}
                    disabled={!canEditSettings}
                    className="mt-0.5 h-4 w-4 rounded border-slate-300 text-violet-600 focus:ring-violet-500"
                  />
                  <span><span className="font-medium">Messaging Actions</span> <span className="text-xs text-slate-500">send message, retry bot</span></span>
                </label>
                <label className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    checked={settings.admin_agent_policy_search_all_events !== "0"}
                    onChange={(event) => onSettingsChange({ ...settings, admin_agent_policy_search_all_events: event.target.checked ? "1" : "0" })}
                    disabled={!canEditSettings}
                    className="mt-0.5 h-4 w-4 rounded border-slate-300 text-violet-600 focus:ring-violet-500"
                  />
                  <span><span className="font-medium">Search Whole System</span> <span className="text-xs text-slate-500">allow cross-event search/override</span></span>
                </label>
              </div>
            </details>

            <details className="rounded-xl border border-slate-200 bg-slate-50">
              <summary className="cursor-pointer list-none px-3 py-2.5 text-sm font-semibold text-slate-800">
                Notification Automation
              </summary>
              <div className="space-y-3 border-t border-slate-200 px-3 py-3 text-sm">
                <label className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    checked={settings.admin_agent_notification_enabled === "1"}
                    onChange={(event) => onSettingsChange({ ...settings, admin_agent_notification_enabled: event.target.checked ? "1" : "0" })}
                    disabled={!canEditSettings}
                    className="mt-0.5 h-4 w-4 rounded border-slate-300 text-violet-600 focus:ring-violet-500"
                  />
                  <span>
                    <span className="font-medium">Enable Auto Notifications</span>
                    <span className="text-xs text-slate-500">Send registration activity and public chat attention alerts to admin automatically.</span>
                  </span>
                </label>

                <div className="rounded-xl border border-slate-200 bg-white px-3 py-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <label className="flex items-start gap-2">
                      <input
                        type="checkbox"
                        checked={desktopNotifyEnabled}
                        onChange={(event) => onDesktopNotifyEnabledChange(event.target.checked)}
                        disabled={!canEditSettings || !desktopNotificationSupported || settings.admin_agent_notification_enabled !== "1"}
                        className="mt-0.5 h-4 w-4 rounded border-slate-300 text-violet-600 focus:ring-violet-500"
                      />
                      <span>
                        <span className="font-medium">Desktop Notifications (This Browser)</span>
                        <span className="text-xs text-slate-500">Show native browser notifications from registration changes and public chat attention signals.</span>
                      </span>
                    </label>
                    <ActionButton
                      onClick={() => void onRequestDesktopNotificationPermission()}
                      disabled={!canEditSettings || !desktopNotificationSupported || desktopNotifyPermission === "granted"}
                      tone="neutral"
                      className="px-2.5 py-1.5 text-xs"
                    >
                      Request Permission
                    </ActionButton>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <StatusBadge
                      tone={
                        desktopNotifyPermission === "granted"
                          ? "emerald"
                          : desktopNotifyPermission === "denied"
                          ? "rose"
                          : "neutral"
                      }
                    >
                      {desktopNotifyPermissionLabel}
                    </StatusBadge>
                    <span className="text-[11px] text-slate-500">Requires browser permission and an active web session.</span>
                  </div>
                </div>

                <label className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    checked={settings.admin_agent_notification_on_registration_created !== "0"}
                    onChange={(event) => onSettingsChange({ ...settings, admin_agent_notification_on_registration_created: event.target.checked ? "1" : "0" })}
                    disabled={!canEditSettings || settings.admin_agent_notification_enabled !== "1"}
                    className="mt-0.5 h-4 w-4 rounded border-slate-300 text-violet-600 focus:ring-violet-500"
                  />
                  <span>
                    <span className="font-medium">Notify On New Registration</span>
                    <span className="text-xs text-slate-500">Trigger when a new attendee is created.</span>
                  </span>
                </label>

                <label className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    checked={settings.admin_agent_notification_on_registration_status_changed !== "0"}
                    onChange={(event) => onSettingsChange({ ...settings, admin_agent_notification_on_registration_status_changed: event.target.checked ? "1" : "0" })}
                    disabled={!canEditSettings || settings.admin_agent_notification_enabled !== "1"}
                    className="mt-0.5 h-4 w-4 rounded border-slate-300 text-violet-600 focus:ring-violet-500"
                  />
                  <span>
                    <span className="font-medium">Notify On Status Changes</span>
                    <span className="text-xs text-slate-500">Trigger when status changes (registered/cancelled/checked-in).</span>
                  </span>
                </label>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-xs font-bold uppercase tracking-[0.16em] text-slate-500">Notification Scope</label>
                    <select
                      value={settings.admin_agent_notification_scope}
                      onChange={(event) => onSettingsChange({ ...settings, admin_agent_notification_scope: event.target.value === "event" ? "event" : "all" })}
                      disabled={!canEditSettings || settings.admin_agent_notification_enabled !== "1"}
                      className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-violet-500"
                    >
                      <option value="all">All Events</option>
                      <option value="event">One Event Only</option>
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-bold uppercase tracking-[0.16em] text-slate-500">Target Event ID</label>
                    <div className="flex gap-2">
                      <input
                        value={settings.admin_agent_notification_event_id}
                        onChange={(event) => onSettingsChange({ ...settings, admin_agent_notification_event_id: event.target.value })}
                        disabled={!canEditSettings || settings.admin_agent_notification_enabled !== "1" || settings.admin_agent_notification_scope !== "event"}
                        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 font-mono text-sm outline-none focus:ring-2 focus:ring-violet-500 disabled:bg-slate-100"
                        placeholder="evt_default"
                      />
                      <ActionButton
                        onClick={() => onSettingsChange({ ...settings, admin_agent_notification_event_id: selectedEventId })}
                        disabled={
                          !canEditSettings
                          || settings.admin_agent_notification_enabled !== "1"
                          || settings.admin_agent_notification_scope !== "event"
                          || !selectedEventId
                        }
                        tone="neutral"
                        className="shrink-0 px-2.5 text-[11px]"
                      >
                        Use Current
                      </ActionButton>
                    </div>
                  </div>
                </div>

                <p className="text-xs text-slate-500">
                  Delivery channel uses Admin Agent Telegram Bot + Allowed Chat IDs. If Telegram access is disabled or no chat IDs are configured, notifications will be skipped.
                </p>
              </div>
            </details>

            {!canEditSettings && (
              <p className="text-xs text-amber-600">Only owner/admin can change Agent settings. Operator can still run commands.</p>
            )}
          </>
        )}
      </div>

      <div className={`rounded-2xl border border-slate-200 bg-white shadow-sm ${agentExternalChannelCollapsed ? "p-3" : "space-y-4 p-4"}`}>
        <div className={`flex justify-between gap-3 ${agentExternalChannelCollapsed ? "items-center" : "items-start"}`}>
          <button
            type="button"
            onClick={onToggleAgentExternalChannelCollapsed}
            className="min-w-0 flex-1 text-left"
            aria-label={`${agentExternalChannelCollapsed ? "Expand" : "Collapse"} External Agent Channel`}
          >
            <h3 className="flex items-center gap-2 text-lg font-semibold">
              <Link2 className="h-5 w-5 text-violet-600" />
              External Agent Channel (Telegram)
            </h3>
            {!agentExternalChannelCollapsed && (
              <p className="text-sm text-slate-500">
                Dedicated Telegram webhook for Admin Agent commands, separate from event chat channels.
              </p>
            )}
          </button>
          <div className="flex items-center gap-2">
            {!agentExternalChannelCollapsed && (
              <HelpPopover label="Open note for Admin Agent Telegram setup">
                <p className="font-semibold text-slate-700">Telegram setup (step by step)</p>
                <ol className="mt-2 list-decimal space-y-1 pl-4">
                  <li>Create a bot with BotFather and copy the bot token.</li>
                  <li>Turn on Enable Telegram Access, then click Save Agent Setup.</li>
                  <li>Click Copy setWebhook and open the URL to register the webhook.</li>
                  <li>Open Telegram and send <code>/myid</code> to the bot to get the numeric <code>chat_id</code>.</li>
                  <li>Paste that <code>chat_id</code> into Allowed Chat IDs, one ID per line.</li>
                </ol>
                <p className="mt-2 text-[11px] text-slate-500">
                  Important: Allowed Chat IDs must use numeric user or group chat IDs, not a bot name or username such as <code>@fb_bot</code>.
                </p>
                <p className="mt-2 text-[11px] text-slate-500">
                  Webhook Secret Token is optional for extra security. If you use it, set the same value in both the app and the setWebhook request.
                </p>
              </HelpPopover>
            )}
            <CollapseIconButton
              collapsed={agentExternalChannelCollapsed}
              onClick={onToggleAgentExternalChannelCollapsed}
              label="External Agent Channel"
            />
          </div>
        </div>

        {!agentExternalChannelCollapsed && (
          <>
            <label className="flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
              <input
                type="checkbox"
                checked={settings.admin_agent_telegram_enabled === "1"}
                onChange={(event) => onSettingsChange({ ...settings, admin_agent_telegram_enabled: event.target.checked ? "1" : "0" })}
                disabled={!canEditSettings}
                className="mt-0.5 h-4 w-4 rounded border-slate-300 text-violet-600 focus:ring-violet-500"
              />
              <span>
                <span className="font-semibold text-slate-800">Enable Telegram Access</span>
                <span className="mt-0.5 block text-xs text-slate-500">When enabled, incoming Telegram updates can run Admin Agent commands.</span>
              </span>
            </label>

            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-bold uppercase tracking-[0.16em] text-slate-500">Telegram Bot Token</label>
                <input
                  type="password"
                  value={settings.admin_agent_telegram_bot_token}
                  onChange={(event) => onSettingsChange({ ...settings, admin_agent_telegram_bot_token: event.target.value })}
                  disabled={!canEditSettings}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-sm outline-none focus:ring-2 focus:ring-violet-500"
                  placeholder="123456:ABC..."
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-bold uppercase tracking-[0.16em] text-slate-500">Webhook Secret Token</label>
                <input
                  type="password"
                  value={settings.admin_agent_telegram_webhook_secret}
                  onChange={(event) => onSettingsChange({ ...settings, admin_agent_telegram_webhook_secret: event.target.value })}
                  disabled={!canEditSettings}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-sm outline-none focus:ring-2 focus:ring-violet-500"
                  placeholder="Set same value in Telegram setWebhook secret_token"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-bold uppercase tracking-[0.16em] text-slate-500">Allowed Chat IDs</label>
                <textarea
                  value={settings.admin_agent_telegram_allowed_chat_ids}
                  onChange={(event) => onSettingsChange({ ...settings, admin_agent_telegram_allowed_chat_ids: event.target.value })}
                  disabled={!canEditSettings}
                  className="h-20 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-sm outline-none focus:ring-2 focus:ring-violet-500"
                  placeholder="Numeric chat_id only, one per line (e.g. 123456789 or -100...). Leave blank = allow all."
                />
                <p className="mt-1 text-[11px] text-slate-500">
                  Use your own chat_id (not bot name/username). Send <code>/myid</code> to the bot to see it.
                </p>
              </div>
            </div>

            <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
              <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">Telegram Webhook URL</p>
              <code className="block break-all text-xs text-slate-700">{adminAgentTelegramWebhookUrl}</code>
              <div className="flex flex-wrap gap-2">
                <ActionButton
                  onClick={() => void onCopyToClipboard(adminAgentTelegramWebhookUrl)}
                  tone="neutral"
                  className="min-h-0 px-2.5 py-1.5 text-xs"
                >
                  <Copy className="h-3.5 w-3.5" />
                  Copy URL
                </ActionButton>
                <ActionButton
                  onClick={() => void onCopyToClipboard(adminAgentTelegramSetWebhookUrl)}
                  tone="neutral"
                  disabled={!adminAgentTelegramSetWebhookUrl}
                  className="min-h-0 px-2.5 py-1.5 text-xs"
                >
                  <Copy className="h-3.5 w-3.5" />
                  Copy setWebhook
                </ActionButton>
              </div>
              {adminAgentTelegramSetWebhookUrl && (
                <code className="block break-all text-[11px] text-slate-500">{adminAgentTelegramSetWebhookUrl}</code>
              )}
            </div>
          </>
        )}
      </div>

      {settingsMessage && (
        <p className={`text-xs ${settingsMessage.toLowerCase().includes("failed") || settingsMessage.toLowerCase().includes("error") ? "text-rose-600" : "text-emerald-600"}`}>
          {settingsMessage}
        </p>
      )}
    </motion.div>
  );
}

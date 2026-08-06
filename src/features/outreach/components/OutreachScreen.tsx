import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Copy, ExternalLink, Megaphone, Plus, RefreshCw, Search } from "lucide-react";
import { parseOutreachCsv } from "../../../../backend/outreachCsv";
import { translate, type AppLanguage } from "../../../lib/i18n";

type ApiFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
type CampaignStatus = "draft" | "active" | "paused" | "completed" | "archived";
type TargetStatus = "new" | "drafted" | "approved" | "contacted" | "waiting_reply" | "replied" | "press_kit_sent" | "follow_up" | "published" | "declined" | "no_response";
type Priority = "low" | "normal" | "high";
type DeliveryMode = "manual_first_contact" | "api_reply_eligible" | "manual_only" | "unavailable";

type Campaign = {
  id: string;
  event_id: string;
  name: string;
  description: string;
  objective: string;
  context: string;
  default_instruction: string;
  start_date: string | null;
  end_date: string | null;
  status: CampaignStatus;
  target_count: number;
  needs_action_count: number;
  follow_up_due_count: number;
};

type Target = {
  id: string;
  campaign_id: string;
  event_id: string;
  name: string;
  facebook_page_url: string;
  facebook_page_id: string | null;
  organization_type: string;
  contact_person: string | null;
  email: string | null;
  website: string | null;
  notes: string;
  priority: Priority;
  status: TargetStatus;
  delivery_mode: DeliveryMode;
  bound_sender_id: string | null;
  bound_page_id: string | null;
  last_contacted_at: string | null;
  last_replied_at: string | null;
  next_follow_up_at: string | null;
  outcome_note: string | null;
  assigned_user_id: string | null;
};

type Draft = {
  id: string;
  target_id: string;
  revision: number;
  body: string;
  kind: "initial" | "suggested_reply";
  source_message_id: number | null;
  approval_status: "draft" | "approved";
  approved_at: string | null;
  created_at: string;
};

type Asset = { id: string; name: string; type: string; description: string; url: string; tags: string; is_active: boolean };
type Delivery = { id: string; asset_id: string | null; draft_id: string | null; kind: "text" | "asset"; status: "pending" | "sent" | "failed"; error_message: string | null; sent_at: string | null };
type ConversationMessage = { id: number; type: "incoming" | "outgoing"; text: string; timestamp: string };
type Eligibility = { eligible: boolean; has_identity: boolean; last_replied_at: string | null; eligible_until: string | null; reason: string };
type Assignee = { id: string; display_name: string; username: string; role: string };
type TargetImportDraft = {
  name: string;
  facebook_page_url: string;
  facebook_page_id: string;
  organization_type: string;
  contact_person: string;
  email: string;
  website: string;
  notes: string;
  priority: Priority;
  next_follow_up_at: string;
};

type Props = { eventId: string; apiFetch: ApiFetch; canManage: boolean; language: AppLanguage };

const statusLabels: Record<TargetStatus, string> = {
  new: "New", drafted: "Drafted", approved: "Approved", contacted: "Contacted", waiting_reply: "Waiting for reply", replied: "Replied", press_kit_sent: "Press Kit sent", follow_up: "Follow-up", published: "Published", declined: "Declined", no_response: "No response",
};

const campaignStatusLabels: Record<CampaignStatus, string> = { draft: "Draft", active: "Active", paused: "Paused", completed: "Completed", archived: "Archived" };

const emptyCampaign = { name: "", description: "", objective: "", context: "", default_instruction: "", start_date: "", end_date: "", status: "draft" as CampaignStatus };
const emptyTarget = { name: "", facebook_page_url: "", facebook_page_id: "", organization_type: "media", contact_person: "", email: "", website: "", notes: "", priority: "normal" as Priority, next_follow_up_at: "" };
const emptyAsset = { name: "", type: "press_release", description: "", url: "", tags: "" };
const blankTargetImportDraft = (): TargetImportDraft => ({ name: "", facebook_page_url: "", facebook_page_id: "", organization_type: "media", contact_person: "", email: "", website: "", notes: "", priority: "normal", next_follow_up_at: "" });
const hasTargetImportData = (row: TargetImportDraft) => [row.name, row.facebook_page_url, row.facebook_page_id, row.contact_person, row.email, row.website, row.notes, row.next_follow_up_at].some((value) => value.trim());
const targetImportDraftFromRow = (row: Record<string, string>): TargetImportDraft => ({
  name: row.name || row.target || "",
  facebook_page_url: row.facebook_page_url || row.page_url || "",
  facebook_page_id: row.facebook_page_id || row.page_id || "",
  organization_type: row.organization_type || row.type || "media",
  contact_person: row.contact_person || "",
  email: row.email || "",
  website: row.website || "",
  notes: row.notes || "",
  priority: ["low", "normal", "high"].includes(row.priority) ? row.priority as Priority : "normal",
  next_follow_up_at: row.next_follow_up_at || row.follow_up_at || "",
});
const csvCell = (value: string) => {
  const text = String(value || "");
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};
const targetImportCsv = (rows: TargetImportDraft[]) => {
  const fields: Array<keyof TargetImportDraft> = ["name", "facebook_page_url", "facebook_page_id", "organization_type", "contact_person", "email", "website", "notes", "priority", "next_follow_up_at"];
  return [fields.join(","), ...rows.filter(hasTargetImportData).map((row) => fields.map((field) => csvCell(row[field])).join(","))].join("\n");
};

function formatDate(value: string | null | undefined, language: AppLanguage = "th") {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString(language === "th" ? "th-TH" : "en-US", { dateStyle: "medium", timeStyle: "short" });
}

function targetPayload(target: Target, overrides: Partial<Pick<Target, "status" | "delivery_mode" | "next_follow_up_at" | "outcome_note" | "assigned_user_id">> = {}) {
  return {
    event_id: target.event_id,
    name: target.name,
    facebook_page_url: target.facebook_page_url,
    facebook_page_id: target.facebook_page_id || "",
    organization_type: target.organization_type,
    contact_person: target.contact_person || "",
    email: target.email || "",
    website: target.website || "",
    notes: target.notes,
    priority: target.priority,
    status: overrides.status || target.status,
    delivery_mode: overrides.delivery_mode || target.delivery_mode,
    next_follow_up_at: overrides.next_follow_up_at === undefined ? target.next_follow_up_at || "" : overrides.next_follow_up_at,
    outcome_note: overrides.outcome_note === undefined ? target.outcome_note || "" : overrides.outcome_note,
    assigned_user_id: overrides.assigned_user_id === undefined ? target.assigned_user_id || "" : overrides.assigned_user_id,
  };
}

function badgeClass(status: string) {
  if (["replied", "published", "press_kit_sent"].includes(status)) return "bg-emerald-50 text-emerald-700";
  if (["approved", "contacted", "waiting_reply", "follow_up"].includes(status)) return "bg-blue-50 text-blue-700";
  if (["declined", "no_response"].includes(status)) return "bg-rose-50 text-rose-700";
  return "bg-slate-100 text-slate-600";
}

export function OutreachScreen({ eventId, apiFetch, canManage, language }: Props) {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [selectedCampaignId, setSelectedCampaignId] = useState("");
  const [targets, setTargets] = useState<Target[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [selectedTargetId, setSelectedTargetId] = useState("");
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [eligibility, setEligibility] = useState<Eligibility | null>(null);
  const [assignees, setAssignees] = useState<Assignee[]>([]);
  const [draftBody, setDraftBody] = useState("");
  const [campaignForm, setCampaignForm] = useState(emptyCampaign);
  const [targetForm, setTargetForm] = useState(emptyTarget);
  const [assetForm, setAssetForm] = useState(emptyAsset);
  const [showCampaignForm, setShowCampaignForm] = useState(false);
  const [showTargetForm, setShowTargetForm] = useState(false);
  const [showAssetForm, setShowAssetForm] = useState(false);
  const [showImportForm, setShowImportForm] = useState(false);
  const [importRows, setImportRows] = useState<TargetImportDraft[]>([blankTargetImportDraft()]);
  const [importPreview, setImportPreview] = useState<{ valid_count: number; invalid_count: number; invalid?: Array<{ row: number; errors: string[] }> } | null>(null);
  const [selectedAssetIds, setSelectedAssetIds] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | TargetStatus>("all");
  const [dueOnly, setDueOnly] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [targetMenuId, setTargetMenuId] = useState("");

  const t = (key: string, fallback: string) => translate(language, `outreach.${key}`, fallback);
  const targetStatusLabel = (status: TargetStatus) => t(`status.${status}`, statusLabels[status]);
  const campaignStatusLabel = (status: CampaignStatus) => t(`campaignStatus.${status}`, campaignStatusLabels[status]);

  const selectedCampaign = campaigns.find((campaign) => campaign.id === selectedCampaignId) || null;
  const selectedTarget = targets.find((target) => target.id === selectedTargetId) || null;
  const filteredTargets = useMemo(() => targets.filter((target) => {
    const matchesStatus = statusFilter === "all" || target.status === statusFilter;
    const matchesDue = !dueOnly || Boolean(target.next_follow_up_at && new Date(target.next_follow_up_at).getTime() <= Date.now() && !["published", "declined", "no_response"].includes(target.status));
    const haystack = `${target.name} ${target.organization_type} ${target.email || ""} ${target.notes}`.toLowerCase();
    return matchesStatus && matchesDue && (!query.trim() || haystack.includes(query.trim().toLowerCase()));
  }), [dueOnly, query, statusFilter, targets]);

  const loadCampaigns = async (preferredId = selectedCampaignId) => {
    if (!eventId) return;
    setLoading(true);
    try {
      const response = await apiFetch(`/api/outreach/campaigns?event_id=${encodeURIComponent(eventId)}`);
      const data = await response.json().catch(() => []);
      if (!response.ok) throw new Error(data?.error || "Could not load campaigns");
      const next = Array.isArray(data) ? data as Campaign[] : [];
      setCampaigns(next);
      const nextId = next.some((campaign) => campaign.id === preferredId) ? preferredId : next[0]?.id || "";
      setSelectedCampaignId(nextId);
      if (!nextId) {
        setTargets([]); setAssets([]); setSelectedTargetId(""); setMessages([]); setDeliveries([]); setEligibility(null);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not load campaigns");
    } finally {
      setLoading(false);
    }
  };

  const loadCampaignDetail = async (campaignId = selectedCampaignId, preferredTargetId = selectedTargetId) => {
    if (!eventId || !campaignId) return;
    try {
      const response = await apiFetch(`/api/outreach/campaigns/${encodeURIComponent(campaignId)}?event_id=${encodeURIComponent(eventId)}`);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error || "Could not load campaign");
      const nextTargets = Array.isArray(data.targets) ? data.targets as Target[] : [];
      setTargets(nextTargets);
      setAssets(Array.isArray(data.assets) ? data.assets as Asset[] : []);
      const nextTargetId = nextTargets.some((target) => target.id === preferredTargetId) ? preferredTargetId : nextTargets[0]?.id || "";
      setSelectedTargetId(nextTargetId);
      if (!nextTargetId) { setDrafts([]); setDraftBody(""); setMessages([]); setDeliveries([]); setEligibility(null); }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not load campaign");
    }
  };

  const loadTargetDetail = async (targetId = selectedTargetId) => {
    if (!eventId || !targetId) return;
    try {
      const response = await apiFetch(`/api/outreach/targets/${encodeURIComponent(targetId)}?event_id=${encodeURIComponent(eventId)}`);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error || "Could not load target");
      const nextDrafts = Array.isArray(data.drafts) ? data.drafts as Draft[] : [];
      setDrafts(nextDrafts);
      setDraftBody(nextDrafts[0]?.body || "");
      setDeliveries(Array.isArray(data.deliveries) ? data.deliveries as Delivery[] : []);
      setMessages(Array.isArray(data.messages) ? data.messages as ConversationMessage[] : []);
      setEligibility(data.eligibility || null);
      if (data.target) setTargets((current) => current.map((target) => target.id === data.target.id ? data.target : target));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not load target");
    }
  };

  useEffect(() => { setSelectedCampaignId(""); setSelectedTargetId(""); void loadCampaigns(""); }, [eventId]);
  useEffect(() => { void loadCampaignDetail(selectedCampaignId); }, [selectedCampaignId]);
  useEffect(() => { void loadTargetDetail(selectedTargetId); }, [selectedTargetId]);
  useEffect(() => {
    if (!eventId) return;
    void (async () => {
      const response = await apiFetch(`/api/outreach/assignees?event_id=${encodeURIComponent(eventId)}`);
      const data = await response.json().catch(() => []);
      if (response.ok && Array.isArray(data)) setAssignees(data as Assignee[]);
    })();
  }, [apiFetch, eventId]);

  const request = async (path: string, init: RequestInit, successMessage: string) => {
    setBusy(true); setMessage("");
    try {
      const response = await apiFetch(path, init);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error || "Request failed");
      setMessage(successMessage);
      return data;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Request failed");
      return null;
    } finally { setBusy(false); }
  };

  const createCampaign = async (event: FormEvent) => {
    event.preventDefault();
    if (!canManage) return;
    const data = await request("/api/outreach/campaigns", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ event_id: eventId, ...campaignForm }) }, t("campaignCreated", "Campaign created"));
    if (data?.id) { setCampaignForm(emptyCampaign); setShowCampaignForm(false); await loadCampaigns(data.id); }
  };

  const createTarget = async (event: FormEvent) => {
    event.preventDefault();
    if (!canManage || !selectedCampaignId) return;
    const data = await request("/api/outreach/targets", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ event_id: eventId, campaign_id: selectedCampaignId, ...targetForm }) }, t("targetAddedReview", "Target added — review duplicate warning if shown"));
    if (data?.id) { setMessage(data.cross_campaign_warning ? t("targetAddedCrossCampaign", "Target added — matching identity exists in another campaign in this event.") : data.duplicate_warning ? t("targetAddedDuplicate", "Target added — matching identity already exists in this campaign.") : t("targetAdded", "Target added")); setTargetForm(emptyTarget); setShowTargetForm(false); await loadCampaignDetail(selectedCampaignId, data.id); }
  };

  const createAsset = async (event: FormEvent) => {
    event.preventDefault();
    if (!canManage || !selectedCampaignId) return;
    const data = await request("/api/outreach/assets", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ event_id: eventId, campaign_id: selectedCampaignId, ...assetForm }) }, t("assetAdded", "Press Kit asset added"));
    if (data?.id) { setAssetForm(emptyAsset); setShowAssetForm(false); await loadCampaignDetail(selectedCampaignId); }
  };

  const saveDraft = async (mode: "generate" | "manual" | "suggested_reply") => {
    if (!canManage || !selectedTarget) return;
    const data = await request(`/api/outreach/targets/${encodeURIComponent(selectedTarget.id)}/drafts`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ event_id: eventId, mode, kind: drafts[0]?.kind || "initial", body: mode === "manual" ? draftBody : undefined }) }, mode === "generate" ? t("aiDraftGenerated", "AI draft generated — review before approval") : mode === "suggested_reply" ? t("suggestedReplyGenerated", "Suggested reply generated — review before approval") : t("draftSaved", "Draft saved"));
    if (data?.id) { setDrafts((current) => [data as Draft, ...current]); setDraftBody(data.body || ""); await loadCampaignDetail(selectedCampaignId, selectedTarget.id); }
  };

  const approveDraft = async () => {
    const latest = drafts[0];
    if (!canManage || !latest) return;
    const data = await request(`/api/outreach/drafts/${encodeURIComponent(latest.id)}/approve`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ event_id: eventId }) }, t("draftApproved", "Draft approved — send manually after review"));
    if (data?.id) { setDrafts((current) => current.map((draft) => draft.id === data.id ? data as Draft : draft)); await loadCampaignDetail(selectedCampaignId, selectedTargetId); }
  };

  const sendApprovedReply = async () => {
    const latest = drafts[0];
    if (!canManage || !latest || latest.kind !== "suggested_reply" || latest.approval_status !== "approved") return;
    const data = await request(`/api/outreach/drafts/${encodeURIComponent(latest.id)}/send`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ event_id: eventId }) }, t("approvedReplySent", "Approved reply sent"));
    if (data?.delivery) { setDeliveries((current) => [data.delivery as Delivery, ...current.filter((delivery) => delivery.id !== data.delivery.id)]); await loadCampaignDetail(selectedCampaignId, selectedTargetId); await loadTargetDetail(selectedTargetId); }
  };

  const sendPressKit = async () => {
    if (!canManage || !selectedTarget || selectedAssetIds.length === 0) return;
    const data = await request(`/api/outreach/targets/${encodeURIComponent(selectedTarget.id)}/press-kit/send`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ event_id: eventId, asset_ids: selectedAssetIds, approved_draft_id: drafts[0]?.kind === "suggested_reply" && drafts[0].approval_status === "approved" ? drafts[0].id : undefined, confirm: true }) }, t("pressKitDeliveryRecorded", "Press Kit delivery recorded"));
    if (data) { setSelectedAssetIds([]); await loadCampaignDetail(selectedCampaignId, selectedTarget.id); await loadTargetDetail(selectedTarget.id); }
  };

  const bindIdentity = async () => {
    if (!canManage || !selectedTarget) return;
    const pageId = window.prompt(t("facebookPageIdPrompt", "Facebook Page ID"), selectedTarget.bound_page_id || selectedTarget.facebook_page_id || "")?.trim();
    const senderId = window.prompt(t("messengerSenderIdPrompt", "Messenger sender ID"), selectedTarget.bound_sender_id || "")?.trim();
    if (!pageId || !senderId) return;
    const data = await request(`/api/outreach/targets/${encodeURIComponent(selectedTarget.id)}/identity`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ event_id: eventId, page_id: pageId, sender_id: senderId }) }, t("identityBound", "Facebook identity bound"));
    if (data?.id) { setTargets((current) => current.map((target) => target.id === data.id ? data as Target : target)); await loadTargetDetail(selectedTarget.id); }
  };

  const setFollowUp = async () => {
    if (!canManage || !selectedTarget) return;
    const value = window.prompt(t("followUpDatePrompt", "Follow-up date/time (YYYY-MM-DDTHH:mm)"), selectedTarget.next_follow_up_at ? selectedTarget.next_follow_up_at.slice(0, 16) : "");
    if (value === null) return;
    const parsed = value.trim() ? new Date(value) : null;
    if (value.trim() && (!parsed || Number.isNaN(parsed.getTime()))) { setMessage(t("validFollowUp", "Enter a valid follow-up date/time")); return; }
    await updateTarget({ next_follow_up_at: parsed ? parsed.toISOString() : null, status: parsed ? "follow_up" : selectedTarget.status });
  };

  const setOutcome = async (status: "published" | "declined" | "no_response") => {
    if (!canManage || !selectedTarget) return;
    const note = window.prompt(`${t("outcomeNote", "Outcome note for")} ${status}`, selectedTarget.outcome_note || "");
    if (note === null) return;
    await updateTarget({ status, outcome_note: note.trim(), next_follow_up_at: null });
  };

  const updateTarget = async (overrides: Partial<Pick<Target, "status" | "delivery_mode" | "next_follow_up_at" | "outcome_note" | "assigned_user_id">>) => {
    if (!canManage || !selectedTarget) return;
    const data = await request(`/api/outreach/targets/${encodeURIComponent(selectedTarget.id)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(targetPayload(selectedTarget, overrides)) }, t("targetUpdated", "Target updated"));
    if (data?.id) { setTargets((current) => current.map((target) => target.id === data.id ? data as Target : target)); }
  };

  const updateImportRow = (index: number, field: keyof TargetImportDraft, value: string) => {
    setImportRows((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, [field]: field === "priority" ? value as Priority : value } : row));
    setImportPreview(null);
  };

  const loadImportCsv = async (file?: File) => {
    if (!file) return;
    const rows = parseOutreachCsv(await file.text()).map(targetImportDraftFromRow);
    if (!rows.length) {
      setMessage(t("csvNoRows", "CSV has no rows to load"));
      return;
    }
    setImportRows(rows);
    setImportPreview(null);
    setMessage(`${rows.length} ${t("rowsLoaded", "rows loaded — review, then click Preview & import")}`);
  };

  const importTargets = async () => {
    const rows = importRows.filter(hasTargetImportData);
    if (!canManage || !selectedCampaignId || !rows.length) return;
    const preview = await request("/api/outreach/targets/import/preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ event_id: eventId, campaign_id: selectedCampaignId, rows }) }, t("importPreviewReady", "Import preview ready"));
    if (preview) setImportPreview(preview);
    if (!preview || preview.invalid_count > 0) return;
    const data = await request("/api/outreach/targets/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ event_id: eventId, campaign_id: selectedCampaignId, rows }) }, t("targetsImported", "Targets imported"));
    if (data) { setImportRows([blankTargetImportDraft()]); setImportPreview(null); setShowImportForm(false); await loadCampaignDetail(selectedCampaignId); await loadCampaigns(selectedCampaignId); }
  };

  const exportImportCsv = () => {
    const blob = new Blob([targetImportCsv(importRows)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "outreach-targets-draft.csv";
    link.click();
    URL.revokeObjectURL(url);
  };

  const exportTargets = () => {
    window.open(`/api/outreach/targets/export?event_id=${encodeURIComponent(eventId)}&campaign_id=${encodeURIComponent(selectedCampaignId)}`, "_blank", "noopener,noreferrer");
  };

  const copyDraft = async () => {
    if (!draftBody.trim()) return;
    await navigator.clipboard?.writeText(draftBody);
    setMessage(t("draftCopied", "Draft copied to clipboard"));
  };

  const openTargetUrl = (target: Target) => {
    const url = target.facebook_page_url || target.website || `https://www.google.com/search?q=${encodeURIComponent(`${target.name} Facebook official website`)}`;
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const generateTargetDraft = async (target: Target) => {
    const data = await request(`/api/outreach/targets/${encodeURIComponent(target.id)}/drafts`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ event_id: eventId, mode: "generate", kind: "initial" }) }, t("aiDraftGenerated", "AI draft generated — review before approval"));
    if (data) await loadCampaignDetail(selectedCampaignId, target.id);
  };

  const approveTargetDraft = async (target: Target) => {
    const detail = await apiFetch(`/api/outreach/targets/${encodeURIComponent(target.id)}?event_id=${encodeURIComponent(eventId)}`).then((response) => response.json());
    const draft = detail.drafts?.[0] as Draft | undefined;
    if (!draft) return setMessage(t("noRevision", "No revision yet"));
    const data = await request(`/api/outreach/drafts/${encodeURIComponent(draft.id)}/approve`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ event_id: eventId }) }, t("draftApproved", "Draft approved — send manually after review"));
    if (data) await loadCampaignDetail(selectedCampaignId, target.id);
  };

  const copyTargetDraft = async (target: Target) => {
    const detail = await apiFetch(`/api/outreach/targets/${encodeURIComponent(target.id)}?event_id=${encodeURIComponent(eventId)}`).then((response) => response.json());
    const draft = detail.drafts?.[0] as Draft | undefined;
    if (!draft) return setMessage(t("noRevision", "No revision yet"));
    await navigator.clipboard?.writeText(draft.body);
    setMessage(t("draftCopied", "Draft copied to clipboard"));
  };

  const runBatch = async (action: "generate" | "approve" | "copy" | "status", status?: TargetStatus) => {
    if (!canManage || !selectedCampaignId) return;
    const chosen = filteredTargets;
    if (!chosen.length) return;
    setBusy(true); setMessage("");
    try {
      if (action === "generate") {
        await Promise.all(chosen.filter((target) => !["published", "declined", "no_response"].includes(target.status)).map(async (target) => {
          const response = await apiFetch(`/api/outreach/targets/${encodeURIComponent(target.id)}/drafts`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ event_id: eventId, mode: "generate", kind: "initial" }) });
          if (!response.ok) throw new Error((await response.json().catch(() => ({})))?.error || target.name);
        }));
        setMessage(`${chosen.length} ${t("batchDrafted", "drafts generated for review")}`);
      } else if (action === "approve" || action === "copy") {
        const results = await Promise.all(chosen.map(async (target) => {
          const response = await apiFetch(`/api/outreach/targets/${encodeURIComponent(target.id)}?event_id=${encodeURIComponent(eventId)}`);
          const data = await response.json().catch(() => ({}));
          const draft = data.drafts?.[0] as Draft | undefined;
          if (!response.ok || !draft) return null;
          if (action === "approve" && draft.approval_status !== "approved") {
            const approval = await apiFetch(`/api/outreach/drafts/${encodeURIComponent(draft.id)}/approve`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ event_id: eventId }) });
            if (!approval.ok) throw new Error((await approval.json().catch(() => ({})))?.error || target.name);
          }
          return `${target.name}\n${draft.body}`;
        }));
        const completed = results.filter(Boolean) as string[];
        if (action === "copy") await navigator.clipboard?.writeText(completed.join("\n\n──────────\n\n"));
        setMessage(action === "copy" ? `${completed.length} ${t("batchCopied", "drafts copied")}` : `${completed.length} ${t("batchApproved", "drafts approved")}`);
      } else if (status) {
        const order: TargetStatus[] = ["new", "drafted", "approved", "contacted", "waiting_reply", "replied", "press_kit_sent", "follow_up", "published"];
        const needsReason = chosen.some((target) => order.indexOf(status) >= 0 && order.indexOf(target.status) > order.indexOf(status));
        const statusReason = needsReason ? window.prompt(t("statusReasonPrompt", "Reason for moving status backward")) : "";
        if (needsReason && !statusReason?.trim()) return setMessage(t("statusReasonRequired", "A reason is required when moving status backward"));
        await Promise.all(chosen.map(async (target) => {
          const response = await apiFetch(`/api/outreach/targets/${encodeURIComponent(target.id)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...targetPayload(target, { status }), status_reason: statusReason || undefined }) });
          if (!response.ok) throw new Error((await response.json().catch(() => ({})))?.error || target.name);
        }));
        setMessage(`${chosen.length} ${t("batchStatusUpdated", "statuses updated")}`);
      }
      await loadCampaignDetail(selectedCampaignId, selectedTargetId);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Batch action failed"); }
    finally { setBusy(false); }
  };

  const resolveLinks = async () => {
    if (!canManage || !selectedCampaignId) return;
    const data = await request(`/api/outreach/campaigns/${encodeURIComponent(selectedCampaignId)}/resolve-links`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ event_id: eventId }) }, t("linksResolved", "URL scan complete"));
    if (data) await loadCampaignDetail(selectedCampaignId, selectedTargetId);
  };

  const counts = {
    total: targets.length,
    new: targets.filter((target) => ["new", "drafted", "approved"].includes(target.status)).length,
    waiting: targets.filter((target) => target.status === "waiting_reply").length,
    replied: targets.filter((target) => target.status === "replied").length,
    pressKit: targets.filter((target) => target.status === "press_kit_sent").length,
    published: targets.filter((target) => target.status === "published").length,
    due: targets.filter((target) => target.next_follow_up_at && new Date(target.next_follow_up_at).getTime() <= Date.now() && !["published", "declined", "no_response"].includes(target.status)).length,
  };
  const draftDirty = Boolean(drafts[0] && draftBody.trim() !== drafts[0].body.trim());

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-lg font-bold text-slate-900"><Megaphone className="h-4 w-4 text-blue-600" />{t("title", "Outreach")}</h2>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => void loadCampaigns()} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700"><RefreshCw className="h-3.5 w-3.5" />{t("refresh", "Refresh")}</button>
          {canManage && selectedCampaign && <><button type="button" onClick={() => setShowImportForm((value) => !value)} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700">{t("importCsv", "Import CSV")}</button><button type="button" onClick={exportTargets} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700">{t("exportCsv", "Export CSV")}</button></>}
          {canManage && <button type="button" onClick={() => setShowCampaignForm((value) => !value)} className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-3 py-2 text-xs font-bold text-white"><Plus className="h-3.5 w-3.5" />{t("newCampaign", "New campaign")}</button>}
        </div>
      </div>

      {message && <div className="rounded-lg border border-blue-100 bg-blue-50 px-3 py-1.5 text-xs text-blue-800">{message}</div>}

      {showCampaignForm && canManage && <form onSubmit={createCampaign} className="rounded-2xl border border-blue-100 bg-blue-50/50 p-4">
        <div className="grid gap-3 md:grid-cols-2">
          <label className="text-xs font-bold text-slate-700">{t("campaignName", "Campaign name")}<input required value={campaignForm.name} onChange={(event) => setCampaignForm({ ...campaignForm, name: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-normal" placeholder="Manohra — Press Outreach 2026" /></label>
          <label className="text-xs font-bold text-slate-700">{t("objective", "Objective")}<input value={campaignForm.objective} onChange={(event) => setCampaignForm({ ...campaignForm, objective: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-normal" placeholder="Invite arts and media coverage" /></label>
          <label className="text-xs font-bold text-slate-700 md:col-span-2">{t("descriptionField", "Description")}<textarea rows={2} value={campaignForm.description} onChange={(event) => setCampaignForm({ ...campaignForm, description: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-normal" /></label>
          <label className="text-xs font-bold text-slate-700 md:col-span-2">{t("campaignContext", "Campaign context")}<textarea rows={5} value={campaignForm.context} onChange={(event) => setCampaignForm({ ...campaignForm, context: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-normal" placeholder="Facts the outreach assistant may use: story, creator, venue, dates, links…" /></label>
          <label className="text-xs font-bold text-slate-700 md:col-span-2">{t("defaultInstruction", "Default outreach instruction")}<textarea rows={2} value={campaignForm.default_instruction} onChange={(event) => setCampaignForm({ ...campaignForm, default_instruction: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-normal" placeholder="Keep it warm, specific, and ask whether they would like the press kit." /></label>
        </div>
        <div className="mt-3 flex justify-end gap-2"><button type="button" onClick={() => setShowCampaignForm(false)} className="rounded-lg px-3 py-2 text-xs font-bold text-slate-600">{t("cancel", "Cancel")}</button><button disabled={busy} className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-bold text-white">{t("createCampaign", "Create campaign")}</button></div>
      </form>}

      {showImportForm && canManage && selectedCampaign && <div className="rounded-2xl border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-sm font-bold text-slate-900">{t("importTargets", "Import targets")}</p><p className="mt-1 text-xs text-slate-500">{t("importTargetsHint", "Fill the table or load a CSV to continue editing. Duplicate identities will be shown in the preview.")}</p></div><div className="flex gap-2"><button type="button" onClick={exportImportCsv} className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-bold text-slate-700">{t("exportDraftCsv", "Export draft CSV")}</button><label className="cursor-pointer rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-bold text-slate-700">{t("loadCsv", "Load CSV")}<input type="file" accept=".csv,text/csv" onChange={(event) => { void loadImportCsv(event.target.files?.[0]); event.currentTarget.value = ""; }} className="hidden" /></label></div></div>
        <p className="mt-3 text-[11px] text-slate-500"><code>name,facebook_page_url,facebook_page_id,organization_type,contact_person,email,website,notes,priority,next_follow_up_at</code></p>
        <div className="mt-2 max-h-72 overflow-auto rounded-xl border border-slate-200 bg-slate-50"><div className="min-w-[1500px]"><div className="grid grid-cols-[1.2fr_1.6fr_1.1fr_1fr_1.1fr_1.2fr_1.2fr_1.5fr_100px_160px_28px] gap-1 border-b border-slate-300 bg-slate-100 p-2 text-center text-[10px] font-bold uppercase text-slate-600"><span>{t("nameRequired", "Name *")}</span><span>{t("facebookUrl", "Facebook URL")}</span><span>{t("pageId", "Page ID")}</span><span>{t("type", "Type")}</span><span>{t("contact", "Contact")}</span><span>{t("email", "Email")}</span><span>{t("website", "Website")}</span><span>{t("notes", "Notes")}</span><span>{t("priority", "Priority")}</span><span>{t("followUp", "Follow-up")}</span><span /></div>{importRows.map((row, index) => <div key={index} className="grid grid-cols-[1.2fr_1.6fr_1.1fr_1fr_1.1fr_1.2fr_1.2fr_1.5fr_100px_160px_28px] gap-1 border-t border-slate-200 p-2"><input aria-label={`Target name ${index + 1}`} value={row.name} onChange={(event) => updateImportRow(index, "name", event.target.value)} placeholder={t("targetName", "Target name")} className="w-full rounded border border-slate-300 bg-white px-1.5 py-1 text-xs" /><input aria-label={`Facebook URL ${index + 1}`} value={row.facebook_page_url} onChange={(event) => updateImportRow(index, "facebook_page_url", event.target.value)} placeholder="https://facebook.com/..." className="w-full rounded border border-slate-300 bg-white px-1.5 py-1 text-xs" /><input aria-label={`Facebook Page ID ${index + 1}`} value={row.facebook_page_id} onChange={(event) => updateImportRow(index, "facebook_page_id", event.target.value)} className="w-full rounded border border-slate-300 bg-white px-1.5 py-1 text-xs" /><input aria-label={`Organization type ${index + 1}`} value={row.organization_type} onChange={(event) => updateImportRow(index, "organization_type", event.target.value)} className="w-full rounded border border-slate-300 bg-white px-1.5 py-1 text-xs" /><input aria-label={`Contact person ${index + 1}`} value={row.contact_person} onChange={(event) => updateImportRow(index, "contact_person", event.target.value)} className="w-full rounded border border-slate-300 bg-white px-1.5 py-1 text-xs" /><input aria-label={`Email ${index + 1}`} value={row.email} onChange={(event) => updateImportRow(index, "email", event.target.value)} className="w-full rounded border border-slate-300 bg-white px-1.5 py-1 text-xs" /><input aria-label={`Website ${index + 1}`} value={row.website} onChange={(event) => updateImportRow(index, "website", event.target.value)} className="w-full rounded border border-slate-300 bg-white px-1.5 py-1 text-xs" /><input aria-label={`Notes ${index + 1}`} value={row.notes} onChange={(event) => updateImportRow(index, "notes", event.target.value)} className="w-full rounded border border-slate-300 bg-white px-1.5 py-1 text-xs" /><select aria-label={`Priority ${index + 1}`} value={row.priority} onChange={(event) => updateImportRow(index, "priority", event.target.value)} className="w-full rounded border border-slate-300 bg-white px-1.5 py-1 text-xs"><option value="high">{t("highPriority", "High")}</option><option value="normal">{t("normalPriority", "Normal")}</option><option value="low">{t("lowPriority", "Low")}</option></select><input aria-label={`Follow-up ${index + 1}`} type="datetime-local" value={row.next_follow_up_at} onChange={(event) => updateImportRow(index, "next_follow_up_at", event.target.value)} className="w-full rounded border border-slate-300 bg-white px-1.5 py-1 text-xs" /><button type="button" aria-label={`Remove row ${index + 1}`} onClick={() => setImportRows((current) => current.length > 1 ? current.filter((_, rowIndex) => rowIndex !== index) : [blankTargetImportDraft()])} className="text-lg leading-none text-rose-600">×</button></div>)}</div></div>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2"><button type="button" onClick={() => { setImportRows((current) => [...current, blankTargetImportDraft()]); setImportPreview(null); }} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-bold text-slate-700">+ {t("addRow", "Add row")}</button><span className="text-[11px] text-slate-500">{importRows.filter(hasTargetImportData).length} {t("rowsReady", "rows ready")}</span></div>
        {importPreview && <div className={`mt-2 rounded-lg px-3 py-2 text-xs ${importPreview.invalid_count > 0 ? "bg-rose-50 text-rose-800" : "bg-emerald-50 text-emerald-800"}`}>{t("preview", "Preview")}: {importPreview.valid_count} {t("valid", "valid")} · {importPreview.invalid_count} {t("invalid", "invalid")}{importPreview.invalid?.length ? ` · rows ${importPreview.invalid.map((row) => row.row).join(", ")}` : ""}</div>}
        <div className="mt-3 flex justify-end gap-2"><button type="button" onClick={() => setShowImportForm(false)} className="rounded-lg px-3 py-2 text-xs font-bold text-slate-500">{t("cancel", "Cancel")}</button><button type="button" disabled={busy || !importRows.some(hasTargetImportData)} onClick={() => void importTargets()} className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-50">{t("previewImport", "Preview & import")}</button></div>
      </div>}

      <div className="grid min-w-0 gap-3 xl:h-[calc(100dvh-155px)] xl:grid-cols-[220px_minmax(250px,.75fr)_minmax(420px,1.25fr)]">
        <section className="min-w-0 rounded-2xl border border-slate-200 bg-white p-3 xl:overflow-y-auto">
          <div className="mb-2 flex items-center justify-between"><h3 className="text-sm font-bold text-slate-900">{t("campaigns", "Campaigns")}</h3>{loading && <RefreshCw className="h-3.5 w-3.5 animate-spin text-slate-400" />}</div>
          <div className="space-y-1.5">{campaigns.map((campaign) => <button type="button" key={campaign.id} onClick={() => setSelectedCampaignId(campaign.id)} className={`w-full rounded-xl px-3 py-2.5 text-left ${selectedCampaignId === campaign.id ? "bg-blue-50 text-blue-800" : "hover:bg-slate-50"}`}><div className="flex items-start justify-between gap-2"><span className="line-clamp-2 text-sm font-bold">{campaign.name}</span><span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${campaign.status === "active" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{campaignStatusLabel(campaign.status)}</span></div><p className="mt-1 text-[11px] text-slate-500">{campaign.target_count} {t("targets", "targets")} · {campaign.needs_action_count} {t("replied", "replied")}</p></button>)}{campaigns.length === 0 && <p className="px-2 py-5 text-sm text-slate-500">{t("noCampaigns", "No campaigns yet.")}</p>}</div>
        </section>

        <section className="flex min-h-0 min-w-0 flex-col rounded-2xl border border-slate-200 bg-white p-3">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2"><div><h3 className="text-sm font-bold text-slate-900">{t("targetList", "Targets")}</h3><p className="text-[11px] text-slate-500">{selectedCampaign?.name || t("chooseCampaign", "Choose a campaign")}</p></div>{canManage && selectedCampaign && <div className="flex gap-1"><button type="button" disabled={busy} onClick={() => void resolveLinks()} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1.5 text-[11px] font-bold text-slate-700" title={t("scanUrls", "Find Facebook pages and websites") }><Search className="h-3.5 w-3.5" />{t("scanUrls", "Find URLs")}</button><button type="button" onClick={() => setShowTargetForm((value) => !value)} className="rounded-lg bg-blue-600 p-1.5 text-white" aria-label={t("addTarget", "Add target")}><Plus className="h-4 w-4" /></button></div>}</div>
          <div className="space-y-2"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("searchTargets", "Search targets")} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs" /><div className="flex gap-2"><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as "all" | TargetStatus)} className="min-w-0 flex-1 rounded-lg border border-slate-200 px-3 py-2 text-xs"><option value="all">{t("allStatuses", "All statuses")}</option>{Object.entries(statusLabels).map(([value]) => <option key={value} value={value}>{targetStatusLabel(value as TargetStatus)}</option>)}</select><button type="button" onClick={() => setStatusFilter((current) => current === "replied" ? "all" : "replied")} className={`rounded-lg border px-2.5 py-2 text-[11px] font-bold ${statusFilter === "replied" ? "border-violet-300 bg-violet-50 text-violet-700" : "border-slate-200 text-slate-600"}`}>{t("needsAction", "Needs action")} {counts.replied}</button><button type="button" onClick={() => setDueOnly((current) => !current)} className={`rounded-lg border px-2.5 py-2 text-[11px] font-bold ${dueOnly ? "border-amber-300 bg-amber-50 text-amber-800" : "border-slate-200 text-slate-600"}`}>{t("due", "Due")} {counts.due}</button></div></div>
          {canManage && selectedCampaign && <div className="mt-2 flex flex-wrap gap-1.5 rounded-lg bg-slate-50 p-2"><button type="button" disabled={busy} onClick={() => void runBatch("generate")} className="rounded-md bg-blue-600 px-2 py-1.5 text-[11px] font-bold text-white">{t("batchGenerate", "Draft all")}</button><button type="button" disabled={busy} onClick={() => void runBatch("approve")} className="rounded-md bg-emerald-600 px-2 py-1.5 text-[11px] font-bold text-white">{t("batchApprove", "Approve all")}</button><button type="button" disabled={busy} onClick={() => void runBatch("copy")} className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2 py-1.5 text-[11px] font-bold text-slate-700"><Copy className="h-3 w-3" />{t("copyAll", "Copy all")}</button><select disabled={busy} defaultValue="" onChange={(event) => { const value = event.target.value as TargetStatus; if (value) void runBatch("status", value); event.currentTarget.value = ""; }} className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-[11px] font-bold text-slate-700"><option value="">{t("setAllStatus", "Set status")}</option>{Object.entries(statusLabels).map(([value]) => <option key={value} value={value}>{targetStatusLabel(value as TargetStatus)}</option>)}</select></div>}
          {showTargetForm && canManage && selectedCampaign && <form onSubmit={createTarget} className="mt-3 space-y-2 rounded-xl bg-slate-50 p-3"><input required value={targetForm.name} onChange={(event) => setTargetForm({ ...targetForm, name: event.target.value })} placeholder={t("targetName", "Target / organization name")} className="w-full rounded-lg border border-slate-200 px-2.5 py-2 text-xs" /><div className="grid grid-cols-2 gap-2"><input value={targetForm.organization_type} onChange={(event) => setTargetForm({ ...targetForm, organization_type: event.target.value })} placeholder={t("organizationType", "Type e.g. arts media")} className="rounded-lg border border-slate-200 px-2.5 py-2 text-xs" /><select value={targetForm.priority} onChange={(event) => setTargetForm({ ...targetForm, priority: event.target.value as Priority })} className="rounded-lg border border-slate-200 px-2.5 py-2 text-xs"><option value="high">{t("highPriority", "High priority")}</option><option value="normal">{t("normalPriority", "Normal priority")}</option><option value="low">{t("lowPriority", "Low priority")}</option></select></div><input value={targetForm.facebook_page_url} onChange={(event) => setTargetForm({ ...targetForm, facebook_page_url: event.target.value })} placeholder={t("facebookPageUrl", "Facebook Page URL")} className="w-full rounded-lg border border-slate-200 px-2.5 py-2 text-xs" /><input value={targetForm.email} onChange={(event) => setTargetForm({ ...targetForm, email: event.target.value })} placeholder={t("emailOptional", "Email (optional)")} className="w-full rounded-lg border border-slate-200 px-2.5 py-2 text-xs" /><textarea rows={2} value={targetForm.notes} onChange={(event) => setTargetForm({ ...targetForm, notes: event.target.value })} placeholder={t("internalNotes", "Internal notes")} className="w-full rounded-lg border border-slate-200 px-2.5 py-2 text-xs" /><div className="flex justify-end gap-2"><button type="button" onClick={() => setShowTargetForm(false)} className="px-2 py-1.5 text-xs font-bold text-slate-500">{t("cancel", "Cancel")}</button><button disabled={busy} className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-bold text-white">{t("addTargetButton", "Add target")}</button></div></form>}
          <div className="mt-3 min-h-0 flex-1 space-y-1.5 overflow-y-auto pr-1">{filteredTargets.map((target) => <div key={target.id} onContextMenu={(event) => { event.preventDefault(); setSelectedTargetId(target.id); setTargetMenuId(target.id); }} className={`relative w-full rounded-xl border px-3 py-2.5 text-left ${selectedTargetId === target.id ? "border-blue-300 bg-blue-50/70" : "border-slate-100 hover:border-slate-200 hover:bg-slate-50"}`}><button type="button" onClick={() => setSelectedTargetId(target.id)} className="w-full text-left"><div className="flex items-start justify-between gap-2"><span className="truncate text-sm font-bold text-slate-800">{target.name}</span><span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${badgeClass(target.status)}`}>{targetStatusLabel(target.status)}</span></div><p className="mt-1 truncate text-[11px] text-slate-500">{target.organization_type} · {target.delivery_mode === "manual_first_contact" ? t("manualFirstContact", "manual first contact") : target.delivery_mode}</p></button>{targetMenuId === target.id && <div className="absolute right-2 top-2 z-20 w-48 rounded-lg border border-slate-200 bg-white p-1 shadow-xl"><button type="button" onClick={() => { setTargetMenuId(""); void generateTargetDraft(target); }} className="w-full rounded px-2 py-1.5 text-left text-xs hover:bg-slate-50">{t("generate", "Generate draft")}</button><button type="button" onClick={() => { setTargetMenuId(""); void approveTargetDraft(target); }} className="w-full rounded px-2 py-1.5 text-left text-xs hover:bg-slate-50">{t("approveDraft", "Approve draft")}</button><button type="button" onClick={() => { setTargetMenuId(""); void copyTargetDraft(target); }} className="w-full rounded px-2 py-1.5 text-left text-xs hover:bg-slate-50">{t("copy", "Copy draft")}</button><button type="button" onClick={() => { openTargetUrl(target); setTargetMenuId(""); }} className="flex w-full items-center gap-1 rounded px-2 py-1.5 text-left text-xs hover:bg-slate-50"><ExternalLink className="h-3 w-3" />{t("openUrl", "Open URL / find page")}</button><select value={target.status} onChange={(event) => { setSelectedTargetId(target.id); setTargetMenuId(""); void request(`/api/outreach/targets/${encodeURIComponent(target.id)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(targetPayload(target, { status: event.target.value as TargetStatus })) }, t("targetUpdated", "Target updated")).then(() => void loadCampaignDetail(selectedCampaignId, target.id)); }} className="mt-1 w-full rounded border border-slate-200 px-2 py-1.5 text-xs">{Object.entries(statusLabels).map(([value]) => <option key={value} value={value}>{targetStatusLabel(value as TargetStatus)}</option>)}</select></div>}</div>)}{selectedCampaign && filteredTargets.length === 0 && <p className="py-5 text-center text-sm text-slate-500">{t("noTargetsMatch", "No targets match.")}</p>}</div>
        </section>

        <section className="min-h-0 min-w-0 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-3">
          {!selectedTarget ? <div className="flex min-h-[420px] items-center justify-center text-center text-sm text-slate-500">{t("selectTarget", "Select a target to prepare an outreach message.")}</div> : <>
            <div className="sticky top-0 z-10 -mx-3 -mt-3 border-b border-slate-100 bg-white px-3 py-2"><div className="flex items-center justify-between gap-2"><h3 className="truncate text-base font-bold text-slate-900">{selectedTarget.name}</h3><span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${badgeClass(selectedTarget.status)}`}>{targetStatusLabel(selectedTarget.status)}</span></div><div className="mt-2 flex flex-wrap gap-1.5">{canManage && <><button type="button" disabled={busy} onClick={() => void saveDraft("generate")} className="rounded-md bg-blue-600 px-2 py-1.5 text-[11px] font-bold text-white">{t("generate", "Generate")}</button><button type="button" disabled={busy || !draftBody.trim()} onClick={() => void saveDraft("manual")} className="rounded-md border border-slate-200 px-2 py-1.5 text-[11px] font-bold text-slate-700">{t("saveRevision", "Save")}</button><button type="button" disabled={!draftBody.trim()} onClick={() => void copyDraft()} className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1.5 text-[11px] font-bold text-slate-700"><Copy className="h-3 w-3" />{t("copy", "Copy")}</button>{drafts[0]?.approval_status !== "approved" && <button type="button" disabled={!drafts[0] || draftDirty} onClick={() => void approveDraft()} className="rounded-md bg-emerald-600 px-2 py-1.5 text-[11px] font-bold text-white disabled:opacity-50">{t("approveDraft", "Approve")}</button>}<button type="button" onClick={() => void setFollowUp()} className="rounded-md border border-slate-200 px-2 py-1.5 text-[11px] font-bold text-slate-700">{t("followUp", "Follow-up")}</button></>}{selectedTarget.facebook_page_url && <button type="button" onClick={() => window.open(selectedTarget.facebook_page_url, "_blank", "noopener,noreferrer")} className="rounded-md border border-slate-200 px-2 py-1.5 text-[11px] font-bold text-slate-700"><ExternalLink className="h-3 w-3" /></button>}</div></div>
            {messages.length > 0 && <div className="mt-4 rounded-xl border border-slate-100 p-3"><div className="flex items-center justify-between"><h4 className="text-sm font-bold text-slate-900">{t("conversationHistory", "Conversation history")}</h4><span className="text-[10px] text-slate-400">{messages.length} {t("messages", "messages")}</span></div><div className="mt-2 max-h-40 space-y-1.5 overflow-y-auto">{messages.slice(-8).map((message) => <div key={message.id} className={`rounded-lg px-2.5 py-2 text-xs ${message.type === "incoming" ? "bg-blue-50 text-blue-900" : "bg-slate-50 text-slate-700"}`}><span className="font-bold">{message.type === "incoming" ? t("target", "Target") : t("team", "Team")}:</span> {message.text}<span className="ml-2 text-[10px] text-slate-400">{formatDate(message.timestamp, language)}</span></div>)}</div></div>}
            <div className="mt-3 flex items-center justify-between gap-2"><h4 className="text-sm font-bold text-slate-900">{t("aiDraft", "AI draft")}</h4>{["replied", "follow_up"].includes(selectedTarget.status) && <button type="button" disabled={busy || !selectedTarget.bound_sender_id} onClick={() => void saveDraft("suggested_reply")} className="rounded-md bg-violet-600 px-2 py-1.5 text-[11px] font-bold text-white">{t("suggestedReply", "Suggested reply")}</button>}</div>
            <textarea value={draftBody} onChange={(event) => setDraftBody(event.target.value)} rows={10} disabled={!canManage} placeholder={t("draftPlaceholder", "Generate a draft or write one here…")} className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-3 text-sm leading-6 text-slate-800 disabled:bg-slate-50" />
            <div className="mt-1 flex items-center justify-between gap-2"><span className="text-[11px] text-slate-400">{draftDirty ? t("saveEditedBeforeApproval", "Save this edited revision before approval") : drafts[0] ? `Revision ${drafts[0].revision} · ${drafts[0].kind} · ${drafts[0].approval_status}` : t("noRevision", "No revision yet")}</span>{canManage && drafts[0]?.kind === "suggested_reply" && drafts[0]?.approval_status === "approved" && <button type="button" disabled={busy || !eligibility?.eligible} onClick={() => void sendApprovedReply()} className="rounded-md bg-emerald-700 px-2 py-1 text-[11px] font-bold text-white disabled:opacity-50">{t("approveSendReply", "Send reply")}</button>}</div>
            {(assets.length > 0 || canManage) && <div className="mt-5 rounded-xl border border-slate-100 p-3"><div className="flex items-center justify-between"><h4 className="text-sm font-bold text-slate-900">{t("pressKitAssets", "Press Kit assets")}</h4>{canManage && <button type="button" onClick={() => setShowAssetForm((value) => !value)} className="text-xs font-bold text-blue-600">{t("addAsset", "Add asset")}</button>}</div><div className="mt-2 space-y-1.5">{assets.map((asset) => <label key={asset.id} className="flex items-center gap-2 rounded-lg bg-slate-50 px-2.5 py-2 text-xs hover:bg-blue-50"><input type="checkbox" checked={selectedAssetIds.includes(asset.id)} onChange={(event) => setSelectedAssetIds((current) => event.target.checked ? [...current, asset.id] : current.filter((id) => id !== asset.id))} disabled={!canManage || !eligibility?.eligible} /><span className="min-w-0 flex-1 truncate font-semibold text-slate-700">{asset.name}</span><a href={asset.url} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}><ExternalLink className="h-3.5 w-3.5 shrink-0 text-slate-400" /></a></label>)}{assets.length === 0 && <p className="text-xs text-slate-500">{t("noPressKitAssets", "No Press Kit assets yet.")}</p>}</div>{canManage && <div className="mt-3 flex flex-wrap items-center justify-between gap-2"><span className="text-[11px] text-slate-400">{t("assetDeliveries", `${deliveries.filter((delivery) => delivery.kind === "asset" && delivery.status === "sent").length} asset deliveries recorded`).replace("{count}", String(deliveries.filter((delivery) => delivery.kind === "asset" && delivery.status === "sent").length))}</span><button type="button" disabled={busy || !eligibility?.eligible || selectedAssetIds.length === 0} onClick={() => void sendPressKit()} className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50">{t("sendSelectedAssets", "Send selected assets")}</button></div>}</div>}
            {showAssetForm && canManage && <form onSubmit={createAsset} className="mt-3 space-y-2 rounded-xl bg-slate-50 p-3"><input required value={assetForm.name} onChange={(event) => setAssetForm({ ...assetForm, name: event.target.value })} placeholder={t("assetName", "Asset name")} className="w-full rounded-lg border border-slate-200 px-2.5 py-2 text-xs" /><input required value={assetForm.url} onChange={(event) => setAssetForm({ ...assetForm, url: event.target.value })} placeholder={t("fileOrUrl", "File or URL")} className="w-full rounded-lg border border-slate-200 px-2.5 py-2 text-xs" /><div className="flex justify-end gap-2"><button type="button" onClick={() => setShowAssetForm(false)} className="px-2 py-1.5 text-xs font-bold text-slate-500">{t("cancel", "Cancel")}</button><button disabled={busy} className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-bold text-white">{t("addAsset", "Add asset")}</button></div></form>}
          </>}
        </section>
      </div>
    </div>
  );
}

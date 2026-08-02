import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Check, Copy, ExternalLink, Megaphone, Plus, RefreshCw, Save, Sparkles } from "lucide-react";

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

type Props = { eventId: string; apiFetch: ApiFetch; canManage: boolean };

const statusLabels: Record<TargetStatus, string> = {
  new: "New", drafted: "Drafted", approved: "Approved", contacted: "Contacted", waiting_reply: "Waiting for reply", replied: "Replied", press_kit_sent: "Press Kit sent", follow_up: "Follow-up", published: "Published", declined: "Declined", no_response: "No response",
};

const campaignStatusLabels: Record<CampaignStatus, string> = { draft: "Draft", active: "Active", paused: "Paused", completed: "Completed", archived: "Archived" };

const emptyCampaign = { name: "", description: "", objective: "", context: "", default_instruction: "", start_date: "", end_date: "", status: "draft" as CampaignStatus };
const emptyTarget = { name: "", facebook_page_url: "", facebook_page_id: "", organization_type: "media", contact_person: "", email: "", website: "", notes: "", priority: "normal" as Priority, next_follow_up_at: "" };
const emptyAsset = { name: "", type: "press_release", description: "", url: "", tags: "" };

function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" });
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

export function OutreachScreen({ eventId, apiFetch, canManage }: Props) {
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
  const [importCsv, setImportCsv] = useState("");
  const [importPreview, setImportPreview] = useState<{ valid_count: number; invalid_count: number; invalid?: Array<{ row: number; errors: string[] }> } | null>(null);
  const [selectedAssetIds, setSelectedAssetIds] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | TargetStatus>("all");
  const [dueOnly, setDueOnly] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

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
    const data = await request("/api/outreach/campaigns", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ event_id: eventId, ...campaignForm }) }, "Campaign created");
    if (data?.id) { setCampaignForm(emptyCampaign); setShowCampaignForm(false); await loadCampaigns(data.id); }
  };

  const createTarget = async (event: FormEvent) => {
    event.preventDefault();
    if (!canManage || !selectedCampaignId) return;
    const data = await request("/api/outreach/targets", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ event_id: eventId, campaign_id: selectedCampaignId, ...targetForm }) }, "Target added — review duplicate warning if shown");
    if (data?.id) { setMessage(data.cross_campaign_warning ? "Target added — matching identity exists in another campaign in this event." : data.duplicate_warning ? "Target added — matching identity already exists in this campaign." : "Target added"); setTargetForm(emptyTarget); setShowTargetForm(false); await loadCampaignDetail(selectedCampaignId, data.id); }
  };

  const createAsset = async (event: FormEvent) => {
    event.preventDefault();
    if (!canManage || !selectedCampaignId) return;
    const data = await request("/api/outreach/assets", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ event_id: eventId, campaign_id: selectedCampaignId, ...assetForm }) }, "Press Kit asset added");
    if (data?.id) { setAssetForm(emptyAsset); setShowAssetForm(false); await loadCampaignDetail(selectedCampaignId); }
  };

  const saveDraft = async (mode: "generate" | "manual" | "suggested_reply") => {
    if (!canManage || !selectedTarget) return;
    const data = await request(`/api/outreach/targets/${encodeURIComponent(selectedTarget.id)}/drafts`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ event_id: eventId, mode, kind: drafts[0]?.kind || "initial", body: mode === "manual" ? draftBody : undefined }) }, mode === "generate" ? "AI draft generated — review before approval" : mode === "suggested_reply" ? "Suggested reply generated — review before approval" : "Draft saved");
    if (data?.id) { setDrafts((current) => [data as Draft, ...current]); setDraftBody(data.body || ""); await loadCampaignDetail(selectedCampaignId, selectedTarget.id); }
  };

  const approveDraft = async () => {
    const latest = drafts[0];
    if (!canManage || !latest) return;
    const data = await request(`/api/outreach/drafts/${encodeURIComponent(latest.id)}/approve`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ event_id: eventId }) }, "Draft approved — send manually after review");
    if (data?.id) { setDrafts((current) => current.map((draft) => draft.id === data.id ? data as Draft : draft)); await loadCampaignDetail(selectedCampaignId, selectedTargetId); }
  };

  const sendApprovedReply = async () => {
    const latest = drafts[0];
    if (!canManage || !latest || latest.kind !== "suggested_reply" || latest.approval_status !== "approved") return;
    const data = await request(`/api/outreach/drafts/${encodeURIComponent(latest.id)}/send`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ event_id: eventId }) }, "Approved reply sent");
    if (data?.delivery) { setDeliveries((current) => [data.delivery as Delivery, ...current.filter((delivery) => delivery.id !== data.delivery.id)]); await loadCampaignDetail(selectedCampaignId, selectedTargetId); await loadTargetDetail(selectedTargetId); }
  };

  const sendPressKit = async () => {
    if (!canManage || !selectedTarget || selectedAssetIds.length === 0) return;
    const data = await request(`/api/outreach/targets/${encodeURIComponent(selectedTarget.id)}/press-kit/send`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ event_id: eventId, asset_ids: selectedAssetIds, approved_draft_id: drafts[0]?.kind === "suggested_reply" && drafts[0].approval_status === "approved" ? drafts[0].id : undefined, confirm: true }) }, "Press Kit delivery recorded");
    if (data) { setSelectedAssetIds([]); await loadCampaignDetail(selectedCampaignId, selectedTarget.id); await loadTargetDetail(selectedTarget.id); }
  };

  const bindIdentity = async () => {
    if (!canManage || !selectedTarget) return;
    const pageId = window.prompt("Facebook Page ID", selectedTarget.bound_page_id || selectedTarget.facebook_page_id || "")?.trim();
    const senderId = window.prompt("Messenger sender ID", selectedTarget.bound_sender_id || "")?.trim();
    if (!pageId || !senderId) return;
    const data = await request(`/api/outreach/targets/${encodeURIComponent(selectedTarget.id)}/identity`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ event_id: eventId, page_id: pageId, sender_id: senderId }) }, "Facebook identity bound");
    if (data?.id) { setTargets((current) => current.map((target) => target.id === data.id ? data as Target : target)); await loadTargetDetail(selectedTarget.id); }
  };

  const setFollowUp = async () => {
    if (!canManage || !selectedTarget) return;
    const value = window.prompt("Follow-up date/time (YYYY-MM-DDTHH:mm)", selectedTarget.next_follow_up_at ? selectedTarget.next_follow_up_at.slice(0, 16) : "");
    if (value === null) return;
    const parsed = value.trim() ? new Date(value) : null;
    if (value.trim() && (!parsed || Number.isNaN(parsed.getTime()))) { setMessage("Enter a valid follow-up date/time"); return; }
    await updateTarget({ next_follow_up_at: parsed ? parsed.toISOString() : null, status: parsed ? "follow_up" : selectedTarget.status });
  };

  const setOutcome = async (status: "published" | "declined" | "no_response") => {
    if (!canManage || !selectedTarget) return;
    const note = window.prompt(`Outcome note for ${status}`, selectedTarget.outcome_note || "");
    if (note === null) return;
    await updateTarget({ status, outcome_note: note.trim(), next_follow_up_at: null });
  };

  const updateTarget = async (overrides: Partial<Pick<Target, "status" | "delivery_mode" | "next_follow_up_at" | "outcome_note" | "assigned_user_id">>) => {
    if (!canManage || !selectedTarget) return;
    const data = await request(`/api/outreach/targets/${encodeURIComponent(selectedTarget.id)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(targetPayload(selectedTarget, overrides)) }, "Target updated");
    if (data?.id) { setTargets((current) => current.map((target) => target.id === data.id ? data as Target : target)); }
  };

  const importTargets = async () => {
    if (!canManage || !selectedCampaignId || !importCsv.trim()) return;
    const preview = await request("/api/outreach/targets/import/preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ event_id: eventId, campaign_id: selectedCampaignId, csv: importCsv }) }, "Import preview ready");
    if (preview) setImportPreview(preview);
    if (!preview || preview.invalid_count > 0) return;
    const data = await request("/api/outreach/targets/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ event_id: eventId, campaign_id: selectedCampaignId, csv: importCsv }) }, "Targets imported");
    if (data) { setImportCsv(""); setImportPreview(null); setShowImportForm(false); await loadCampaignDetail(selectedCampaignId); await loadCampaigns(selectedCampaignId); }
  };

  const exportTargets = () => {
    window.open(`/api/outreach/targets/export?event_id=${encodeURIComponent(eventId)}&campaign_id=${encodeURIComponent(selectedCampaignId)}`, "_blank", "noopener,noreferrer");
  };

  const copyDraft = async () => {
    if (!draftBody.trim()) return;
    await navigator.clipboard?.writeText(draftBody);
    setMessage("Draft copied to clipboard");
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
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[.18em] text-blue-600">Press & media workflow</p>
          <h2 className="mt-1 flex items-center gap-2 text-xl font-bold text-slate-900"><Megaphone className="h-5 w-5 text-blue-600" />Outreach</h2>
          <p className="mt-1 max-w-2xl text-sm text-slate-500">AI prepares drafts. A person reviews every first contact and every reply before delivery.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => void loadCampaigns()} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700"><RefreshCw className="h-3.5 w-3.5" />Refresh</button>
          {canManage && selectedCampaign && <><button type="button" onClick={() => setShowImportForm((value) => !value)} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700">Import CSV</button><button type="button" onClick={exportTargets} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700">Export CSV</button></>}
          {canManage && <button type="button" onClick={() => setShowCampaignForm((value) => !value)} className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-3 py-2 text-xs font-bold text-white"><Plus className="h-3.5 w-3.5" />New campaign</button>}
        </div>
      </div>

      {message && <div className="rounded-xl border border-blue-100 bg-blue-50 px-3 py-2.5 text-sm text-blue-800">{message}</div>}

      {showCampaignForm && canManage && <form onSubmit={createCampaign} className="rounded-2xl border border-blue-100 bg-blue-50/50 p-4">
        <div className="grid gap-3 md:grid-cols-2">
          <label className="text-xs font-bold text-slate-700">Campaign name<input required value={campaignForm.name} onChange={(event) => setCampaignForm({ ...campaignForm, name: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-normal" placeholder="Manohra — Press Outreach 2026" /></label>
          <label className="text-xs font-bold text-slate-700">Objective<input value={campaignForm.objective} onChange={(event) => setCampaignForm({ ...campaignForm, objective: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-normal" placeholder="Invite arts and media coverage" /></label>
          <label className="text-xs font-bold text-slate-700 md:col-span-2">Description<textarea rows={2} value={campaignForm.description} onChange={(event) => setCampaignForm({ ...campaignForm, description: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-normal" /></label>
          <label className="text-xs font-bold text-slate-700 md:col-span-2">Campaign context<textarea rows={5} value={campaignForm.context} onChange={(event) => setCampaignForm({ ...campaignForm, context: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-normal" placeholder="Facts the outreach assistant may use: story, creator, venue, dates, links…" /></label>
          <label className="text-xs font-bold text-slate-700 md:col-span-2">Default outreach instruction<textarea rows={2} value={campaignForm.default_instruction} onChange={(event) => setCampaignForm({ ...campaignForm, default_instruction: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-normal" placeholder="Keep it warm, specific, and ask whether they would like the press kit." /></label>
        </div>
        <div className="mt-3 flex justify-end gap-2"><button type="button" onClick={() => setShowCampaignForm(false)} className="rounded-lg px-3 py-2 text-xs font-bold text-slate-600">Cancel</button><button disabled={busy} className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-bold text-white">Create campaign</button></div>
      </form>}

      {showImportForm && canManage && selectedCampaign && <div className="rounded-2xl border border-slate-200 bg-white p-4"><p className="text-sm font-bold text-slate-900">Import targets</p><p className="mt-1 text-xs text-slate-500">Paste CSV with at least a <code>name</code> column. Duplicate identities are rejected in preview.</p><textarea value={importCsv} onChange={(event) => { setImportCsv(event.target.value); setImportPreview(null); }} rows={5} className="mt-3 w-full rounded-xl border border-slate-200 px-3 py-2 text-xs font-mono" placeholder="name,facebook_page_url,email,organization_type\nArts Desk,https://facebook.com/artsdesk,desk@example.com,arts media" />{importPreview && <div className={`mt-2 rounded-lg px-3 py-2 text-xs ${importPreview.invalid_count > 0 ? "bg-rose-50 text-rose-800" : "bg-emerald-50 text-emerald-800"}`}>Preview: {importPreview.valid_count} valid · {importPreview.invalid_count} invalid{importPreview.invalid?.length ? ` · rows ${importPreview.invalid.map((row) => row.row).join(", ")}` : ""}</div>}<div className="mt-3 flex justify-end gap-2"><button type="button" onClick={() => setShowImportForm(false)} className="rounded-lg px-3 py-2 text-xs font-bold text-slate-500">Cancel</button><button type="button" disabled={busy || !importCsv.trim()} onClick={() => void importTargets()} className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-bold text-white">Preview & import</button></div></div>}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-7">
        {[{ label: "Targets", value: counts.total }, { label: "Not contacted", value: counts.new }, { label: "Waiting", value: counts.waiting }, { label: "Replied", value: counts.replied }, { label: "Press Kit sent", value: counts.pressKit }, { label: "Follow-up due", value: counts.due }, { label: "Published", value: counts.published }].map((item) => <div key={item.label} className="rounded-xl border border-slate-200 bg-white px-3 py-2.5"><p className="text-[10px] font-bold uppercase tracking-[.12em] text-slate-400">{item.label}</p><p className="mt-1 text-xl font-bold text-slate-900">{item.value}</p></div>)}
      </div>

      <div className="grid min-w-0 gap-4 xl:grid-cols-[250px_minmax(260px,0.75fr)_minmax(420px,1.25fr)]">
        <section className="min-w-0 rounded-2xl border border-slate-200 bg-white p-3">
          <div className="mb-2 flex items-center justify-between"><h3 className="text-sm font-bold text-slate-900">Campaigns</h3>{loading && <RefreshCw className="h-3.5 w-3.5 animate-spin text-slate-400" />}</div>
          <div className="space-y-1.5">{campaigns.map((campaign) => <button type="button" key={campaign.id} onClick={() => setSelectedCampaignId(campaign.id)} className={`w-full rounded-xl px-3 py-2.5 text-left ${selectedCampaignId === campaign.id ? "bg-blue-50 text-blue-800" : "hover:bg-slate-50"}`}><div className="flex items-start justify-between gap-2"><span className="line-clamp-2 text-sm font-bold">{campaign.name}</span><span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${campaign.status === "active" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{campaignStatusLabels[campaign.status]}</span></div><p className="mt-1 text-[11px] text-slate-500">{campaign.target_count} targets · {campaign.needs_action_count} replied</p></button>)}{campaigns.length === 0 && <p className="px-2 py-5 text-sm text-slate-500">No campaigns yet.</p>}</div>
        </section>

        <section className="min-w-0 rounded-2xl border border-slate-200 bg-white p-3">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2"><div><h3 className="text-sm font-bold text-slate-900">Targets</h3><p className="text-[11px] text-slate-500">{selectedCampaign?.name || "Choose a campaign"}</p></div>{canManage && selectedCampaign && <button type="button" onClick={() => setShowTargetForm((value) => !value)} className="rounded-lg bg-blue-600 p-1.5 text-white" aria-label="Add target"><Plus className="h-4 w-4" /></button>}</div>
          <div className="space-y-2"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search targets" className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs" /><div className="flex gap-2"><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as "all" | TargetStatus)} className="min-w-0 flex-1 rounded-lg border border-slate-200 px-3 py-2 text-xs"><option value="all">All statuses</option>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><button type="button" onClick={() => setStatusFilter((current) => current === "replied" ? "all" : "replied")} className={`rounded-lg border px-2.5 py-2 text-[11px] font-bold ${statusFilter === "replied" ? "border-violet-300 bg-violet-50 text-violet-700" : "border-slate-200 text-slate-600"}`}>Needs action {counts.replied}</button><button type="button" onClick={() => setDueOnly((current) => !current)} className={`rounded-lg border px-2.5 py-2 text-[11px] font-bold ${dueOnly ? "border-amber-300 bg-amber-50 text-amber-800" : "border-slate-200 text-slate-600"}`}>Due {counts.due}</button></div></div>
          {showTargetForm && canManage && selectedCampaign && <form onSubmit={createTarget} className="mt-3 space-y-2 rounded-xl bg-slate-50 p-3"><input required value={targetForm.name} onChange={(event) => setTargetForm({ ...targetForm, name: event.target.value })} placeholder="Target / organization name" className="w-full rounded-lg border border-slate-200 px-2.5 py-2 text-xs" /><div className="grid grid-cols-2 gap-2"><input value={targetForm.organization_type} onChange={(event) => setTargetForm({ ...targetForm, organization_type: event.target.value })} placeholder="Type e.g. arts media" className="rounded-lg border border-slate-200 px-2.5 py-2 text-xs" /><select value={targetForm.priority} onChange={(event) => setTargetForm({ ...targetForm, priority: event.target.value as Priority })} className="rounded-lg border border-slate-200 px-2.5 py-2 text-xs"><option value="high">High priority</option><option value="normal">Normal</option><option value="low">Low</option></select></div><input value={targetForm.facebook_page_url} onChange={(event) => setTargetForm({ ...targetForm, facebook_page_url: event.target.value })} placeholder="Facebook Page URL" className="w-full rounded-lg border border-slate-200 px-2.5 py-2 text-xs" /><input value={targetForm.email} onChange={(event) => setTargetForm({ ...targetForm, email: event.target.value })} placeholder="Email (optional)" className="w-full rounded-lg border border-slate-200 px-2.5 py-2 text-xs" /><textarea rows={2} value={targetForm.notes} onChange={(event) => setTargetForm({ ...targetForm, notes: event.target.value })} placeholder="Internal notes" className="w-full rounded-lg border border-slate-200 px-2.5 py-2 text-xs" /><div className="flex justify-end gap-2"><button type="button" onClick={() => setShowTargetForm(false)} className="px-2 py-1.5 text-xs font-bold text-slate-500">Cancel</button><button disabled={busy} className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-bold text-white">Add target</button></div></form>}
          <div className="mt-3 space-y-1.5">{filteredTargets.map((target) => <button type="button" key={target.id} onClick={() => setSelectedTargetId(target.id)} className={`w-full rounded-xl border px-3 py-2.5 text-left ${selectedTargetId === target.id ? "border-blue-300 bg-blue-50/70" : "border-slate-100 hover:border-slate-200 hover:bg-slate-50"}`}><div className="flex items-start justify-between gap-2"><span className="truncate text-sm font-bold text-slate-800">{target.name}</span><span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${badgeClass(target.status)}`}>{statusLabels[target.status]}</span></div><p className="mt-1 truncate text-[11px] text-slate-500">{target.organization_type} · {target.delivery_mode === "manual_first_contact" ? "manual first contact" : target.delivery_mode}</p></button>)}{selectedCampaign && filteredTargets.length === 0 && <p className="py-5 text-center text-sm text-slate-500">No targets match.</p>}</div>
        </section>

        <section className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4">
          {!selectedTarget ? <div className="flex min-h-[420px] items-center justify-center text-center text-sm text-slate-500">Select a target to prepare an outreach message.</div> : <>
            <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-[10px] font-bold uppercase tracking-[.16em] text-blue-600">Target detail</p><h3 className="mt-1 text-lg font-bold text-slate-900">{selectedTarget.name}</h3><p className="mt-1 text-xs text-slate-500">{selectedTarget.organization_type} · {selectedTarget.contact_person || "No contact person"}</p></div><span className={`rounded-full px-2.5 py-1 text-xs font-bold ${badgeClass(selectedTarget.status)}`}>{statusLabels[selectedTarget.status]}</span></div>
            <div className="mt-3 grid gap-2 rounded-xl bg-amber-50 p-3 text-xs text-amber-900"><p className="font-bold">{eligibility?.eligible ? "API reply eligible" : selectedTarget.delivery_mode === "manual_first_contact" ? "Manual first contact" : selectedTarget.delivery_mode}</p><p>{eligibility?.eligible ? `Approved replies can use the existing sender until ${formatDate(eligibility.eligible_until)}` : eligibility?.reason || "AI can prepare the copy, but send the first message in Facebook/Messenger yourself."}</p><div className="flex flex-wrap gap-2">{selectedTarget.facebook_page_url && <button type="button" onClick={() => window.open(selectedTarget.facebook_page_url, "_blank", "noopener,noreferrer")} className="inline-flex items-center gap-1 font-bold text-amber-800"><ExternalLink className="h-3.5 w-3.5" />Open target page</button>}{canManage && <><button type="button" onClick={bindIdentity} className="rounded-lg border border-amber-300 px-2.5 py-1.5 font-bold text-amber-800">Bind identity</button>{["new", "drafted", "approved"].includes(selectedTarget.status) && <button type="button" onClick={() => void updateTarget({ status: "contacted", delivery_mode: selectedTarget.bound_sender_id ? "manual_only" : "manual_first_contact" })} className="inline-flex items-center gap-1 rounded-lg bg-amber-700 px-2.5 py-1.5 font-bold text-white">Mark contacted</button>}</>}</div></div>
            <div className="mt-4 grid gap-2 sm:grid-cols-2"><div className="rounded-lg border border-slate-100 px-3 py-2"><p className="text-[10px] font-bold uppercase text-slate-400">Facebook</p><p className="mt-1 truncate text-xs text-slate-700">{selectedTarget.facebook_page_url || "Not provided"}</p><p className="mt-1 truncate text-[10px] text-slate-400">{selectedTarget.bound_page_id ? `Page ${selectedTarget.bound_page_id} · sender ${selectedTarget.bound_sender_id}` : "Identity not bound"}</p></div><div className="rounded-lg border border-slate-100 px-3 py-2"><p className="text-[10px] font-bold uppercase text-slate-400">Contact timeline</p><p className="mt-1 text-xs text-slate-700">First contact: {formatDate(selectedTarget.last_contacted_at)}</p><p className="mt-1 text-xs text-slate-700">Last reply: {formatDate(selectedTarget.last_replied_at)}</p></div></div>
            {assignees.length > 0 && canManage && <label className="mt-3 block text-xs font-bold text-slate-700">Owner<select value={selectedTarget.assigned_user_id || ""} onChange={(event) => void updateTarget({ assigned_user_id: event.target.value || null })} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-xs font-normal"><option value="">Unassigned</option>{assignees.map((assignee) => <option key={assignee.id} value={assignee.id}>{assignee.display_name || assignee.username}</option>)}</select></label>}
            {canManage && <div className="mt-3 flex flex-wrap gap-2"><button type="button" onClick={() => void setFollowUp()} className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-bold text-slate-700">{selectedTarget.next_follow_up_at ? `Follow-up: ${formatDate(selectedTarget.next_follow_up_at)}` : "Set follow-up"}</button><button type="button" onClick={() => void setOutcome("published")} className="rounded-lg border border-emerald-200 px-2.5 py-1.5 text-xs font-bold text-emerald-700">Published</button><button type="button" onClick={() => void setOutcome("declined")} className="rounded-lg border border-rose-200 px-2.5 py-1.5 text-xs font-bold text-rose-700">Declined</button><button type="button" onClick={() => void setOutcome("no_response")} className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-bold text-slate-600">No response</button></div>}
            {messages.length > 0 && <div className="mt-4 rounded-xl border border-slate-100 p-3"><div className="flex items-center justify-between"><h4 className="text-sm font-bold text-slate-900">Conversation history</h4><span className="text-[10px] text-slate-400">{messages.length} messages</span></div><div className="mt-2 max-h-40 space-y-1.5 overflow-y-auto">{messages.slice(-8).map((message) => <div key={message.id} className={`rounded-lg px-2.5 py-2 text-xs ${message.type === "incoming" ? "bg-blue-50 text-blue-900" : "bg-slate-50 text-slate-700"}`}><span className="font-bold">{message.type === "incoming" ? "Target" : "Team"}:</span> {message.text}<span className="ml-2 text-[10px] text-slate-400">{formatDate(message.timestamp)}</span></div>)}</div></div>}
            <div className="mt-4 flex flex-wrap items-center justify-between gap-2"><div><h4 className="text-sm font-bold text-slate-900">AI draft</h4><p className="text-[11px] text-slate-500">Every revision stays unapproved until a person reviews it.</p></div><div className="flex flex-wrap gap-2">{canManage && <><button type="button" disabled={busy} onClick={() => void saveDraft("generate")} className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-xs font-bold text-white"><Sparkles className="h-3.5 w-3.5" />Generate</button>{["replied", "follow_up"].includes(selectedTarget.status) && <button type="button" disabled={busy || !selectedTarget.bound_sender_id} onClick={() => void saveDraft("suggested_reply")} className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-2 text-xs font-bold text-white"><Sparkles className="h-3.5 w-3.5" />Suggested reply</button>}<button type="button" disabled={busy || !draftBody.trim()} onClick={() => void saveDraft("manual")} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700"><Save className="h-3.5 w-3.5" />Save revision</button></>}</div></div>
            <textarea value={draftBody} onChange={(event) => setDraftBody(event.target.value)} rows={10} disabled={!canManage} placeholder="Generate a draft or write one here…" className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-3 text-sm leading-6 text-slate-800 disabled:bg-slate-50" />
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2"><div className="flex flex-wrap gap-2">{canManage && <button type="button" disabled={!draftBody.trim()} onClick={() => void copyDraft()} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-bold text-slate-600"><Copy className="h-3.5 w-3.5" />Copy</button>}{canManage && drafts[0]?.approval_status !== "approved" && <button type="button" disabled={!drafts[0] || draftDirty} onClick={() => void approveDraft()} className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1.5 text-xs font-bold text-white disabled:cursor-not-allowed disabled:opacity-50"><Check className="h-3.5 w-3.5" />Approve draft</button>}{canManage && drafts[0]?.kind === "suggested_reply" && drafts[0]?.approval_status === "approved" && <button type="button" disabled={busy || !eligibility?.eligible} onClick={() => void sendApprovedReply()} className="rounded-lg bg-emerald-700 px-2.5 py-1.5 text-xs font-bold text-white disabled:opacity-50">Approve & Send reply</button>}</div><span className="text-[11px] text-slate-400">{draftDirty ? "Save this edited revision before approval" : drafts[0] ? `Revision ${drafts[0].revision} · ${drafts[0].kind} · ${drafts[0].approval_status}` : "No revision yet"}</span></div>
            {(assets.length > 0 || canManage) && <div className="mt-5 rounded-xl border border-slate-100 p-3"><div className="flex items-center justify-between"><h4 className="text-sm font-bold text-slate-900">Press Kit assets</h4>{canManage && <button type="button" onClick={() => setShowAssetForm((value) => !value)} className="text-xs font-bold text-blue-600">Add asset</button>}</div><div className="mt-2 space-y-1.5">{assets.map((asset) => <label key={asset.id} className="flex items-center gap-2 rounded-lg bg-slate-50 px-2.5 py-2 text-xs hover:bg-blue-50"><input type="checkbox" checked={selectedAssetIds.includes(asset.id)} onChange={(event) => setSelectedAssetIds((current) => event.target.checked ? [...current, asset.id] : current.filter((id) => id !== asset.id))} disabled={!canManage || !eligibility?.eligible} /><span className="min-w-0 flex-1 truncate font-semibold text-slate-700">{asset.name}</span><a href={asset.url} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}><ExternalLink className="h-3.5 w-3.5 shrink-0 text-slate-400" /></a></label>)}{assets.length === 0 && <p className="text-xs text-slate-500">No Press Kit assets yet.</p>}</div>{canManage && <div className="mt-3 flex flex-wrap items-center justify-between gap-2"><span className="text-[11px] text-slate-400">{deliveries.filter((delivery) => delivery.kind === "asset" && delivery.status === "sent").length} asset deliveries recorded</span><button type="button" disabled={busy || !eligibility?.eligible || selectedAssetIds.length === 0} onClick={() => void sendPressKit()} className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50">Send selected assets</button></div>}</div>}
            {showAssetForm && canManage && <form onSubmit={createAsset} className="mt-3 space-y-2 rounded-xl bg-slate-50 p-3"><input required value={assetForm.name} onChange={(event) => setAssetForm({ ...assetForm, name: event.target.value })} placeholder="Asset name" className="w-full rounded-lg border border-slate-200 px-2.5 py-2 text-xs" /><input required value={assetForm.url} onChange={(event) => setAssetForm({ ...assetForm, url: event.target.value })} placeholder="File or URL" className="w-full rounded-lg border border-slate-200 px-2.5 py-2 text-xs" /><div className="flex justify-end gap-2"><button type="button" onClick={() => setShowAssetForm(false)} className="px-2 py-1.5 text-xs font-bold text-slate-500">Cancel</button><button disabled={busy} className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-bold text-white">Add asset</button></div></form>}
          </>}
        </section>
      </div>
    </div>
  );
}

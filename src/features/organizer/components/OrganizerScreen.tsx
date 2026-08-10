import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { Building2, Plus, RefreshCw, Save, UserRound, WalletCards } from "lucide-react";

import {
  ActionButton,
  PageBanner,
  StatusBadge,
} from "../../../components/shared/AppUi";
import type { AuthUser, OrganizerProfileRecord } from "../../../types";

type OrganizerScreenProps = {
  apiFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  authUser: AuthUser | null;
  canEditSettings: boolean;
  onOrganizerProfilesChanged: () => void;
};

type OrganizerProfileForm = {
  name: string;
  slug: string;
  legal_name: string;
  display_name: string;
  description: string;
  logo_url: string;
  website_url: string;
  facebook_url: string;
  line_url: string;
  contact_text: string;
};

type OrganizerFinancialProfileForm = {
  promptpay_id: string;
  promptpay_receiver_name: string;
  legal_entity_type: string;
  tax_id: string;
  vat_status: string;
  vat_rate_percent: number;
  registered_address: string;
  branch_number: string;
  billing_document_mode: string;
  platform_fee_type: string;
  platform_fee_value: number;
  platform_fee_payer: string;
  payment_fee_value: number;
  payout_mode: string;
  payout_schedule: string;
  pricing_policy_enabled: boolean;
  clear_promptpay_id: boolean;
};

type OrganizerSection = "profile" | "finance";

const inputClass = "mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm font-normal normal-case tracking-normal outline-none focus:ring-2 focus:ring-blue-500";
const labelClass = "text-[10px] font-bold uppercase tracking-[.12em] text-slate-500";

function organizerId(profile: OrganizerProfileRecord | null | undefined) {
  return String(profile?.organizer_profile_id || profile?.id || "");
}

function profileFormFromResponse(data: OrganizerProfileRecord | Record<string, unknown>): OrganizerProfileForm {
  return {
    name: String(data.name || data.organization_name || data.display_name || ""),
    slug: String(data.slug || data.organization_slug || ""),
    legal_name: String(data.legal_name || ""),
    display_name: String(data.display_name || data.name || data.organization_name || ""),
    description: String(data.description || ""),
    logo_url: String(data.logo_url || ""),
    website_url: String(data.website_url || ""),
    facebook_url: String(data.facebook_url || ""),
    line_url: String(data.line_url || ""),
    contact_text: String(data.contact_text || ""),
  };
}

function organizerFinancialProfileFormFromResponse(data: Record<string, unknown>): OrganizerFinancialProfileForm {
  return {
    promptpay_id: "",
    promptpay_receiver_name: String(data.promptpay_receiver_name || ""),
    legal_entity_type: String(data.legal_entity_type || "individual"),
    tax_id: "",
    vat_status: String(data.vat_status || "unknown"),
    vat_rate_percent: Number(data.vat_rate_percent || 0),
    registered_address: String(data.registered_address || ""),
    branch_number: String(data.branch_number || ""),
    billing_document_mode: String(data.billing_document_mode || "not_required"),
    platform_fee_type: String(data.platform_fee_type || "percent"),
    platform_fee_value: Number(data.platform_fee_value || 0),
    platform_fee_payer: String(data.platform_fee_payer || "customer"),
    payment_fee_value: Number(data.payment_fee_value || 0),
    payout_mode: String(data.payout_mode || "direct_to_organizer"),
    payout_schedule: String(data.payout_schedule || "manual"),
    pricing_policy_enabled: data.pricing_policy_enabled === true,
    clear_promptpay_id: false,
  };
}

function isErrorMessage(message: string) {
  return /failed|invalid|required|must|error/i.test(message);
}

export function OrganizerScreen({ apiFetch, authUser, canEditSettings, onOrganizerProfilesChanged }: OrganizerScreenProps) {
  const apiFetchRef = useRef(apiFetch);
  const [organizers, setOrganizers] = useState<OrganizerProfileRecord[]>([]);
  const [selectedOrganizerId, setSelectedOrganizerId] = useState("");
  const [profileForm, setProfileForm] = useState<OrganizerProfileForm | null>(null);
  const [financeProfile, setFinanceProfile] = useState<Record<string, unknown> | null>(null);
  const [financeForm, setFinanceForm] = useState<OrganizerFinancialProfileForm | null>(null);
  const [section, setSection] = useState<OrganizerSection>("profile");
  const [directoryLoading, setDirectoryLoading] = useState(false);
  const [financeLoading, setFinanceLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  apiFetchRef.current = apiFetch;

  const selectedOrganizer = organizers.find((profile) => organizerId(profile) === selectedOrganizerId) || null;

  const loadOrganizers = async () => {
    if (!authUser || !canEditSettings) return;
    setDirectoryLoading(true);
    setMessage("");
    try {
      const response = await apiFetchRef.current("/api/organizers");
      const data = await response.json().catch(() => ([]));
      if (!response.ok) throw new Error(data?.error || "Failed to load organizers");
      const rows = Array.isArray(data) ? data as OrganizerProfileRecord[] : [];
      setOrganizers(rows);
      setSelectedOrganizerId((current) => rows.some((profile) => organizerId(profile) === current) ? current : organizerId(rows[0]));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to load organizers");
    } finally {
      setDirectoryLoading(false);
    }
  };

  useEffect(() => {
    void loadOrganizers();
  }, [authUser?.id, canEditSettings]);

  useEffect(() => {
    if (!selectedOrganizer) {
      setProfileForm(null);
      setFinanceProfile(null);
      setFinanceForm(null);
      return;
    }

    setProfileForm(profileFormFromResponse(selectedOrganizer));
    let cancelled = false;
    setFinanceLoading(true);
    setMessage("");
    void apiFetchRef.current(`/api/organizers/${encodeURIComponent(organizerId(selectedOrganizer))}/financial-profile`)
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data?.error || "Failed to load organizer finance settings");
        if (cancelled) return;
        const finance = data && typeof data === "object" ? data as Record<string, unknown> : selectedOrganizer.finance || {};
        setFinanceProfile(finance);
        setFinanceForm(organizerFinancialProfileFormFromResponse(finance));
      })
      .catch((error) => {
        if (!cancelled) setMessage(error instanceof Error ? error.message : "Failed to load organizer finance settings");
      })
      .finally(() => {
        if (!cancelled) setFinanceLoading(false);
      });

    return () => { cancelled = true; };
  }, [selectedOrganizerId, organizers]);

  const updateProfileField = <K extends keyof OrganizerProfileForm>(key: K, value: OrganizerProfileForm[K]) => {
    setProfileForm((current) => current ? { ...current, [key]: value } : current);
  };

  const updateFinanceField = <K extends keyof OrganizerFinancialProfileForm>(key: K, value: OrganizerFinancialProfileForm[K]) => {
    setFinanceForm((current) => current ? { ...current, [key]: value } : current);
  };

  const createOrganizer = async () => {
    if (!canEditSettings) return;
    setSaving(true);
    setMessage("");
    try {
      const response = await apiFetch("/api/organizers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "New Organizer", display_name: "New Organizer" }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error || "Failed to create organizer");
      const created = data as OrganizerProfileRecord;
      setOrganizers((current) => [...current, created]);
      setSelectedOrganizerId(organizerId(created));
      setSection("profile");
      onOrganizerProfilesChanged();
      setMessage("Organizer created. Add its public profile and finance details.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to create organizer");
    } finally {
      setSaving(false);
    }
  };

  const saveProfile = async () => {
    if (!profileForm || !selectedOrganizerId) return;
    setSaving(true);
    setMessage("");
    try {
      const response = await apiFetch(`/api/organizers/${encodeURIComponent(selectedOrganizerId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(profileForm),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error || "Failed to save organizer profile");
      const updated = data as OrganizerProfileRecord;
      setOrganizers((current) => current.map((profile) => organizerId(profile) === selectedOrganizerId ? updated : profile));
      setProfileForm(profileFormFromResponse(updated));
      onOrganizerProfilesChanged();
      setMessage("Organizer profile saved");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to save organizer profile");
    } finally {
      setSaving(false);
    }
  };

  const saveFinance = async () => {
    if (!financeForm || !selectedOrganizerId) return;
    setSaving(true);
    setMessage("");
    try {
      const response = await apiFetch(`/api/organizers/${encodeURIComponent(selectedOrganizerId)}/financial-profile`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...financeForm, promptpay_id: financeForm.promptpay_id.trim() || undefined }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error || "Failed to save organizer finance settings");
      setFinanceProfile(data);
      setFinanceForm(organizerFinancialProfileFormFromResponse(data));
      setOrganizers((current) => current.map((profile) => organizerId(profile) === selectedOrganizerId ? { ...profile, finance: data } : profile));
      setMessage("Organizer finance settings saved");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to save organizer finance settings");
    } finally {
      setSaving(false);
    }
  };

  return (
    <motion.div
      key="organizer"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="space-y-3"
    >
      <div className="surface-panel rounded-2xl p-3 sm:p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-violet-600">ORGANIZER DIRECTORY</p>
            <h1 className="mt-0.5 flex items-center gap-2 text-xl font-semibold text-slate-900">
              <Building2 className="h-5 w-5 text-violet-600" />
              Organizers
            </h1>
            <p className="mt-0.5 text-xs text-slate-500">สร้างหลาย Organizer แล้วเลือกไปผูกกับแต่ละ Event</p>
          </div>
          <div className="flex items-center gap-2">
            <StatusBadge tone="blue">{authUser?.role || "Organizer"}</StatusBadge>
            <ActionButton onClick={() => void loadOrganizers()} disabled={directoryLoading} tone="neutral" className="px-2.5 text-xs">
              {directoryLoading ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Refresh
            </ActionButton>
          </div>
        </div>
      </div>

      {!canEditSettings ? (
        <PageBanner tone="rose" icon={<WalletCards className="h-4 w-4" />}>
          บัญชีนี้ดูข้อมูล Organizer ได้ แต่ไม่มีสิทธิ์แก้ไขข้อมูลหรือการรับเงิน
        </PageBanner>
      ) : (
        <div className="grid gap-3 lg:grid-cols-[220px_minmax(0,1fr)]">
          <aside className="surface-panel rounded-2xl p-2.5">
            <div className="flex items-center justify-between gap-2 px-1.5 py-1">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[.14em] text-slate-500">Directory</p>
                <p className="text-sm font-semibold text-slate-900">{organizers.length} organizers</p>
              </div>
              <button type="button" onClick={() => void createOrganizer()} disabled={saving} className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-2 py-1.5 text-[11px] font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
                <Plus className="h-3.5 w-3.5" /> New
              </button>
            </div>
            <div className="mt-2 space-y-1.5">
              {organizers.map((profile) => {
                const id = organizerId(profile);
                const selected = id === selectedOrganizerId;
                const finance = profile.finance;
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setSelectedOrganizerId(id)}
                    className={`w-full rounded-xl border px-2.5 py-2 text-left transition ${selected ? "border-blue-500 bg-blue-50" : "border-slate-200 bg-white hover:border-blue-300"}`}
                  >
                    <div className="flex items-start gap-2">
                      <span className={`mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg ${selected ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-500"}`}>
                        <UserRound className="h-3.5 w-3.5" />
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-xs font-semibold text-slate-900">{profile.name || profile.display_name || profile.organization_name}</span>
                        <span className="mt-0.5 block truncate text-[10px] text-slate-500">{profile.slug || "No slug"}</span>
                      </span>
                    </div>
                    <span className="mt-1.5 flex items-center justify-between text-[10px] text-slate-500">
                      <span>{profile.verification_status === "verified" ? "Verified" : "Draft"}</span>
                      <span className={finance?.promptpay_ready === true ? "text-emerald-600" : "text-amber-600"}>{finance?.promptpay_ready === true ? "Payment ready" : "Payment setup"}</span>
                    </span>
                  </button>
                );
              })}
              {!directoryLoading && organizers.length === 0 && <p className="px-2 py-5 text-center text-xs text-slate-500">ยังไม่มี Organizer</p>}
            </div>
          </aside>

          <section className="surface-panel min-w-0 rounded-2xl p-3 sm:p-4">
            {selectedOrganizer && profileForm ? (
              <>
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 pb-3">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <div className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-xl bg-slate-100 text-slate-500">
                      {profileForm.logo_url ? <img src={profileForm.logo_url} alt="" className="h-full w-full object-contain" /> : <Building2 className="h-5 w-5" />}
                    </div>
                    <div className="min-w-0">
                      <h2 className="truncate text-lg font-semibold text-slate-900">{profileForm.display_name || profileForm.name}</h2>
                      <p className="truncate text-xs text-slate-500">{profileForm.slug || "No public slug"}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusBadge tone={financeProfile?.promptpay_ready === true ? "emerald" : "amber"}>{financeProfile?.promptpay_ready === true ? "PromptPay ready" : "Payment setup needed"}</StatusBadge>
                    <ActionButton onClick={() => void (section === "profile" ? saveProfile() : saveFinance())} disabled={saving || financeLoading} tone="blue" active className="text-xs">
                      {saving ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Save {section === "profile" ? "profile" : "finance"}
                    </ActionButton>
                  </div>
                </div>

                <div className="my-3 flex gap-1 rounded-xl bg-slate-100 p-1">
                  <button type="button" onClick={() => setSection("profile")} className={`flex-1 rounded-lg px-3 py-1.5 text-xs font-semibold ${section === "profile" ? "bg-white text-blue-700 shadow-sm" : "text-slate-500"}`}>Profile & public page</button>
                  <button type="button" onClick={() => setSection("finance")} className={`flex-1 rounded-lg px-3 py-1.5 text-xs font-semibold ${section === "finance" ? "bg-white text-blue-700 shadow-sm" : "text-slate-500"}`}>Finance & payout</button>
                </div>

                {section === "profile" ? (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className={labelClass}>Organizer name<input value={profileForm.name} onChange={(event) => updateProfileField("name", event.target.value)} className={inputClass} placeholder="Siangthai Dynamics" /></label>
                    <label className={labelClass}>Public display name<input value={profileForm.display_name} onChange={(event) => updateProfileField("display_name", event.target.value)} className={inputClass} placeholder="ชื่อที่แสดงในหน้า Event" /></label>
                    <label className={labelClass}>Slug<input value={profileForm.slug} onChange={(event) => updateProfileField("slug", event.target.value)} className={inputClass} placeholder="siangthai-dynamics" /></label>
                    <label className={labelClass}>Legal name<input value={profileForm.legal_name} onChange={(event) => updateProfileField("legal_name", event.target.value)} className={inputClass} placeholder="ชื่อนิติบุคคล / ชื่อบุคคล" /></label>
                    <label className={`${labelClass} sm:col-span-2`}>Logo URL<input value={profileForm.logo_url} onChange={(event) => updateProfileField("logo_url", event.target.value)} className={inputClass} placeholder="/uploads/organizers/logo.png" /></label>
                    <label className={`${labelClass} sm:col-span-2`}>Description<textarea value={profileForm.description} onChange={(event) => updateProfileField("description", event.target.value)} rows={2} className={`${inputClass} min-h-16 resize-y`} placeholder="คำอธิบายสั้น ๆ ของผู้จัดงาน" /></label>
                    <label className={labelClass}>Website URL<input value={profileForm.website_url} onChange={(event) => updateProfileField("website_url", event.target.value)} className={inputClass} placeholder="https://example.com" /></label>
                    <label className={labelClass}>Facebook URL<input value={profileForm.facebook_url} onChange={(event) => updateProfileField("facebook_url", event.target.value)} className={inputClass} placeholder="https://facebook.com/..." /></label>
                    <label className={labelClass}>LINE URL<input value={profileForm.line_url} onChange={(event) => updateProfileField("line_url", event.target.value)} className={inputClass} placeholder="https://lin.ee/..." /></label>
                    <label className={labelClass}>Contact text<input value={profileForm.contact_text} onChange={(event) => updateProfileField("contact_text", event.target.value)} className={inputClass} placeholder="อีเมลหรือช่องทางติดต่อ" /></label>
                  </div>
                ) : financeLoading || !financeForm ? (
                  <div className="py-8 text-center text-sm text-slate-500">Loading finance settings…</div>
                ) : (
                  <div className="space-y-3">
                    <PageBanner tone="blue" icon={<WalletCards className="h-4 w-4" />} className="py-1.5 text-xs">
                      การตั้งค่านี้เป็นของ Organizer รายนี้ และจะ snapshot ให้ order ใหม่ของ Event ที่เลือก Organizer นี้
                    </PageBanner>
                    <div className="surface-subpanel rounded-xl p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div><h3 className="text-sm font-semibold text-slate-900">PromptPay รับเงิน</h3><p className="text-[11px] text-slate-500">ใช้สร้าง QR และรับสลิปให้แอดมินตรวจ</p></div>
                        {Boolean(financeProfile?.promptpay_id_configured) && <StatusBadge tone="neutral">Configured: {String(financeProfile?.promptpay_id_masked || "••••")}</StatusBadge>}
                      </div>
                      <div className="mt-3 grid gap-3 sm:grid-cols-2">
                        <label className={labelClass}>Receiver name<input value={financeForm.promptpay_receiver_name} onChange={(event) => updateFinanceField("promptpay_receiver_name", event.target.value)} className={inputClass} placeholder="ชื่อผู้รับเงิน" /></label>
                        <label className={labelClass}>PromptPay ID<input value={financeForm.promptpay_id} onChange={(event) => updateFinanceField("promptpay_id", event.target.value)} disabled={financeForm.clear_promptpay_id} className={`${inputClass} font-mono disabled:bg-slate-100`} placeholder={Boolean(financeProfile?.promptpay_id_configured) ? "เว้นว่างเพื่อใช้เลขเดิม" : "เบอร์มือถือหรือเลขบัตรประชาชน"} /></label>
                      </div>
                      <label className="mt-2 flex items-center gap-2 text-xs text-slate-700"><input type="checkbox" checked={financeForm.clear_promptpay_id} onChange={(event) => updateFinanceField("clear_promptpay_id", event.target.checked)} /> ล้างเลข PromptPay ที่บันทึกไว้</label>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="surface-subpanel rounded-xl p-3">
                        <h3 className="mb-2 text-sm font-semibold text-slate-900">Tax & documents</h3>
                        <div className="grid gap-2 sm:grid-cols-2">
                          <label className={labelClass}>Entity<select value={financeForm.legal_entity_type} onChange={(event) => updateFinanceField("legal_entity_type", event.target.value)} className={inputClass}><option value="individual">Individual</option><option value="company">Company</option><option value="partnership">Partnership</option><option value="other">Other</option></select></label>
                          <label className={labelClass}>VAT status<select value={financeForm.vat_status} onChange={(event) => updateFinanceField("vat_status", event.target.value)} className={inputClass}><option value="unknown">Unknown</option><option value="not_registered">Not registered</option><option value="registered">VAT registered</option><option value="exempt">Exempt</option></select></label>
                          <label className={labelClass}>VAT rate %<input type="number" min="0" max="100" step="0.01" value={financeForm.vat_rate_percent} onChange={(event) => updateFinanceField("vat_rate_percent", Number(event.target.value) || 0)} className={inputClass} /></label>
                          <label className={labelClass}>Tax ID<input value={financeForm.tax_id} onChange={(event) => updateFinanceField("tax_id", event.target.value)} className={`${inputClass} font-mono`} placeholder={Boolean(financeProfile?.tax_id_configured) ? "เว้นว่างเพื่อใช้เลขเดิม" : "เลขผู้เสียภาษี"} /></label>
                          <label className={`${labelClass} sm:col-span-2`}>Billing document<select value={financeForm.billing_document_mode} onChange={(event) => updateFinanceField("billing_document_mode", event.target.value)} className={inputClass}><option value="not_required">Not required</option><option value="receipt">Receipt</option><option value="tax_invoice">Tax invoice</option><option value="e_tax">e-Tax</option></select></label>
                          <label className={`${labelClass} sm:col-span-2`}>Registered address<textarea value={financeForm.registered_address} onChange={(event) => updateFinanceField("registered_address", event.target.value)} rows={2} className={`${inputClass} resize-y`} /></label>
                          <label className={labelClass}>Branch number<input value={financeForm.branch_number} onChange={(event) => updateFinanceField("branch_number", event.target.value)} className={inputClass} placeholder="สำนักงานใหญ่ / 00000" /></label>
                        </div>
                      </div>
                      <div className="surface-subpanel rounded-xl p-3">
                        <h3 className="mb-2 text-sm font-semibold text-slate-900">Fee & payout</h3>
                        <div className="grid gap-2 sm:grid-cols-2">
                          <label className={labelClass}>Fee type<select value={financeForm.platform_fee_type} onChange={(event) => updateFinanceField("platform_fee_type", event.target.value)} className={inputClass}><option value="percent">Percent</option><option value="fixed">Fixed THB</option></select></label>
                          <label className={labelClass}>Platform fee<input type="number" min="0" step="0.01" value={financeForm.platform_fee_value} onChange={(event) => updateFinanceField("platform_fee_value", Number(event.target.value) || 0)} className={inputClass} /></label>
                          <label className={labelClass}>Fee payer<select value={financeForm.platform_fee_payer} onChange={(event) => updateFinanceField("platform_fee_payer", event.target.value)} className={inputClass}><option value="customer">Customer</option><option value="organizer">Organizer</option></select></label>
                          <label className={labelClass}>Payment fee THB<input type="number" min="0" step="0.01" value={financeForm.payment_fee_value} onChange={(event) => updateFinanceField("payment_fee_value", Number(event.target.value) || 0)} className={inputClass} /></label>
                          <label className={`${labelClass} sm:col-span-2`}>Payout mode<select value={financeForm.payout_mode} onChange={(event) => updateFinanceField("payout_mode", event.target.value)} className={inputClass}><option value="direct_to_organizer">Direct to organizer account</option><option value="platform_settlement">Platform settlement (manual)</option></select></label>
                          <label className={`${labelClass} sm:col-span-2`}>Payout schedule<select value={financeForm.payout_schedule} onChange={(event) => updateFinanceField("payout_schedule", event.target.value)} className={inputClass}><option value="manual">Manual</option><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option></select></label>
                        </div>
                        <label className="mt-3 flex items-start gap-2 text-xs text-slate-700"><input type="checkbox" checked={financeForm.pricing_policy_enabled} onChange={(event) => updateFinanceField("pricing_policy_enabled", event.target.checked)} className="mt-0.5" /><span><span className="font-semibold">Use this policy for new checkout orders</span><span className="block text-[11px] text-slate-500">เปิดเมื่อยืนยัน tax/fee แล้ว</span></span></label>
                      </div>
                    </div>
                  </div>
                )}
                {message && <p className={`mt-3 text-xs ${isErrorMessage(message) ? "text-rose-600" : "text-emerald-600"}`}>{message}</p>}
              </>
            ) : (
              <div className="grid min-h-64 place-items-center text-center text-sm text-slate-500"><div><Building2 className="mx-auto mb-2 h-7 w-7 text-slate-400" /><p>เลือก Organizer หรือสร้างรายการใหม่</p></div></div>
            )}
          </section>
        </div>
      )}
    </motion.div>
  );
}

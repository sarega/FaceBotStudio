import { PaidPaymentDisplaySettings, type PaidPaymentDisplayHandle } from "./PaidPaymentDisplaySettings";
import { paidSeminarFields, type PaidSeminarField, type PaidSeminarKey } from "../../../../backend/paidSeminarFields";
import { useEffect, useRef, useState, type FormEvent } from "react";

type Category = { id: string; label: string; price: string; quota: string };
type Settings = {
  version: number;
  capacity: number;
  hold_minutes: number;
  cutoff_ms: number | null;
  published: 0 | 1;
  payment_mode: "promptpay" | "external_manual";
  fields: PaidSeminarField[];
  categories: { id: string; label: string; unit_minor: number; quota: number | null }[];
};
type ApiFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
type Readiness = {
  checks: Record<string, boolean>;
  payment_mode: "promptpay" | "external_manual";
  paid_ready: boolean;
  bot_ready: boolean;
  proof_upload_ready?: boolean;
};
const readinessLabels: Record<string,string> = {
  event_active: "Event status is Active",
  event_web_page: "Event web page enabled",
  paid_published: "Paid bookings published (Accept public paid bookings)",
  paid_server_enabled: "Railway: PAID_REGISTRATION_PUBLIC_ENABLED=1",
  customer_accounts_enabled: "Railway: CUSTOMER_APP_ENABLED=1",
  customer_signup_enabled: "Railway: CUSTOMER_ACCOUNT_REGISTRATION_ENABLED=1 (new customers)",
  slip_encryption_ready: "Railway: PAID_PROOF_ENCRYPTION_KEY set to a 64-character hexadecimal key",
  organizer_receiver_ready: "Organizer financial profile: active PromptPay receiver",
  event_chat_enabled: "Event web Help Bot enabled",
  chat_session_secret: "Railway: PUBLIC_CHAT_SESSION_SECRET or compatible ticket/media secret configured",
};

const field = "mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2";

function localDateInput(ms: number | null) {
  if (ms == null) return "";
  const date = new Date(ms);
  return new Date(ms - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function SettingsForm({ settings, path, eventId, apiFetch, onSaved }: {
  settings: Settings | null; path: string; eventId: string; apiFetch: ApiFetch; onSaved: (result: Settings) => void;
}) {
  const [categories, setCategories] = useState<Category[]>(settings?.categories.map((category) => ({
    id: category.id, label: category.label, price: (category.unit_minor / 100).toFixed(2),
    quota: category.quota == null ? "" : String(category.quota),
  })) ?? [{ id: "general", label: "", price: "", quota: "" }]);
  const [seminar, setSeminar] = useState(settings?.fields ?? []);
  const [paymentMode, setPaymentMode] = useState(settings?.payment_mode === "external_manual" ? "external_manual" : "promptpay");
  const [holdDuration, setHoldDuration] = useState(settings?.hold_minutes ?? 1440);
  const displayRef = useRef<PaidPaymentDisplayHandle>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setError("");
    const publish = (event.nativeEvent as SubmitEvent).submitter instanceof HTMLButtonElement &&
      ((event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement).value === "publish";
    const data = new FormData(event.currentTarget);
    const cutoff = String(data.get("cutoff") || "");
    const parsedCategories = categories.map(({ id, label, price, quota }) => {
      const amount = /^(\d+)(?:\.(\d{1,2}))?$/.exec(price.trim());
      return {
        id, label, unit_minor: amount ? Number(amount[1]) * 100 + Number((amount[2] ?? "").padEnd(2, "0")) : 0,
        quota: quota ? Number(quota) : null,
      };
    });
    if (parsedCategories.some(({ unit_minor }) => !Number.isSafeInteger(unit_minor) || unit_minor < 0)) {
      setError("Enter a valid price (0 = free) with up to two decimal places for each category.");
      return;
    }
    setBusy(true);
    try {
      if (paymentMode === "external_manual" && !(await displayRef.current?.save())) {
        setError("บันทึกข้อมูลบัญชีหรือ QR ไม่สำเร็จ กรุณาลองอีกครั้ง");
        return;
      }
      const response = await apiFetch(path, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          version: settings?.version ?? 0, capacity: Number(data.get("capacity")),
          hold_minutes: Number(data.get("hold_minutes")), cutoff_ms: cutoff ? new Date(cutoff).getTime() : null,
          published: publish, payment_mode: paymentMode, categories: parsedCategories, fields: seminar,
        }),
      });
      const result = await response.json();
      if (!response.ok) {
        const messages: Record<string, string> = {
          version_conflict: "Someone changed these settings. Close and reopen the panel to load the current version.",
          legacy_enrollment_exists: "This event already has registrations or ticket performances.",
          capacity_in_use: "The new capacity or category quota is below current occupancy.",
          paid_enrollment_disabled: "Public paid registration is disabled for this deployment.",
          payment_profile_unavailable: "Activate a PromptPay receiver for this event’s organizer before publishing.",
        };
        const missing = Array.isArray(result.missing)
          ? result.missing.filter((key: unknown) => typeof key === "string").join(", ") : "";
        setError(result.error === "paid_enrollment_disabled" && missing
          ? "Railway ยังไม่ส่งค่าที่เปิดใช้งานมาให้ Server นี้: " + missing +
            " — ตรวจว่าอยู่ใน FaceBotStudio Service และ Environment ที่กำลัง Deploy แล้วกด Recheck"
          : result.error === "payment_profile_unavailable"
            ? "ขณะนี้เลือก PromptPay อยู่ แต่ยังไม่มี PromptPay receiver — หากใช้รูป QR/บัญชีธนาคาร ให้เลือก External payment / Admin verifies manually ด้านบนแล้วกดบันทึกและเปิดรับสมัคร"
            : messages[result.error] || result.message ||
              "Could not save these settings. Check capacity, hold duration and category details.");
        return;
      }
      onSaved(result.settings);
    } catch {
      setError("Could not reach the server. Reopen settings to check whether the changes were saved.");
    } finally {
      setBusy(false);
    }
  }
  function update(id: string, patch: Partial<Category>) {
    setCategories((current) => current.map((category) => category.id === id ? { ...category, ...patch } : category));
  }

  return (
    <form onSubmit={save} className="space-y-3">
      <h3 className="font-bold">ตั้งค่าและเปิดรับสมัครได้ในหน้านี้ — ไม่ต้องไป Organizer</h3>
      {settings?.published === 1 && <p role="status" className="rounded-lg border border-green-300 p-2 font-semibold text-green-800">ตั้งค่า Published แล้ว</p>}
      <fieldset disabled={busy} className="space-y-3">
        <fieldset className="rounded-xl border-2 border-blue-200 p-3">
          <legend className="px-2 font-bold">1. วิธีรับเงิน</legend>
          <label className="mt-2 flex cursor-pointer items-start gap-3 rounded-lg border bg-white p-3">
            <input type="radio" className="mt-1" checked={paymentMode === "external_manual"}
              onChange={() => setPaymentMode("external_manual")} />
            <span><strong>External payment / Admin verifies manually (Internal Event)</strong>
            <span className="block text-xs text-slate-600">No PromptPay setup required. Register first; accept payment outside this system.
              Admin checks it and confirms the booking later. QR is issued only after confirmation.</span></span>
          </label>
          <label className="mt-2 flex cursor-pointer items-start gap-3 rounded-lg border bg-white p-3">
            <input type="radio" className="mt-1" checked={paymentMode === "promptpay"}
              onChange={() => setPaymentMode("promptpay")} />
            <span><strong>PromptPay + payment proof</strong>
            <span className="block text-xs text-slate-600">Requires an Organizer receiving account and secure proof storage.</span></span>
          </label>
        </fieldset>
        {paymentMode === "external_manual" && <PaidPaymentDisplaySettings ref={displayRef} eventId={eventId} apiFetch={apiFetch} />}
        <h3 className="font-bold">3. จำนวนที่รับและราคา</h3>
        <div className="grid gap-3 sm:grid-cols-3">
          <label>Capacity<input className={field} name="capacity" type="number" min={1} step={1} required defaultValue={settings?.capacity} /></label>
          <label>Payment window (minutes)<input className={field} name="hold_minutes" type="number" min={1} max={43200}
            step={1} required value={holdDuration} onChange={(event) => setHoldDuration(Number(event.target.value))} />
            <button type="button" className="mt-2 rounded-lg border border-blue-400 px-3 py-2 text-xs font-semibold text-blue-700"
              onClick={() => setHoldDuration(1440)}>24 ชั่วโมง / 24 hours</button>
          </label>
          <label>Payment cutoff (device timezone)<input className={field} name="cutoff" type="datetime-local" defaultValue={localDateInput(settings?.cutoff_ms ?? null)} /></label>
        </div>
        {categories.map((category) => <fieldset key={category.id} className="grid gap-3 rounded-lg border border-slate-200 p-3 sm:grid-cols-3">
          <legend className="px-1">Category · {category.id}</legend>
          <label>Label<input className={field} required maxLength={180} value={category.label} onChange={(event) => update(category.id, { label: event.target.value })} /></label>
          <label>Price (THB, 0 = Free)<input className={field} required inputMode="decimal" value={category.price} onChange={(event) => update(category.id, { price: event.target.value })} /></label>
          <label>Quota (optional)<input className={field} type="number" min={1} step={1} value={category.quota} onChange={(event) => update(category.id, { quota: event.target.value })} /></label>
          {categories.length > 1 && <button type="button" className="justify-self-start text-blue-700 underline"
            onClick={() => setCategories((current) => current.filter((item) => item.id !== category.id))}>Remove category</button>}
        </fieldset>)}
        {categories.length < 100 && <button type="button" className="text-blue-700 underline"
          onClick={() => setCategories((current) => [...current, { id: crypto.randomUUID(), label: "", price: "", quota: "" }])}>Add category</button>}
        <fieldset className="space-y-2 rounded-lg border border-slate-200 p-3">
          <legend className="px-1">Seminar questions</legend>
          {(Object.keys(paidSeminarFields) as PaidSeminarKey[]).map((key) => {
            const configured = seminar.find((item) => item.key === key);
            return <div key={key} className="grid items-end gap-2 sm:grid-cols-[minmax(10rem,1fr)_1fr]">
              <label>{paidSeminarFields[key].label}
                <select className={field} value={configured?.scope ?? ""} onChange={(event) => {
                  const scope = event.target.value;
                  setSeminar((current) => {
                    const rest = current.filter((item) => item.key !== key);
                    return scope === "booking" || scope === "attendee" ? [...rest, { key, scope, required: configured?.required ?? false }] : rest;
                  });
                }}>
                  <option value="">Hidden</option><option value="booking">Once per booking</option><option value="attendee">For each attendee</option>
                </select>
              </label>
              {configured && <label className="flex gap-2 pb-2">
                <input type="checkbox" checked={configured.required} onChange={(event) => {
                  const required = event.target.checked;
                  setSeminar((current) => current.map((item) => item.key === key ? { ...item, required } : item));
                }} />
                Require {paidSeminarFields[key].label.toLowerCase()}
              </label>}
            </div>;
          })}
        </fieldset>
        <div className="flex flex-wrap gap-2 border-t pt-4">
          <button type="submit" name="action" value="publish" className="rounded-xl bg-blue-700 px-5 py-3 text-base font-bold text-white disabled:opacity-50">
            {busy ? "กำลังบันทึก…" : "บันทึกและเปิดรับสมัคร"}
          </button>
          <button type="submit" name="action" value="draft" className="rounded-xl border px-4 py-3 font-semibold">
            บันทึกแบบร่าง
          </button>
        </div>
      </fieldset>
      {error && <p role="alert" className="text-red-700">{error}</p>}
    </form>
  );
}

export function PaidRegistrationSettings({ eventId, apiFetch }: { eventId: string; apiFetch: ApiFetch }) {
  const [open, setOpen] = useState(false);
  const [settings, setSettings] = useState<Settings | null>();
  const [error, setError] = useState(false);
  const [saved, setSaved] = useState(false);
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [readinessError, setReadinessError] = useState("");
  const [publishing, setPublishing] = useState(false);
  const fetchRef = useRef(apiFetch);
  fetchRef.current = apiFetch;
  const path = `/api/events/${encodeURIComponent(eventId)}/paid-registration/settings`;
  async function loadReadiness() {
    try {
      const res = await fetchRef.current("/api/events/" + encodeURIComponent(eventId) + "/paid-registration/readiness");
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Readiness check failed");
      setReadiness(data as Readiness);
      setReadinessError("");
    } catch (err) {
      setReadinessError(err instanceof Error ? err.message : "Readiness check failed");
    }
  }
  async function publishNow() {
    if (!settings || publishing) return;
    setPublishing(true);
    setReadinessError("");
    try {
      const response = await fetchRef.current(path, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          version: settings.version, capacity: settings.capacity, hold_minutes: settings.hold_minutes,
          cutoff_ms: settings.cutoff_ms, published: true, categories: settings.categories,
          fields: settings.fields, payment_mode: settings.payment_mode,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Could not publish paid booking");
      setSettings(data.settings);
      setSaved(true);
      await loadReadiness();
    } catch (err) {
      setReadinessError(err instanceof Error ? err.message : "Could not publish");
      await loadReadiness();
    } finally {
      setPublishing(false);
    }
  }
  useEffect(() => {
    if (!open) return;
    const request = new AbortController();
    setSettings(undefined);
    setError(false);
    setSaved(false);
    void fetchRef.current(path, { signal: request.signal }).then(async (response) => {
      if (!response.ok) throw new Error();
      const result = await response.json();
      if (!request.signal.aborted) {
        setSettings(result.settings);
        void loadReadiness();
      }
    }).catch(() => { if (!request.signal.aborted) setError(true); });
    return () => request.abort();
  }, [open, path]);

  return (
    <section className="paid-admin-settings space-y-3 rounded-2xl border p-4 text-sm">
      <button type="button" aria-expanded={open} className="font-semibold text-blue-700 underline" onClick={() => setOpen(!open)}>Paid registration settings</button>
      {open && (error ? <p role="alert">Could not load paid registration settings.</p> :
        settings === undefined ? <p role="status">Loading settings…</p> :
          <SettingsForm key={settings?.version ?? 0} settings={settings} path={path} eventId={eventId} apiFetch={apiFetch}
            onSaved={(result) => { setSettings(result); setSaved(true); void loadReadiness(); }} />)}
      {open && readiness && (
        <section className={"paid-admin-readiness rounded-xl border-2 p-3 " + (readiness.paid_ready && readiness.checks.customer_signup_enabled
          ? "paid-admin-readiness-ready" : "paid-admin-readiness-warning")}>
          <h3 className="font-bold">{readiness.paid_ready && readiness.checks.customer_signup_enabled
            ? "หน้า Event พร้อมรับสมัครบัญชีและจองที่นั่ง" : "สิ่งที่ต้องเปิดก่อนให้ผู้เข้าร่วมสมัครบัญชีและลงทะเบียน"}</h3>
          {(!readiness.checks.customer_accounts_enabled || !readiness.checks.customer_signup_enabled ||
            !readiness.checks.paid_server_enabled) && <div className="mt-2 space-y-2 text-sm">
            <p>ตั้งค่าที่ <strong>Railway → FaceBotStudio Service → Variables</strong> (ไม่ใช่ Organizer Settings):</p>
            <pre className="paid-admin-env overflow-x-auto rounded-lg p-2 text-xs">{"CUSTOMER_APP_ENABLED=1\nCUSTOMER_ACCOUNT_REGISTRATION_ENABLED=1\nPAID_REGISTRATION_PUBLIC_ENABLED=1"}</pre>
            <p>กด Deploy หลังแก้ค่า แล้วกลับมากด Recheck ที่นี่</p>
          </div>}
          {readiness.payment_mode === "external_manual" && readiness.proof_upload_ready === false &&
            <p className="paid-admin-problem mt-2">
              รับสลิปยังไม่ได้: ตั้งค่า Railway PAID_PROOF_ENCRYPTION_KEY (64 hex) แล้ว Deploy /
              Slip upload needs PAID_PROOF_ENCRYPTION_KEY.
            </p>}
          {!readiness.checks.event_active && <p className="paid-admin-problem mt-2">กรุณาตั้งสถานะ Event เป็น Active ใน Event Setup</p>}
          {!readiness.checks.event_web_page && <p className="paid-admin-problem mt-2">กรุณาเปิด Event Web Page ใน Public Page Builder</p>}
          {!readiness.checks.paid_published && <p className="paid-admin-problem mt-2">ยังไม่ได้ Publish Paid Registration — กด “บันทึกและเปิดรับสมัคร” ในฟอร์มด้านบน</p>}
          <div className="mt-3 flex flex-wrap gap-3">
            <a href="/account/register" target="_blank" rel="noopener noreferrer" className="paid-admin-link font-semibold underline">
              ทดลองหน้าสมัครบัญชี
            </a>
            <a href="/account/login" target="_blank" rel="noopener noreferrer" className="paid-admin-link font-semibold underline">
              ทดลองหน้าเข้าสู่ระบบ
            </a>
            <button type="button" className="paid-admin-link font-semibold underline" onClick={() => void loadReadiness()}>Recheck</button>
          </div>
        </section>
      )}
      {open && settings !== undefined && <details className="paid-admin-diagnostics space-y-2 rounded-xl border p-3">
        <summary className="cursor-pointer font-semibold">ตรวจสอบปัญหาการเปิดรับสมัคร / Help Bot (เฉพาะเมื่อมีปัญหา)</summary>
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-semibold">Event activation checks — registration + Help Bot</h3>
          <button type="button" className="paid-admin-link underline" onClick={() => void loadReadiness()}>Recheck</button>
        </div>
        {readiness && <>
          {readiness.payment_mode === "promptpay" && !readiness.checks.organizer_receiver_ready &&
            <p className="paid-admin-promptpay-warning rounded-lg p-2 font-semibold">
              โหมดปัจจุบันคือ PromptPay — การอัปโหลด QR ไม่ได้เปลี่ยนโหมดรับเงินให้อัตโนมัติ
              ถ้ามีแค่รูป QR หรือเลขบัญชี ให้เลือก External payment / Admin verifies manually ในฟอร์มด้านบน
              แล้วกด “บันทึกและเปิดรับสมัคร”
            </p>}
          <p className="font-semibold">Payment mode: {readiness.payment_mode === "external_manual" ? "External / manual verification" : "PromptPay"}<span className="block" />
            {readiness.paid_ready ? "Paid booking ready" : "Paid booking blocked"}
            {" · "}{readiness.bot_ready ? "Help Bot session ready" : "Help Bot session blocked"}</p>
          <div className="grid gap-1">
            {Object.entries(readiness.checks).map(([key, ok]) =>
              <p key={key} className={ok ? "paid-admin-check-ok" : "paid-admin-check-bad font-medium"}>
                {ok ? "✓" : "✕"} {readiness.payment_mode === "external_manual" &&
                  (key === "organizer_receiver_ready" || key === "slip_encryption_ready")
                    ? "Not required for external/manual publishing" : readinessLabels[key] || key}
              </p>)}
          </div>
          {!readiness.checks.paid_published && Object.entries(readiness.checks).every(([key, ok]) =>
            ok || key === "paid_published" || key === "customer_signup_enabled" ||
            key === "event_chat_enabled" || key === "chat_session_secret") && (
            <button type="button" disabled={publishing} onClick={() => void publishNow()}
              className="rounded-lg bg-blue-700 px-3 py-2 font-semibold text-white disabled:opacity-50">
              {publishing ? "Opening…" : "Publish paid registration now"}
            </button>
          )}
          {!readiness.checks.customer_signup_enabled && <p className="paid-admin-warning-text text-xs">
            Existing verified customer accounts can book; enable CUSTOMER_ACCOUNT_REGISTRATION_ENABLED=1 for new attendees.
          </p>}
        </>}
        {readinessError && <p role="alert" className="paid-admin-problem">{readinessError}</p>}
      </details>}
      {open && saved && <p role="status">Settings saved.</p>}
    </section>
  );
}

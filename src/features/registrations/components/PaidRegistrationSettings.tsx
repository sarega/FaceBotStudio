import { RegistrationSectionHeader } from "./RegistrationSectionHeader";
import { PaidPaymentDisplaySettings, type PaidPaymentDisplayHandle } from "./PaidPaymentDisplaySettings";
import { paidSeminarFields, foodPreferencePresets, transportPreferencePresets, parsePaidSeminarFields, type PaidSeminarField, type PaidSeminarKey } from "../../../../backend/paidSeminarFields";
import { useEffect, useRef, useState, type FormEvent } from "react";

type Category = { id: string; label: string; price: string; discount: string; quota: string };
type Settings = {
  version: number;
  capacity: number;
  hold_minutes: number;
  cutoff_ms: number | null;
  deadline_mode?: "relative" | "fixed";
  published: 0 | 1;
  payment_mode: "promptpay" | "external_manual";
  fields: PaidSeminarField[];
  categories: { id: string; label: string; unit_minor: number; accommodation_discount_minor?: number; quota: number | null }[];
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

const seminarLabelsTh: Record<PaidSeminarKey, string> = {
  arrival: "วันที่เดินทางมาถึง", departure: "วันที่เดินทางกลับ",
  accommodation: "ต้องการที่พัก", room_preference: "ประเภทห้องที่ต้องการ",
  transport: "การเดินทาง", food: "อาหารที่ต้องการ", notes: "หมายเหตุเพิ่มเติม",
};

const field = "mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2";

function localDateInput(ms: number | null) {
  if (ms == null) return "";
  return new Date(ms + 7 * 60 * 60_000).toISOString().slice(0, 16);
}

function SettingsForm({ language, settings, path, eventId, apiFetch, onSaved }: {
  language: "th" | "en"; settings: Settings | null; path: string; eventId: string; apiFetch: ApiFetch; onSaved: (result: Settings) => void;
}) {
  const t = (th: string, en: string) => language === "th" ? th : en;
  const [categories, setCategories] = useState<Category[]>(settings?.categories.map((category) => ({
    id: category.id, label: category.label, price: (category.unit_minor / 100).toFixed(2),
    discount: ((category.accommodation_discount_minor ?? 0) / 100).toFixed(2),
    quota: category.quota == null ? "" : String(category.quota),
  })) ?? [{ id: "general", label: "", price: "", discount: "0", quota: "" }]);
  const [seminar, setSeminar] = useState(settings?.fields ?? []);
  const [paymentMode, setPaymentMode] = useState(settings?.payment_mode === "external_manual" ? "external_manual" : "promptpay");
  const [deadlineMode, setDeadlineMode] = useState(settings?.deadline_mode ?? "relative");
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
    const parsedCategories = categories.map(({ id, label, price, discount, quota }) => {
      const amount = /^(\d+)(?:\.(\d{1,2}))?$/.exec(price.trim());
      const deduction = /^(\d+)(?:\.(\d{1,2}))?$/.exec(discount.trim());
      return {
        id, label, unit_minor: amount ? Number(amount[1]) * 100 + Number((amount[2] ?? "").padEnd(2, "0")) : 0,
        accommodation_discount_minor: deduction ? Number(deduction[1]) * 100 + Number((deduction[2] ?? "").padEnd(2, "0")) : -1,
        quota: quota ? Number(quota) : null,
      };
    });
    if (parsedCategories.some(({ unit_minor, accommodation_discount_minor }) =>
      !Number.isSafeInteger(unit_minor) || unit_minor < 0 ||
      !Number.isSafeInteger(accommodation_discount_minor) || accommodation_discount_minor < 0 ||
      accommodation_discount_minor > unit_minor)) {
      setError("The no-accommodation discount must be between 0 and the category price.");
      return;
    }
    if (parsedCategories.some((category) => category.accommodation_discount_minor > 0) &&
        !seminar.some((field) => field.key === "accommodation" && field.scope === "attendee" && field.required)) {
      setError("Enable 'Accommodation needed' → 'For each attendee' and 'Require' when using discounts.");
      return;
    }
    const normalizedSeminar = parsePaidSeminarFields(seminar);
    if (!normalizedSeminar) {
      setError("Check Seminar questions: dropdown choices need 2–20 unique names, the default must match a choice, and a room surcharge requires a positive amount and a required per-attendee question.");
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
          hold_minutes: holdDuration, deadline_mode: deadlineMode, cutoff_ms: cutoff ? Date.parse(cutoff + "+07:00") : null,
          published: publish, payment_mode: paymentMode, categories: parsedCategories, fields: normalizedSeminar,
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
          invalid_pricing_config: "Set Accommodation needed → For each attendee + Required to enable these discounts.",
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
  function updateSeminar(key: PaidSeminarKey, patch: Partial<PaidSeminarField>) {
    setSeminar((current) => current.map((item) =>
      item.key === key ? {...item,...patch} : item));
  }
  function update(id: string, patch: Partial<Category>) {
    setCategories((current) => current.map((category) => category.id === id ? { ...category, ...patch } : category));
  }

  return (
    <form onSubmit={save} className="space-y-3">
      <h3 className="font-bold">{t("ตั้งค่าและเปิดรับสมัครได้ในหน้านี้", "Configure and publish registration here")}</h3>
      {settings?.published === 1 && <p role="status" className="rounded-lg border border-green-300 p-2 font-semibold text-green-800">{t("เปิดรับสมัครแล้ว", "Registration published")}</p>}
      <fieldset disabled={busy} className="space-y-3">
        <fieldset className="rounded-xl border-2 border-blue-200 p-3">
          <legend className="px-2 font-bold">{t("วิธีรับเงิน", "Payment method")}</legend>
          <label className="mt-2 flex cursor-pointer items-start gap-3 rounded-lg border bg-white p-3">
            <input type="radio" className="mt-1" checked={paymentMode === "external_manual"}
              onChange={() => setPaymentMode("external_manual")} />
            <span><strong>{t("รับเงินภายนอกและตรวจสอบด้วยตนเอง", "External payment with manual review")}</strong>
            <span className="block text-xs text-slate-600">{t("รับชำระภายนอกและยืนยันใบจองหลังตรวจสอบยอด ระบบออก QR เข้างานหลังยืนยัน", "Accept payment externally and confirm bookings after review. The admission QR is issued after confirmation.")}</span></span>
          </label>
          <label className="mt-2 flex cursor-pointer items-start gap-3 rounded-lg border bg-white p-3">
            <input type="radio" className="mt-1" checked={paymentMode === "promptpay"}
              onChange={() => setPaymentMode("promptpay")} />
            <span><strong>{t("พร้อมเพย์และสลิป", "PromptPay and payment proof")}</strong>
            <span className="block text-xs text-slate-600">{t("ต้องตั้งค่าบัญชีรับเงินของผู้จัดและพื้นที่จัดเก็บสลิป", "Requires an organizer receiving account and secure proof storage.")}</span></span>
          </label>
        </fieldset>
        {paymentMode === "external_manual" && <PaidPaymentDisplaySettings ref={displayRef} eventId={eventId} apiFetch={apiFetch} />}
        <h3 className="font-bold">{t("จำนวนที่รับและราคา", "Capacity and pricing")}</h3>
        <div className="grid gap-3 sm:grid-cols-3">
          <label>{t("จำนวนที่รับ", "Capacity")}<input className={field} name="capacity" type="number" min={1} step={1} required defaultValue={settings?.capacity} /></label>
          <fieldset className="space-y-2 sm:col-span-2">
            <label>{t("กำหนดเวลาชำระ", "Payment deadline")}
              <select className={field} value={deadlineMode}
                onChange={(event) => setDeadlineMode(event.target.value === "fixed" ? "fixed" : "relative")}>
                <option value="relative">{t("นับจากเวลาจอง", "Time after booking")}</option>
                <option value="fixed">{t("วันและเวลาที่กำหนด", "Fixed date and time")}</option>
              </select>
            </label>
            {deadlineMode === "relative" && <>
              <label>{t("เวลาชำระหลังจอง (นาที)", "Payment window (minutes)")}<input className={field} type="number" min={1} max={43200}
                step={1} required value={holdDuration} onChange={(event) => setHoldDuration(Number(event.target.value))} /></label>
              <div className="flex flex-wrap gap-2">
                {[[30, t("30 นาที", "30 minutes")], [1440, t("24 ชั่วโมง", "24 hours")], [10080, t("7 วัน", "7 days")]].map(([minutes, label]) => (
                  <button key={minutes} type="button" aria-pressed={holdDuration === minutes}
                    className="rounded-lg border border-blue-400 px-3 py-2 text-xs font-semibold text-blue-700"
                    onClick={() => setHoldDuration(Number(minutes))}>{label}</button>
                ))}
              </div>
            </>}
            <label>{deadlineMode === "fixed" ? t("เส้นตายชำระของทุกใบจองใหม่", "Deadline for all new bookings") : t("เส้นตายสูงสุด (ถ้ามี)", "Latest payment deadline (optional)")} · {t("เวลาไทย (UTC+7)", "Thailand time (UTC+7)")}
              <input className={field} name="cutoff" type="datetime-local" required={deadlineMode === "fixed"}
                defaultValue={localDateInput(settings?.cutoff_ms ?? null)} />
            </label>
            <p className="text-xs text-slate-600">{t("ใช้กับใบจองใหม่ ส่วนใบจองเดิมใช้กำหนดชำระที่บันทึกไว้", "New bookings use this setting. Existing bookings keep their saved deadline.")}</p>
          </fieldset>
        </div>
        {categories.map((category) => <fieldset key={category.id} className="grid gap-3 rounded-lg border border-slate-200 p-3 sm:grid-cols-2">
          <legend className="px-1">{t("ประเภท · ", "Category · ")}{category.id}</legend>
          <label>{t("ชื่อประเภท", "Category name")}<input className={field} required maxLength={180} value={category.label} onChange={(event) => update(category.id, { label: event.target.value })} /></label>
          <label>{t("ราคา (บาท, 0 = ฟรี)", "Price (THB, 0 = Free)")}<input className={field} required inputMode="decimal" value={category.price} onChange={(event) => update(category.id, { price: event.target.value })} /></label>
          <label>{t("ส่วนลดเมื่อไม่พัก (บาท)", "Discount if no accommodation (THB)")}
            <input className={field} required inputMode="decimal" value={category.discount}
              onChange={(event) => {
                const amount = event.target.value;
                update(category.id, { discount: amount });
                if (Number(amount) > 0) {
                  setSeminar((current) => [
                    ...current.filter((item) => item.key !== "accommodation"),
                    { ...(current.find((item) => item.key === "accommodation") ?? {}),
                      key: "accommodation", scope: "attendee", required: true },
                  ]);
                }
              }} />
            <span className="block text-xs text-slate-500">{t("หักต่อผู้เข้าร่วมที่เลือกไม่พัก ใส่ 0 หากไม่มีส่วนลด", "Deducted per attendee who selects No. Enter 0 to disable.")}</span>
          </label>
          <label>{t("โควตา (ไม่บังคับ)", "Quota (optional)")}<input className={field} type="number" min={1} step={1} value={category.quota} onChange={(event) => update(category.id, { quota: event.target.value })} /></label>
          {categories.length > 1 && <button type="button" className="justify-self-start text-blue-700 underline"
            onClick={() => setCategories((current) => current.filter((item) => item.id !== category.id))}>{t("ลบประเภท", "Remove category")}</button>}
        </fieldset>)}
        {categories.length < 100 && <button type="button" className="text-blue-700 underline"
          onClick={() => setCategories((current) => [...current, { id: crypto.randomUUID(), label: "", price: "", discount: "0", quota: "" }])}>{t("เพิ่มประเภท", "Add category")}</button>}
        <p className="rounded-lg border border-blue-200 bg-blue-50 p-2 text-xs text-blue-900">
          {t("ส่วนลดสำหรับผู้ไม่พักจะเปิดคำถามเรื่องที่พักแบบบังคับต่อผู้เข้าร่วม และใช้คำตอบคำนวณยอดในใบแจ้งชำระ", "A no-accommodation discount makes the accommodation question required for each attendee. Their answer determines the invoice amount.")}
        </p>
        <fieldset className="space-y-2 rounded-lg border border-slate-200 p-3 text-slate-900">
          <legend className="px-1">{t("คำถามสำหรับผู้สมัคร", "Seminar questions")}</legend>
          {(Object.keys(paidSeminarFields) as PaidSeminarKey[]).map((key) => {
            const configured = seminar.find((item) => item.key === key);
            return <div key={key} className="grid items-end gap-2 sm:grid-cols-[minmax(10rem,1fr)_1fr]">
              <label>{t(seminarLabelsTh[key], paidSeminarFields[key].label)}
                <select className={field} value={configured?.scope ?? ""} onChange={(event) => {
                  const scope = event.target.value;
                  setSeminar((current) => {
                    const rest = current.filter((item) => item.key !== key);
                    return scope === "booking" || scope === "attendee"
                      ? [...rest, { ...configured, key, scope, required: configured?.required ?? false }] : rest;
                  });
                }}>
                  <option value="">{t("ซ่อน", "Hidden")}</option><option value="booking">{t("ถามครั้งเดียวต่อใบจอง", "Once per booking")}</option><option value="attendee">{t("ถามผู้เข้าร่วมแต่ละคน", "For each attendee")}</option>
                </select>
              </label>
              {configured && <div className="space-y-2 rounded-lg bg-slate-50 p-2">
                <label className="flex gap-2">
                  <input type="checkbox" checked={configured.required} onChange={(event) =>
                    updateSeminar(key,{required:event.target.checked})} />
                  {t("บังคับตอบ", "Required")}
                </label>
                {(key === "food" || key === "transport" || key === "room_preference") && <div className="space-y-2">
                  <label className="block text-xs font-medium">{t("รูปแบบคำตอบ", "Answer format")}
                    <select className={field} value={configured.options ? "select" : "text"}
                      onChange={(event) => updateSeminar(key,event.target.value==="select"
                        ? {options:[...(key === "food" ? foodPreferencePresets : key === "transport" ? transportPreferencePresets : ["ห้องคู่ / Shared room", "ห้องเดี่ยว / Single room"])],defaultValue:undefined}
                        : {options:undefined,defaultValue:undefined,surcharge:undefined})}>
                      <option value="text">{t("พิมพ์คำตอบเอง", "Free text")}</option>
                      <option value="select">{t("เลือกจากรายการ", "Dropdown choices")}</option>
                    </select>
                  </label>
                  {key === "transport" && configured.options && <button type="button" className="registration-admin-control"
                    onClick={() => updateSeminar(key,{ options: [...transportPreferencePresets], defaultValue: undefined })}>
                    {t("ใช้ 3 ตัวเลือกสำหรับจัดรถ", "Use the three carpool choices")}
                  </button>}
                  {configured.options && <label className="block text-xs font-medium">
                    {t("ตัวเลือก (บรรทัดละหนึ่งข้อ 2–20 ข้อ ห้ามซ้ำ)", "Choices (one per line, 2–20 unique values)")}
                    <textarea className={field} rows={3} value={configured.options.join("\n")}
                      onChange={(event) => updateSeminar(key,{
                        options:event.target.value.split("\n"),
                        surcharge:undefined,
                        defaultValue:undefined,
                      })}/>
                  </label>}
                </div>}
                {key === "room_preference" && configured.options && <div className="grid gap-2 sm:grid-cols-2">
                  <label>{t("ตัวเลือกที่คิดเพิ่ม", "Room choice with a surcharge")}
                    <select className={field} value={configured.surcharge?.option ?? ""} onChange={(event) => {
                      const option = event.target.value;
                      updateSeminar(key, option ? { scope: "attendee", required: true,
                        surcharge: { option, minor: configured.surcharge?.minor ?? 0 } } : { surcharge: undefined });
                    }}>
                      <option value="">{t("ไม่มีส่วนเพิ่ม", "No surcharge")}</option>
                      {configured.options.map((option, index) => option.trim() &&
                        <option key={index} value={option.trim()}>{option.trim()}</option>)}
                    </select>
                  </label>
                  {configured.surcharge && <label>{t("ส่วนเพิ่มต่อคน (บาท)", "Surcharge per person (THB)")}
                    <input className={field} type="number" min="0.01" max="21474836.47" step="0.01" required
                      value={configured.surcharge.minor ? configured.surcharge.minor / 100 : ""}
                      onChange={(event) => updateSeminar(key, { surcharge: { option: configured.surcharge!.option,
                        minor: Math.round(Number(event.target.value) * 100) } })} />
                  </label>}
                </div>}
                {paidSeminarFields[key].type === "boolean" || configured.options ?
                  <label className="block text-xs font-medium">{t("คำตอบเริ่มต้น", "Default answer")}
                    <select className={field} value={configured.defaultValue ?? ""}
                      onChange={(event) => updateSeminar(key,
                        {defaultValue:event.target.value||undefined})}>
                      <option value="">{t("ให้ผู้สมัครเลือกเอง", "No default — customer chooses")}</option>
                      {(paidSeminarFields[key].type==="boolean"
                        ? [{value:"yes",label:t("ใช่", "Yes")},{value:"no",label:t("ไม่", "No")}]
                        : (configured.options??[]).filter(Boolean).map((option) =>
                          ({value:option,label:option}))).map((option) =>
                        <option key={option.value} value={option.value}>{option.label}</option>)}
                    </select>
                  </label>
                  : <label className="block text-xs font-medium">{t("คำตอบเริ่มต้น (ไม่บังคับ)", "Default answer (optional)")}
                    <input className={field} type={paidSeminarFields[key].type === "date" ? "date" : "text"}
                      maxLength={500} value={configured.defaultValue ?? ""}
                      placeholder={t("เว้นว่างหากไม่มีคำตอบเริ่มต้น", "Leave blank for no default")}
                      onChange={(event) => updateSeminar(key,{defaultValue:event.target.value||undefined})}/>
                  </label>}
              </div>}
            </div>;
          })}
        </fieldset>
        <div className="flex flex-wrap gap-1.5 border-t pt-2">
          <button type="submit" name="action" value="publish" className="registration-admin-control registration-admin-control-primary">
            {busy ? t("กำลังบันทึก…", "Saving…") : t("บันทึกและเปิดรับสมัคร", "Save and publish")}
          </button>
          <button type="submit" name="action" value="draft" className="registration-admin-control">
            {t("บันทึกแบบร่าง", "Save draft")}
          </button>
        </div>
      </fieldset>
      {error && <p role="alert" className="text-red-700">{error}</p>}
    </form>
  );
}

export function PaidRegistrationSettings({ language, eventId, apiFetch }: { language: "th" | "en"; eventId: string; apiFetch: ApiFetch }) {
  const t = (th: string, en: string) => language === "th" ? th : en;
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
          cutoff_ms: settings.cutoff_ms, deadline_mode: settings.deadline_mode, published: true, categories: settings.categories,
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
    <section className="paid-admin-settings registration-admin-section registration-admin-settings">
      <RegistrationSectionHeader tone="settings" title={t("ตั้งค่าลงทะเบียน", "Registration Settings")}
        subtitle={t("ราคาและการชำระเงิน", "Pricing and payment")} open={open} onToggle={() => setOpen(!open)} />
      {open && <div className="registration-section-content">
      {(error ? <p role="alert">{t("โหลดการตั้งค่าลงทะเบียนไม่สำเร็จ", "Could not load paid registration settings.")}</p> :
        settings === undefined ? <p role="status">{t("กำลังโหลดการตั้งค่า…", "Loading settings…")}</p> :
          <SettingsForm language={language} key={settings?.version ?? 0} settings={settings} path={path} eventId={eventId} apiFetch={apiFetch}
            onSaved={(result) => { setSettings(result); setSaved(true); void loadReadiness(); }} />)}
      {open && readiness && (
        <section className={"paid-admin-readiness rounded-xl border-2 p-3 " + (readiness.paid_ready && readiness.checks.customer_signup_enabled
          ? "paid-admin-readiness-ready" : "paid-admin-readiness-warning")}>
          <h3 className="font-bold">{readiness.paid_ready && readiness.checks.customer_signup_enabled
            ? t("หน้า Event พร้อมรับสมัครบัญชีและจองที่นั่ง", "Event page is ready for sign-ups and bookings") : t("สิ่งที่ต้องเปิดก่อนให้ผู้เข้าร่วมสมัครบัญชีและลงทะเบียน", "Complete these settings to enable sign-ups and bookings")}</h3>
          {(!readiness.checks.customer_accounts_enabled || !readiness.checks.customer_signup_enabled ||
            !readiness.checks.paid_server_enabled) && <div className="mt-2 space-y-2 text-sm">
            <p>{t("ตั้งค่าตัวแปรที่", "Set the variables in")} <strong>Railway → FaceBotStudio Service → Variables</strong></p>
            <pre className="paid-admin-env overflow-x-auto rounded-lg p-2 text-xs">{"CUSTOMER_APP_ENABLED=1\nCUSTOMER_ACCOUNT_REGISTRATION_ENABLED=1\nPAID_REGISTRATION_PUBLIC_ENABLED=1"}</pre>
            <p>{t("กด Deploy หลังแก้ค่า แล้วกลับมากด Recheck ที่นี่", "Deploy the changes, then run the checks again.")}</p>
          </div>}
          {readiness.payment_mode === "external_manual" && readiness.proof_upload_ready === false &&
            <p className="paid-admin-problem mt-2">
              {t("ตั้งค่า PAID_PROOF_ENCRYPTION_KEY ใน Railway แล้ว Deploy เพื่อเปิดรับสลิป", "Set PAID_PROOF_ENCRYPTION_KEY in Railway and deploy to enable slip uploads.")}
            </p>}
          {!readiness.checks.event_active && <p className="paid-admin-problem mt-2">{t("กรุณาตั้งสถานะ Event เป็น Active ใน Event Setup", "Set the event status to Active in Event Setup.")}</p>}
          {!readiness.checks.event_web_page && <p className="paid-admin-problem mt-2">{t("กรุณาเปิด Event Web Page ใน Public Page Builder", "Enable the public event page in Public Page Builder.")}</p>}
          {!readiness.checks.paid_published && <p className="paid-admin-problem mt-2">{t("ยังไม่ได้ Publish Paid Registration — กด “บันทึกและเปิดรับสมัคร” ในฟอร์มด้านบน", "Use Save and publish above to open registration.")}</p>}
          <div className="mt-3 flex flex-wrap gap-3">
            <a href="/account/register" target="_blank" rel="noopener noreferrer" className="paid-admin-link font-semibold underline">
              {t("ทดลองหน้าสมัครบัญชี", "Test sign-up page")}
            </a>
            <a href="/account/login" target="_blank" rel="noopener noreferrer" className="paid-admin-link font-semibold underline">
              {t("ทดลองหน้าเข้าสู่ระบบ", "Test sign-in page")}
            </a>
            <button type="button" className="paid-admin-link font-semibold underline" onClick={() => void loadReadiness()}>{t("ตรวจอีกครั้ง", "Recheck")}</button>
          </div>
        </section>
      )}
      {open && settings !== undefined && <details className="paid-admin-diagnostics space-y-2 rounded-xl border p-3">
        <summary className="cursor-pointer font-semibold">{t("ตรวจสอบปัญหาการเปิดรับสมัคร / Help Bot (เฉพาะเมื่อมีปัญหา)", "Registration and Help Bot diagnostics")}</summary>
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-semibold">{t("ตรวจความพร้อมของการลงทะเบียนและบอตช่วยเหลือ", "Event activation checks — registration + Help Bot")}</h3>
          <button type="button" className="paid-admin-link underline" onClick={() => void loadReadiness()}>{t("ตรวจอีกครั้ง", "Recheck")}</button>
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
              {publishing ? t("กำลังเปิดรับสมัคร…", "Opening…") : t("เปิดรับสมัครตอนนี้", "Publish paid registration now")}
            </button>
          )}
          {!readiness.checks.customer_signup_enabled && <p className="paid-admin-warning-text text-xs">
            Existing verified customer accounts can book; enable CUSTOMER_ACCOUNT_REGISTRATION_ENABLED=1 for new attendees.
          </p>}
        </>}
        {readinessError && <p role="alert" className="paid-admin-problem">{readinessError}</p>}
      </details>}
      {open && saved && <p role="status">{t("บันทึกการตั้งค่าแล้ว", "Settings saved.")}</p>}
      </div>}
    </section>
  );
}

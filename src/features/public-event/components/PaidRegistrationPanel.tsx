import { PaymentCountdown } from "../../../components/PaymentCountdown";
import { roomSurchargeMinor, paidSeminarFields, seminarDefaultAnswers, type PaidSeminarField } from "../../../../backend/paidSeminarFields";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { customerApi, type CustomerAccount } from "../../customer-account/components/CustomerAccountScreen";

type Catalog = { payment_mode?: "promptpay" | "external_manual"; pricing_version: number; fields: PaidSeminarField[]; categories: { id: string; label: string; unit_minor: number; accommodation_discount_minor?: number }[] };
type Attendee = { category_id: string; first_name: string; last_name: string; answers?: Record<string, string> };
type Booking = { id: string; event_id: string; reference: string; status: string; total_due_minor: number; due_at: string };

const field = "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900";
const money = new Intl.NumberFormat("en-TH", { style: "currency", currency: "THB" });
/** Convert API failures into actionable coupon feedback instead of a generic red warning. */
export function couponErrorMessage(code: string, locale: "th" | "en"): string {
  const messages: Record<string, [string, string]> = {
    coupon_invalid: ["รหัสคูปองต้องมี 3–32 ตัว ใช้ A–Z, 0–9, - หรือ _ เท่านั้น", "Coupon code must be 3–32 characters, using A–Z, 0–9, hyphen or underscore."],
    coupon_unavailable: ["ไม่พบโค้ดที่ใช้ได้กับงานนี้ หรือคูปองถูกปิด/หมดอายุ กรุณาตรวจโค้ดใน Promotions ของงานนี้", "This code is not active for this event. Check its code, dates and Active status in this event's Promotions."],
    coupon_not_found: ["ไม่พบคูปองนี้ใน Event ที่กำลังลงทะเบียน กรุณาตรวจว่าเลือก Event เดียวกันในหน้า Admin", "Coupon not found for this event. Check that it was created under this same event in Admin."],
    coupon_disabled: ["คูปองนี้ถูกปิด Active ในหน้า Admin", "This coupon is disabled in Admin."],
    coupon_not_started: ["คูปองยังไม่ถึงเวลาเริ่มใช้งาน กรุณาตรวจ Start date ในหน้า Admin", "Coupon has not started yet. Check its Start date in Admin."],
    coupon_expired: ["คูปองหมดอายุแล้ว กรุณาตรวจ End date ในหน้า Admin", "Coupon expired. Check its End date in Admin."],
    coupon_exhausted: ["คูปองใช้ครบจำนวนแล้ว หรือบัญชีนี้ใช้ครบสิทธิ์แล้ว", "Coupon limit reached, or this account has used its allocation."],
    quote_stale: ["ราคาได้รับการปรับปรุง กรุณารีเฟรชหน้าแล้วใช้โค้ดอีกครั้ง", "Prices changed. Refresh this event page, then apply the code again."],
    invalid_attendees: ["ประเภทผู้เข้าร่วมไม่ถูกต้อง กรุณารีเฟรชหน้าลงทะเบียน", "An attendee category is no longer valid. Refresh this page."],
    invalid_seminar_answers: ["กรุณาเลือกความต้องการที่พักให้ครบก่อนใช้คูปอง", "Select accommodation Yes or No for each attendee before applying a coupon."],
    invalid_total: ["ยังไม่มียอดชำระที่ใช้คูปองได้ กรุณาตรวจประเภทผู้เข้าร่วม", "There is no eligible amount to discount. Check your attendee categories."],
    CUSTOMER_NOT_AUTHENTICATED: ["เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่ก่อนใช้คูปอง", "Your session expired. Sign in again to apply a coupon."],
    "Verified customer account required": ["กรุณายืนยันอีเมลในบัญชีก่อนใช้คูปอง", "Verify your account email before applying a coupon."],
    CUSTOMER_APP_DISABLED: ["ไม่สามารถตรวจคูปองได้ กรุณาตรวจว่าระบบลงทะเบียนเปิดอยู่", "Coupon service is unavailable for this event."],
    coupon_quote_failed: ["ระบบตรวจสอบคูปองขัดข้อง กรุณาลองใหม่หรือติดต่อผู้จัดงาน (coupon_quote_failed)", "Coupon verification failed on the server. Retry or contact the organizer (coupon_quote_failed)."],
    "CSRF validation failed": ["ระบบไม่ยอมรับแหล่งที่มาของคำขอ กรุณารีเฟรชหน้าและลองใหม่ (CSRF)", "Request origin was rejected. Refresh the page and retry (CSRF)."],
    "CSRF token validation failed": ["เซสชันความปลอดภัยไม่ตรงกัน กรุณารีเฟรชหน้าและลองใหม่ (CSRF)", "Security session mismatch. Refresh the page and retry (CSRF)."],
    "Request failed": ["ตรวจสอบคูปองไม่สำเร็จ กรุณาลองอีกครั้ง", "Could not verify the coupon. Please try again."],
  };
  const message=messages[code];
  if(message) return message[locale==="th"?0:1];
  return (locale==="th"
    ? "ตรวจสอบคูปองไม่สำเร็จ (รหัส: "+(code||"unknown")+") กรุณาติดต่อผู้จัดงาน"
    : "Coupon verification failed (code: "+(code||"unknown")+"). Please contact the organizer.");
}

const errors: Record<string, string> = {
  CUSTOMER_NOT_AUTHENTICATED: "Sign in with your customer account to book.",
  "Verified customer account required": "Verify your customer email before booking.",
  capacity_exhausted: "There is not enough capacity for this group.",
  coupon_unavailable: "Coupon unavailable or expired. Please choose another code.",
  coupon_exhausted: "Coupon redemption limit reached.",
  coupon_invalid: "Invalid coupon code.",

  quote_stale: "The registration form has changed. Refresh the page before booking.",
  invalid_seminar_answers: "Check the seminar answers and complete the required fields.",
  CUSTOMER_APP_DISABLED: "Registration is currently unavailable.",
};

function SeminarInputs({ fields, values, onChange, locale }: {
  fields: PaidSeminarField[]; values?: Record<string, string>; locale: "th" | "en";
  onChange: (key: string, value: string) => void;
}) {
  const thaiLabels: Record<string, string> = {
    arrival: "วันเดินทางมา", departure: "วันเดินทางกลับ", accommodation: "ต้องการที่พัก",
    room_preference: "ความต้องการห้องพัก", transport: "การเดินทาง", food: "อาหาร",
    notes: "หมายเหตุเพิ่มเติม",
  };
  return fields.map((configured) => {
    const { key, required } = configured;
    if (key === "room_preference" && configured.surcharge && values?.accommodation === "no") return null;
    const definition = paidSeminarFields[key];
    const value = values?.[key] ?? "";
    return <label key={key} className="block text-sm">
      {locale === "th" ? thaiLabels[key] : definition.label}{required ? " *" : ""}
      {definition.type === "boolean" ? (
        <select className={field} required={required} value={value} onChange={(event) => onChange(key, event.target.value)}>
          <option value="">{locale === "th" ? "เลือก" : "Select"}</option>
          <option value="yes">{locale === "th" ? "ใช่" : "Yes"}</option>
          <option value="no">{locale === "th" ? "ไม่" : "No"}</option>
        </select>
      ) : configured?.options ? (
        <select className={field} required={required} value={value}
          onChange={(event) => onChange(key,event.target.value)}>
          <option value="">{locale === "th" ? "เลือก" : "Select"}</option>
          {configured.options.map((option) => <option key={option} value={option}>{option}{configured.surcharge?.option === option && values?.accommodation !== "no" ? ` (+฿${(configured.surcharge.minor / 100).toLocaleString()})` : ""}</option>)}
        </select>
      ) : definition.type === "date" ? (
        <input className={field} type="date" required={required} value={value} onChange={(event) => onChange(key, event.target.value)} />
      ) : (
        <input className={field} maxLength={500} required={required} value={value} onChange={(event) => onChange(key, event.target.value)} />
      )}
    </label>;
  });
}

export function PaidRegistrationPanel({ slug, eventId, enabled, timezone, locale = "th" }: {
  slug: string; eventId: string; enabled: boolean; timezone: string; locale?: "th" | "en";
}) {
  const [catalog, setCatalog] = useState<Catalog>();
  const [customerAccount, setCustomerAccount] = useState<CustomerAccount | null>(null);
  const [accountLoading, setAccountLoading] = useState(true);
  const [contact, setContact] = useState("");
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [attendees, setAttendees] = useState<Attendee[]>([]);
  const [booking, setBooking] = useState<Booking>();
  const [couponCode,setCouponCode]=useState("");
  const [couponPreview,setCouponPreview]=useState<{
    code:string; subtotal_minor:number; discount_minor:number; total_minor:number; provisional?:boolean;
  }|null>(null);
  const [couponError,setCouponError]=useState("");
  const [couponBusy,setCouponBusy]=useState(false);
  const couponGeneration=useRef(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [messengerCode, setMessengerCode] = useState("");
  const [messengerMessage, setMessengerMessage] = useState("");
  const [messengerBusy, setMessengerBusy] = useState(false);
  const command = useRef<{ request: string; key: string } | undefined>(undefined);
  const prefix = `/api/public/events/${encodeURIComponent(slug)}`;
  const recoveryKey = `paid-booking:${slug}`;

  useEffect(() => {
    const controller = new AbortController();
    let generation = 0;
    async function refreshAccount() {
      const current = ++generation;
      setAccountLoading(true);
      try {
        const response = await customerApi<{account: CustomerAccount}>("/api/customer/account/me", {
          signal: controller.signal,
        });
        if (controller.signal.aborted || current !== generation) return;
        setCustomerAccount(response.account);
        setContact((old) => old || [response.account.first_name, response.account.last_name].filter(Boolean).join(" "));
      } catch {
        if (controller.signal.aborted || current !== generation) return;
        setCustomerAccount(null);
      } finally {
        if (!controller.signal.aborted && current === generation) setAccountLoading(false);
      }
    }
    void refreshAccount();
    const onFocus = () => { void refreshAccount(); };
    const onVisible = () => {
      if (document.visibilityState === "visible") void refreshAccount();
    };
    window.addEventListener("focus", onFocus);
    window.addEventListener("customer-session-changed", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      controller.abort();
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("customer-session-changed", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const saved = localStorage.getItem(recoveryKey);
    if (saved && /^[\w-]+\/[\w-]+$/.test(saved)) {
      void customerApi<Booking & { state?: string }>(`/api/customer/paid-bookings/${saved}`, { signal: controller.signal })
        .then((value) => {
          if (!controller.signal.aborted) setBooking({ ...value, status: value.state || value.status });
        }).catch(() => {
          if (!controller.signal.aborted) localStorage.removeItem(recoveryKey);
        });
    }
    if (enabled) {
      void customerApi<Catalog>(`${prefix}/paid-registration`, { signal: controller.signal }).then((data) => {
        setCatalog(data);
        setAnswers(seminarDefaultAnswers(data.fields,"booking"));
        if (data.categories[0]) setAttendees([{
          category_id: data.categories[0].id, first_name: "", last_name: "",
          answers:seminarDefaultAnswers(data.fields,"attendee"),
        }]);
      }).catch(() => { if (!controller.signal.aborted) setError("Registration is currently unavailable."); });
    }
    return () => controller.abort();
  }, [enabled, prefix, recoveryKey]);

  async function applyCouponPreview() {
    if(!catalog || couponBusy) return;
    const generation=++couponGeneration.current;
    setCouponBusy(true);setCouponError("");
    try {
      const response=await customerApi<{
        code:string;subtotal_minor:number;discount_minor:number;total_minor:number;provisional?:boolean;
      }>(prefix+"/paid-registration/coupon-preview",{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({coupon_code:couponCode.trim().toUpperCase(),pricing_version:catalog.pricing_version,attendees}),
      });
      if(generation===couponGeneration.current) setCouponPreview(response);
    } catch(e) {
      if(generation!==couponGeneration.current) return;
      setCouponPreview(null);
      const reason=e instanceof Error?e.message:"Request failed";
      setCouponError(couponErrorMessage(reason,locale));
    } finally {if(generation===couponGeneration.current) setCouponBusy(false);}
  }
  function invalidateCoupon() {couponGeneration.current++;setCouponBusy(false);setCouponPreview(null);setCouponError("");}
  function update(index: number, values: Partial<Attendee>) {
    invalidateCoupon();
    setAttendees((rows) => rows.map((row, rowIndex) => rowIndex === index ? { ...row, ...values } : row));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || !catalog) return;
    if (couponCode.trim() && !couponPreview) {
      setCouponError(locale === "th" ? "กรุณากดใช้โค้ดก่อนยืนยันการจอง" : "Click Apply to validate your coupon.");
      return;
    }
    if (total===0 && !couponPreview) {
      setError("รายการนี้ไม่มีค่าชำระ กรุณาลงทะเบียนพร้อมผู้ที่มีค่าสัมมนา / Add a paying attendee to this booking.");
      return;
    }
    setBusy(true);
    setError("");
    const request = JSON.stringify({ pricing_version: catalog.pricing_version, contact: { name: contact }, answers,
      attendees, coupon_code:couponPreview?.code });
    if (command.current?.request !== request) command.current = { request, key: crypto.randomUUID() };
    try {
      const result = await customerApi<Booking>(`${prefix}/paid-bookings`, {
        method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": command.current.key }, body: request,
      });
      setBooking(result);
      localStorage.setItem(recoveryKey, `${result.event_id}/${result.id}`);
      // The next step is the private payment invoice, not a bare booking reference.
      window.location.assign("/app/orders?paid_booking=" + encodeURIComponent(result.reference));
    } catch (failure) {
      const message = failure instanceof Error ? failure.message : "";
      setError(errors[message] || "The booking could not be completed. Retry to check the result.");
    } finally {
      setBusy(false);
    }
  }

  async function updateMessenger(method: "POST" | "DELETE") {
    setMessengerBusy(true);
    setMessengerCode("");
    setMessengerMessage("");
    try {
      const result = await customerApi<{ command?: string }>(
        `/api/customer/paid-bookings/${encodeURIComponent(eventId)}/messenger-link`, { method },
      );
      setMessengerCode(result.command || "");
      if (method === "DELETE") setMessengerMessage("Messenger disconnected for this event.");
    } catch (failure) {
      const message = failure instanceof Error ? failure.message : "";
      setMessengerMessage(errors[message] || "Messenger linking is unavailable.");
    } finally {
      setMessengerBusy(false);
    }
  }

  const attendeePrice = (row: Attendee) => {
    const category = catalog?.categories.find(({ id }) => id === row.category_id);
    if (!category) return 0;
    return category.unit_minor -
      (row.answers?.accommodation === "no" ? category.accommodation_discount_minor ?? 0 : 0) +
      roomSurchargeMinor(catalog?.fields ?? [], row.answers);
  };
  const total = attendees.reduce((sum, row) => sum + attendeePrice(row), 0);
  return (
    <div className="surface-panel space-y-2.5 rounded-2xl p-3 sm:p-3.5">
      <h2 className="text-base font-semibold">{locale === "th" ? "ลงทะเบียน" : "Registration"}</h2>
      {!accountLoading && !customerAccount && (
        <div className="paid-signup-card flex flex-wrap items-center gap-2 rounded-lg p-2 text-xs">
          <span>{locale === "th" ? "เข้าสู่ระบบเพื่อจอง" : "Sign in to book"}</span>
          <a className="paid-signup-primary rounded-md px-3 py-1.5 font-semibold" href="/account/login">
            {locale === "th" ? "เข้าสู่ระบบ" : "Sign in"}</a>
          <a className="paid-signup-secondary rounded-md px-3 py-1.5 font-semibold" href="/account/register">
            {locale === "th" ? "สมัคร" : "Register"}</a>
        </div>
      )}
      {customerAccount && !customerAccount.email_verified_at && (
        <div role="alert" className="paid-signup-note space-y-2 rounded-xl border border-amber-400 p-3">
          <strong className="block text-base">
            {locale === "th" ? "กรุณาเปิดอีเมลและกดลิงก์ยืนยันบัญชีก่อนจอง" :
              "Check your inbox and verify your email before booking"}
          </strong>
          <p className="break-all text-sm">{customerAccount.email}</p>
          <p className="text-sm">{locale === "th" ?
            "ตรวจ Inbox และ Spam หากไม่พบอีเมล ให้กดส่งลิงก์อีกครั้ง" :
            "Check Inbox and Spam. You can request a new verification email."}</p>
          <a href="/account" className="inline-flex min-h-10 items-center rounded-lg border border-current px-3 py-2 text-sm font-bold underline">
            {locale === "th" ? "ส่งอีเมลยืนยันอีกครั้ง / ไปที่บัญชี" : "Resend verification / My account"}
          </a>
        </div>
      )}
      {booking && (
        <details className={"public-booking-notice rounded-xl border px-3 py-2.5 text-xs " +
          (booking.status === "awaiting_payment" || booking.status === "expired"
            ? "public-booking-warning" : "public-booking-neutral")}>
          <summary className="flex cursor-pointer list-none items-center justify-between gap-2 font-semibold">
            <span className="flex min-w-0 items-center gap-2">
              <span aria-hidden="true" className={"h-2 w-2 shrink-0 rounded-full " +
                (booking.status === "awaiting_payment" || booking.status === "expired" ? "bg-amber-500" : "bg-emerald-500")} />
              <span>{booking.status === "awaiting_payment"
                ? (locale === "th" ? "มีรายการรอชำระเงิน" : "Payment pending")
                : booking.status === "expired"
                  ? (locale === "th" ? "รายการเดิมหมดเวลา" : "Previous booking expired")
                  : booking.status === "verification_pending"
                    ? (locale === "th" ? "รอตรวจสลิป" : "Slip under review")
                    : booking.status === "confirmed"
                      ? (locale === "th" ? "ยืนยันแล้ว" : "Confirmed")
                      : booking.status.replaceAll("_", " ")}</span>
            </span>
            <span className="shrink-0 text-xs font-normal">{locale === "th" ? "รายละเอียด ▾" : "Details ▾"}</span>
          </summary>
          <div className="mt-2 space-y-2 border-t border-current/15 pt-2">
            <p className="break-all opacity-75">{booking.reference}</p>
            <p className="font-semibold">{money.format(booking.total_due_minor / 100)}</p>
            {booking.status === "awaiting_payment" && <p>
              {locale === "th" ? "ชำระก่อน" : "Pay by"} {new Intl.DateTimeFormat(locale === "th" ? "th-TH" : "en-GB", {
                dateStyle: "medium", timeStyle: "short", timeZone: timezone,
              }).format(new Date(booking.due_at))}
            </p>}
            {booking.status === "awaiting_payment" && <PaymentCountdown dueAt={booking.due_at} locale={locale} />}
            <a className="paid-signup-secondary inline-flex min-h-10 items-center rounded-lg px-3 py-2 font-semibold"
              href={`/app/orders?paid_booking=${encodeURIComponent(booking.reference)}`}>
              {booking.status === "expired"
                ? (locale === "th" ? "เปิดรายการอีกครั้ง" : "Reactivate booking")
                : (locale === "th" ? "ดูการจอง" : "View booking")}
            </a>
          </div>
        </details>
      )}
      {enabled && catalog && attendees.length > 0 ? (
        <form id="public-registration-form" onSubmit={submit} className="scroll-mt-24 space-y-4">
          <p className="text-xs font-semibold opacity-75">{locale === "th" ? "จองใหม่ / เพิ่มผู้เข้าร่วม" : "New booking / Add attendees"}</p>
          <fieldset disabled={busy} className="space-y-3">
            <label className="block text-sm font-medium">{locale === "th" ? "ชื่อผู้ติดต่อ" : "Primary contact name"}
              <input className={field} required maxLength={180} value={contact} onChange={(event) => setContact(event.target.value)} />
            </label>
            <SeminarInputs fields={catalog.fields.filter(({ scope }) => scope === "booking")} values={answers} locale={locale}
              onChange={(key, value) => setAnswers((current) => ({ ...current, [key]: value }))} />
            {attendees.map((row, index) => (
              <fieldset key={index} className="space-y-2 rounded-xl border border-slate-200 p-3">
                <legend className="px-1 text-sm font-semibold">{locale === "th" ? "ผู้เข้าร่วม" : "Attendee"} {index + 1}</legend>
                <label className="block text-sm">{locale === "th" ? "ประเภท" : "Category"}
                  <select className={field} value={row.category_id} onChange={(event) => update(index, { category_id: event.target.value })}>
                    {catalog.categories.map((category) => <option key={category.id} value={category.id}>{category.label} · {category.unit_minor === 0 ? "ฟรี / Free" : money.format(category.unit_minor / 100)}</option>)}
                  </select>
                </label>
                <label className="block text-sm">{locale === "th" ? "ชื่อ" : "First name"}
                  <input className={field} required maxLength={180} value={row.first_name} onChange={(event) => update(index, { first_name: event.target.value })} />
                </label>
                <label className="block text-sm">{locale === "th" ? "นามสกุล" : "Last name"}
                  <input className={field} required maxLength={180} value={row.last_name} onChange={(event) => update(index, { last_name: event.target.value })} />
                </label>
                <SeminarInputs fields={catalog.fields.filter(({ scope }) => scope === "attendee")} values={row.answers} locale={locale}
                  onChange={(key, value) => update(index, { answers: { ...row.answers, [key]: value } })} />
                {((catalog.categories.find((category) => category.id === row.category_id)?.accommodation_discount_minor ?? 0) > 0 || roomSurchargeMinor(catalog.fields, row.answers) > 0) &&
                  <p className="rounded-md bg-blue-50 px-2 py-1 text-sm font-semibold text-blue-900">
                    {locale === "th" ? "ราคาสุทธิ" : "Attendee price"}: {money.format(attendeePrice(row) / 100)}
                    {row.answers?.accommodation === "no" && (
                      <span className="ml-2 text-xs font-normal">
                        {locale === "th" ? "หักค่าที่พักแล้ว" : "Accommodation deducted"}
                      </span>
                    )}
                  </p>}
                {attendees.length > 1 && <button type="button" onClick={() => {invalidateCoupon();setAttendees((rows) => rows.filter((_, rowIndex) => rowIndex !== index));}} className="text-sm text-blue-700 underline">{locale === "th" ? "ลบผู้เข้าร่วม" : "Remove attendee"}</button>}
              </fieldset>
            ))}
            {attendees.length < 100 && <button type="button" onClick={() => {invalidateCoupon();setAttendees((rows) => [...rows, {
              category_id: catalog.categories[0].id, first_name: "", last_name: "",
              answers:seminarDefaultAnswers(catalog.fields,"attendee"),
            }]);}} className="text-sm text-blue-700 underline">{locale === "th" ? "+ เพิ่มผู้เข้าร่วม" : "+ Add attendee"}</button>}
            <div className="space-y-2 rounded-xl border border-slate-200 p-3 text-sm">
              <label htmlFor="public-coupon-code" className="font-semibold">{locale==="th"?"โค้ดส่วนลด":"Coupon / Discount code"}</label>
              <div className="flex gap-2">
                <input id="public-coupon-code" className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2"
                  value={couponCode} onChange={e=>{setCouponCode(e.target.value);invalidateCoupon();}}
                  placeholder="SPECIAL20" maxLength={32} autoCapitalize="characters"/>
                <button type="button" disabled={couponBusy||!couponCode.trim()}
                  className="min-h-10 rounded-lg border border-blue-400 px-4 py-2 font-semibold text-blue-700 disabled:opacity-50"
                  onClick={()=>void applyCouponPreview()}>{couponBusy?"…":locale==="th"?"ใช้โค้ด":"Apply"}</button>
              </div>
              {couponError&&<p role="alert" className="text-red-700">{couponError}</p>}
              {couponPreview&&<p role="status" className="text-emerald-700">
                {couponPreview.code} — {locale==="th"?"ลด":"Discount"}
                {" "+money.format(couponPreview.discount_minor/100)}
              </p>}
              {couponPreview?.provisional&&<p className="text-xs text-amber-700">
                {locale==="th"
                  ? "ยอดนี้คำนวณจากราคาเต็ม กรุณาเลือกที่พักก่อนยืนยันการจองเพื่อสรุปยอดจริง"
                  : "Preview uses the current base price. Choose accommodation before booking to finalize the amount."}
              </p>}
              <div className="flex items-center justify-between">
                <span>{locale==="th"?"ยอดก่อนคูปอง":"Subtotal"}</span><span>{money.format(total/100)}</span>
              </div>
              {couponPreview&&<div className="flex items-center justify-between text-emerald-700">
                <span>{locale==="th"?"ส่วนลด":"Coupon discount"}</span>
                <span>−{money.format(couponPreview.discount_minor/100)}</span>
              </div>}
              <div className="flex items-center justify-between border-t pt-2 font-bold">
                <span>{locale==="th"?"ยอดชำระ":"Total due"}</span>
                <span>{money.format((couponPreview?.total_minor??total)/100)}</span>
              </div>
              {couponPreview?.total_minor===0&&<p className="text-emerald-700">
                {locale==="th"?"คูปองฟรี: ไม่ต้องชำระเงิน จะได้รับบัตรทันที":"Free coupon: no payment needed, tickets issued immediately"}
              </p>}
            </div>
            <button className="w-full rounded-xl bg-blue-600 px-4 py-3 font-semibold text-white" type="submit">{busy ? (locale === "th" ? "กำลังจอง…" : "Reserving…") : (locale === "th" ? "ยืนยันการจอง" : "Reserve places")}</button>
          </fieldset>

        </form>
      ) : <p role="status" className="text-sm text-slate-700">{enabled && !error ? "กำลังโหลด / Loading…" : "ยังไม่เปิดรับจอง / Booking not open yet"}</p>}
      {catalog?.payment_mode !== "external_manual" && (
      <details className="space-y-2 border-t border-slate-200 pt-3 text-sm text-slate-700">
        <summary className="cursor-pointer font-medium">Optional Messenger booking access</summary>
        <p>Generate a private code and send it to the organizer’s Messenger page within 10 minutes.</p>
        <div className="flex flex-wrap gap-3">
          <button type="button" disabled={messengerBusy} onClick={() => void updateMessenger("POST")} className="text-blue-700 underline">Generate code</button>
          <button type="button" disabled={messengerBusy} onClick={() => void updateMessenger("DELETE")} className="text-blue-700 underline">Disconnect</button>
        </div>
        {messengerCode && <code className="block select-all break-all rounded-lg bg-slate-100 p-2">{messengerCode}</code>}
        {messengerMessage && <p role="status">{messengerMessage}</p>}
      </details>
      )}
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    </div>
  );
}

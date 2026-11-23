import { PaidProofForm } from "../../../components/PaidProofForm";
import { formatCustomerDate, type CustomerCopy, type CustomerLocale } from "../customerLocale";
import { paidSeminarFields, type EditableSeminarKey, type PaidSeminarKey, type PaidSeminarAnswer } from "../../../../backend/paidSeminarFields";
import { PaymentCountdown } from "../../../components/PaymentCountdown";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { CheckCircle2, UploadCloud } from "lucide-react";
import { customerApi } from "./CustomerAccountScreen";

type Booking = {
  id: string;
  event_id: string;
  event_name: string;
  event_slug: string;
  reference: string;
  attendee_count?: number;
  status: string;
  payment_status: string;
  credit_used_minor?: number;
  credit_issued_minor?: number;
  refunded_minor?: number;
  total_due_minor: number;
  balance_due_minor?: number;
  due_at: string;
};
type PreferenceField = { key: EditableSeminarKey; scope: "booking" | "attendee"; required: boolean; options?: string[]; surcharge?: { option: string; minor: number } };

const seminarLabels: Record<PaidSeminarKey, string> = {
  arrival: "วันที่เดินทางมาถึง",
  departure: "วันที่เดินทางกลับ",
  accommodation: "ต้องการที่พัก",
  room_preference: "ประเภทห้องพักที่ต้องการ",
  transport: "การเดินทาง",
  food: "อาหารที่ต้องการ",
  notes: "ข้อมูลเพิ่มเติม",
};

function PreferenceInput({ locale, field, initial, path, attendeeId, onSaved }: { locale: CustomerLocale;
  field: PreferenceField; initial?: string; path: string; attendeeId?: string; onSaved: (value: string) => void;
}) {
  const t = (th: string, en: string) => locale === "th" ? th : en;
  const [value, setValue] = useState(initial ?? "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<CustomerCopy>();
  const inputClass = "mt-1 block w-full rounded-lg border border-slate-200 bg-white px-2 py-2";
  return <form className="rounded-lg border border-slate-200 p-2" onSubmit={async (event) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setMessage(undefined);
    try {
      await customerApi(path, { method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: field.key, attendee_id: attendeeId, value }) });
      onSaved(value.trim());
      setMessage(["บันทึกแล้ว", "Saved"]);
    } catch {
      setMessage(["บันทึกไม่สำเร็จ กรุณาตรวจคำตอบแล้วลองอีกครั้ง", "Could not save. Check your answer and retry."]);
    } finally {
      setBusy(false);
    }
  }}>
    <label className="block font-medium">
      {t(seminarLabels[field.key], paidSeminarFields[field.key].label)}
      {field.options ? <select className={inputClass} required={field.required} value={value}
        onChange={(event) => { setValue(event.target.value); setMessage(undefined); }}>
        <option value="">{t("เลือกคำตอบ", "Select an answer")}</option>
        {value && !field.options.includes(value) && <option value={value} disabled>{value}</option>}
        {field.options.map((option) => <option key={option} value={option}>{option}{field.surcharge?.option === option ? ` (+${baht(field.surcharge.minor, locale)})` : ""}</option>)}
      </select> : <input type={paidSeminarFields[field.key].type === "date" ? "date" : "text"} className={inputClass} maxLength={500} required={field.required} value={value}
        onChange={(event) => { setValue(event.target.value); setMessage(undefined); }} />}
    </label>
    <button type="submit" disabled={busy || (!!value && !!field.options && !field.options.includes(value))}
      className="mt-2 rounded-lg bg-blue-700 px-3 py-2 font-semibold text-white disabled:opacity-50">
      {busy ? t("กำลังบันทึก…", "Saving…") : t("บันทึกคำตอบ", "Save answer")}
    </button>
    {message && <p role="status" className="mt-1">{t(...message)}</p>}
  </form>;
}

type Detail = { balance_due_minor?: number; pending_proofs?: number; registrant_name?: string; registrant_email?: string; registrant_phone?: string; preferences_close_at?: string | null; registration_answers?: PaidSeminarAnswer[];  preference_fields?: PreferenceField[]; preference_answers?: Record<string, string>; status: string; total_due_minor: number; due_at: string; version: number; payment_state: string; payment_mode: "promptpay" | "external_manual";
  coupon?: { code: string; subtotal_minor: number; discount_minor: number } | null; attendees: { id: string; room_is_default?: boolean; email?: string; phone?: string; registration_answers?: PaidSeminarAnswer[]; preference_answers?: Record<string, string>; first_name: string; last_name: string; category_label: string; unit_minor: number; base_minor?: number; accommodation_discount_minor?: number }[] };
type Page = { bookings: Booking[]; next_offset: number | null };
const baht = (minor: number, locale: CustomerLocale) =>
  new Intl.NumberFormat(locale === "th" ? "th-TH" : "en-GB", { style: "currency", currency: "THB" }).format(minor / 100);
function Step({n,title,children,emphasis=false}:{n:number;title:string;children:ReactNode;emphasis?:boolean}) {
  return <section className={"rounded-xl border p-3 sm:p-4 "+(emphasis?
    "border-blue-400/50 bg-blue-500/10":"border-slate-200 bg-slate-50")}>
    <h4 className="mb-3 flex items-center gap-2.5 font-bold text-slate-900">
      <span className={"flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-base text-white "+
        (emphasis?"bg-blue-500":"bg-slate-600")}>{n}</span>
      {title}
    </h4>
    <div className="sm:pl-10">{children}</div>
  </section>;
}


type PaymentDisplay = { bank_name: string; account_name: string; account_number: string; qr_png_base64: string };
function ExternalPaymentInstructions({ locale, eventId, bookingId }: { locale: CustomerLocale; eventId: string; bookingId: string }) {
  const t = (th: string, en: string) => locale === "th" ? th : en;
  const [shareError, setShareError] = useState<CustomerCopy>();
  const [details,setDetails] = useState<PaymentDisplay>();
  const [loading,setLoading] = useState(true);
  useEffect(() => {
    const abort = new AbortController();
    void customerApi<PaymentDisplay>("/api/customer/paid-bookings/" + encodeURIComponent(eventId) + "/" +
      encodeURIComponent(bookingId) + "/payment-display", {signal:abort.signal})
      .then(setDetails).catch(() => undefined).finally(() => {
        if (!abort.signal.aborted) setLoading(false);
      });
    return () => abort.abort();
  },[eventId,bookingId]);
  if (loading) return <p role="status" className="text-sm text-slate-700">{t("กำลังโหลดบัญชีรับเงิน", "Loading payment details…")}</p>;
  if (!details || !(details.account_name && (details.account_number || details.qr_png_base64))) {
    return <p role="alert" className="rounded-lg border border-amber-600/40 bg-amber-50 p-3 text-sm text-amber-800">
      {t("ยังไม่มีข้อมูลบัญชีรับเงิน กรุณาติดต่อผู้จัดงานก่อนโอน", "Payment details are incomplete. Contact the organizer before transferring.")}
    </p>;
  }
  const qrUrl = "data:image/png;base64," + details.qr_png_base64;
  const qrFile = details.qr_png_base64 && typeof navigator.share === "function" && typeof navigator.canShare === "function"
    ? new File([Uint8Array.from(atob(details.qr_png_base64), (character) => character.charCodeAt(0))],
        "meetrix-payment-qr.png", { type: "image/png" })
    : undefined;
  const canShareQr = qrFile && navigator.canShare({ files: [qrFile] });

  return <div className="space-y-2 text-sm">
    {!!details.bank_name && <p>{t("ธนาคาร", "Bank")}: {details.bank_name}</p>}
    {!!details.account_name && <p>{t("ชื่อบัญชี", "Recipient")}: <strong>{details.account_name}</strong></p>}
    {!!details.account_number && <p>{t("เลขบัญชี", "Account")}: <span className="font-mono font-semibold">{details.account_number}</span></p>}
    {!!details.qr_png_base64 && <div className="space-y-1">
      <img src={qrUrl} alt={t("QR รับเงินจากผู้จัดงาน", "Organizer-provided payment QR code")}
        className="block h-auto w-full max-w-72 rounded-xl bg-[#fff] p-3 object-contain" />
      {canShareQr && <button type="button" className="mr-2 inline-flex min-h-11 items-center rounded-lg bg-blue-700 px-4 py-2 font-semibold text-white"
        onClick={async () => {
          setShareError(undefined);
          try {
            await navigator.share({ files: [qrFile] });
          } catch (error) {
            if (!(error instanceof DOMException && error.name === "AbortError")) {
              setShareError(["แชร์รูปไม่สำเร็จ ลองกดดาวน์โหลด", "Could not share. Try downloading the QR."]);
            }
          }
        }}>{t("แชร์รูป QR", "Share QR image")}</button>}
      <a href={qrUrl} download="meetrix-payment-qr.png"
        className="inline-flex min-h-11 items-center rounded-lg border border-blue-400/50 px-4 py-2 text-sm font-semibold text-blue-700 underline underline-offset-2">
        {t("ดาวน์โหลด QR", "Download QR")}
      </a>
      {shareError && <p role="status" className="text-xs text-rose-700">{t(...shareError)}</p>}
      <p className="text-xs">{canShareQr
        ? t("แตะ แชร์รูป QR แล้วเลือกบันทึกรูป หากเครื่องมีตัวเลือกนี้", "Share the QR and choose Save Image if available.")
        : t("บนมือถือ ลองกดค้างที่รูป QR เพื่อดูเมนูบันทึกรูป", "On mobile, press and hold the QR to see image options.")}</p>
      <p className="text-xs">{t("ตรวจชื่อผู้รับและยอดเงินก่อนโอน", "Verify the recipient and amount.")}</p>
    </div>}

  </div>;
}
export function CustomerPaidBookings({ locale = "th", overview = false, tickets = false, onPaymentChanged }: {
  locale?: CustomerLocale; overview?: boolean; tickets?: boolean; onPaymentChanged?: () => void;
}) {
  const t = (th: string, en: string) => locale === "th" ? th : en;
  const [reference, setReference] = useState(() => {
    if (overview || tickets) return "";
    const value = new URLSearchParams(window.location.search).get("paid_booking") || "";
    return /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value) ? value : "";
  });
  const [page, setPage] = useState<Page>();
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<Booking>();
  const [detail, setDetail] = useState<Detail>();
  const [error, setError] = useState<CustomerCopy>();
  const [reactivating, setReactivating] = useState<string>();
  const [cancelling, setCancelling] = useState<string>();
  const [cancelTarget, setCancelTarget] = useState<string>();
  const paymentAnchorRef = useRef<HTMLDivElement>(null);
  const slipAnchorRef = useRef<HTMLDivElement>(null);
  const revealSlip = useRef(reference !== "" && new URLSearchParams(window.location.search).get("upload_slip") === "1");
  const didScrollToInvoice = useRef(false);
  useEffect(() => {
    if (!detail || !selected || didScrollToInvoice.current) return;
    didScrollToInvoice.current = true;
    const target = revealSlip.current ? slipAnchorRef.current ?? paymentAnchorRef.current : paymentAnchorRef.current;
    target?.scrollIntoView({ behavior: "auto", block: "start" });
  }, [reference, detail, selected]);
  useEffect(() => {
    const request = new AbortController();
    setPage(undefined);
    setError(undefined);
    const params = new URLSearchParams({ offset: String(offset) });
    if (tickets) params.set("confirmed", "1");
    if (reference) params.set("reference", reference);
    void customerApi<Page>(`/api/customer/paid-bookings?${params}`, { signal: request.signal })
      .then((result) => {
        if (request.signal.aborted) return;
        setPage(result);
        if (reference) setSelected(result.bookings[0]);
      }).catch(() => { if (!request.signal.aborted) setError(["โหลดรายการจองไม่สำเร็จ", "Could not load paid registrations."]); });
    return () => request.abort();
  }, [offset, reference, tickets]);
  useEffect(() => {
    setDetail(undefined);
    if (!selected) return;
    const request = new AbortController();
    void customerApi<Detail>(`/api/customer/paid-bookings/${encodeURIComponent(selected.event_id)}/${encodeURIComponent(selected.id)}`, { signal: request.signal })
      .then((result) => {
      if (request.signal.aborted) return;
      setDetail(result);
      setPage((current) => current && { ...current, bookings: current.bookings.map((booking) =>
        booking.id === selected.id ? { ...booking, status: result.status, payment_status: result.payment_state, due_at: result.due_at, total_due_minor: result.total_due_minor, balance_due_minor: result.balance_due_minor } : booking) });
    }).catch(() => { if (!request.signal.aborted) setError(["โหลดรายละเอียดการจองไม่สำเร็จ", "Could not load booking details."]); });
    return () => request.abort();
  }, [selected]);
  useEffect(() => setCancelTarget(undefined), [selected?.id]);

  function showSavedAnswer(key: EditableSeminarKey, value: string, attendeeId?: string) {
    const update = (answers: PaidSeminarAnswer[] = []) => [
      ...answers.filter((answer) => answer.key !== key),
      ...(value ? [{ key, value, label: paidSeminarFields[key].label }] : []),
    ];
    setDetail((current) => current && (attendeeId
      ? { ...current, attendees: current.attendees.map((attendee) => attendee.id === attendeeId
        ? { ...attendee, registration_answers: update(attendee.registration_answers) } : attendee) }
      : { ...current, registration_answers: update(current.registration_answers) }));
  }

  async function reactivate(booking: Booking) {
    if (reactivating) return;
    setReactivating(booking.id);
    setError(undefined);
    try {
      const result = await customerApi<{ status: string; due_at: string }>(
        "/api/customer/paid-bookings/" + encodeURIComponent(booking.event_id) + "/" +
        encodeURIComponent(booking.id) + "/reinstate", { method: "POST" },
      );
      const updated = { ...booking, status: result.status, payment_status: "unpaid", due_at: result.due_at };
      setPage((previous) => previous && { ...previous,
        bookings: previous.bookings.map((entry) => entry.id === booking.id ? updated : entry) });
      setSelected(updated);
      setDetail(undefined);
      revealSlip.current = false;
      didScrollToInvoice.current = false;
      onPaymentChanged?.();
    } catch (failure) {
      const code = failure instanceof Error ? failure.message : "";
      setError(code === "credit_changed"
        ? ["เครดิตเดิมถูกใช้แล้ว กรุณาสร้างใบจองใหม่", "The original credit was used. Create a new booking."]
        : code === "coupon_exhausted" || code === "coupon_unavailable"
        ? ["คูปองของรายการเดิมไม่สามารถใช้ได้แล้ว กรุณาทำรายการใหม่", "Original coupon unavailable. Create a new booking."]
        : code === "capacity_exhausted"
        ? ["ที่นั่งเต็มแล้ว กรุณาติดต่อผู้จัดงาน", "No capacity available for this booking."]
        : code === "registration_unavailable" || code === "hold_expired"
          ? ["ปิดรับลงทะเบียนแล้ว กรุณาติดต่อผู้จัดงาน", "Registration window is closed."]
          : code === "state_conflict"
            ? ["สถานะเปลี่ยนไปแล้ว โปรดรีเฟรช", "Booking state changed; please refresh."]
            : ["เปิดรายการอีกครั้งไม่สำเร็จ", "Could not reactivate this booking."]);
    } finally {
      setReactivating(undefined);
    }
  }

  async function cancelBooking(booking: Booking) {
    if (cancelling || cancelTarget !== booking.id) return;
    setCancelling(booking.id);
    setError(undefined);
    try {
      const path = `/api/customer/paid-bookings/${encodeURIComponent(booking.event_id)}/${encodeURIComponent(booking.id)}`;
      await customerApi(`${path}/cancel`, { method: "POST" });
      setPage(current => current && { ...current, bookings: current.bookings.map(entry =>
        entry.id === booking.id ? { ...entry, status: "cancelled" } : entry) });
      setSelected(current => current?.id === booking.id ? undefined : current);
      setCancelTarget(undefined);
      onPaymentChanged?.();
    } catch (failure) {
      setError(failure instanceof Error && failure.message === "state_conflict"
        ? ["สถานะใบจองเปลี่ยนแล้ว กรุณาโหลดหน้าใหม่ก่อนทำรายการ", "The booking status has changed. Reload before trying again."]
        : ["ยกเลิกใบจองไม่สำเร็จ กรุณาลองใหม่", "Could not cancel the booking. Try again."]);
    } finally {
      setCancelling(undefined);
    }
  }

  return (
    <section className="space-y-4 rounded-3xl border border-slate-200 bg-white p-5 text-slate-700">
      <h2 className="text-lg font-bold text-slate-900">{tickets ? t("บัตรสัมมนา", "Seminar passes") : t("การจองและชำระเงิน", "My bookings")}</h2>
      {overview && page && (offset > 0 || page.bookings.length > 0) && <p className="text-sm text-slate-600">{t("รายการจอง", "Bookings")} {offset + 1}–{offset + page.bookings.length}</p>}
      {reference && <button type="button" className="text-sm text-blue-700 underline" onClick={() => {
        setReference("");
        didScrollToInvoice.current = false;
        setSelected(undefined);
        window.history.replaceState(window.history.state, "", "/app/orders");
      }}>{t("ดูรายการจองทั้งหมด", "Show all paid registrations")}</button>}
      {error && <p role="alert" className="text-sm text-rose-700">{t(...error)}</p>}
      {!page && !error && <p role="status" className="text-sm">{t("กำลังโหลดรายการจอง…", "Loading bookings…")}</p>}
      {page?.bookings.length === 0 && <p className="text-sm text-slate-600">{reference ? t("ไม่พบรายการจองนี้ในบัญชีของคุณ", "This booking is unavailable for your account.") : tickets ? t("บัตรสัมมนาจะแสดงหลังยืนยันการจอง", "Passes appear after confirmation.") : t("ยังไม่มีรายการจองแบบชำระเงิน", "No paid registrations yet.")}</p>}
      {page?.bookings.map((booking) => (
        <article key={booking.id} className="space-y-2 border-t border-slate-200 pt-3 text-sm">
          <h3 className="font-semibold">{booking.event_name}</h3>
          <p className="break-all text-xs text-slate-600">{t("เลขใบจอง", "Booking")} {booking.reference}
            {booking.attendee_count != null && ` · ${booking.attendee_count} ${t("คน", booking.attendee_count === 1 ? "attendee" : "attendees")}`}</p>
          <p className="font-semibold" aria-live="polite">{baht(booking.total_due_minor, locale)} · {
            ({
              awaiting_payment: t("รอชำระเงิน", "Awaiting payment"),
              verification_pending: t("ส่งสลิปแล้ว รอตรวจสอบ", "Under review"),
              confirmed: t("ยืนยันแล้ว", "Confirmed"),
              expired: t("หมดเวลาชำระเงิน", "Expired"),
              cancelled: t("ยกเลิกแล้ว", "Cancelled"),
            } as Record<string, string>)[booking.status] || booking.status
          }</p>
          {!!booking.refunded_minor && <p className="font-semibold text-emerald-700">{t("ผู้จัดงานบันทึกคืนเงินแล้ว", "Organizer recorded a refund")} · {baht(booking.refunded_minor, locale)}</p>}
          {!!booking.credit_issued_minor && <p className="font-semibold text-emerald-700">{t("ออกเครดิตสำหรับงานนี้", "Credit issued for this event")} · {baht(booking.credit_issued_minor, locale)}</p>}
          {!!booking.credit_used_minor && <p className="text-emerald-700">{booking.status === "cancelled" || booking.status === "expired" ? t("เครดิตคืนเข้าบัญชี", "Credit returned") : t("เครดิตที่ใช้", "Credit applied")} · {baht(booking.credit_used_minor, locale)}</p>}
          {booking.status === "awaiting_payment" && <p className="text-slate-600">
            {t("ชำระภายใน", "Due")} {formatCustomerDate(booking.due_at, locale)} {t("(เวลาไทย)", "(Thailand time)")}
          </p>}
          {!!booking.balance_due_minor && <p className="font-semibold text-amber-800">
            {t("ยอดที่ต้องชำระเพิ่ม", "Additional amount due")} · {baht(booking.balance_due_minor, locale)}
          </p>}
          {booking.status === "awaiting_payment" && <PaymentCountdown locale={locale} dueAt={booking.due_at} onExpired={() => {
            setPage((current) => current && { ...current, bookings: current.bookings.map((item) =>
              item.id === booking.id && item.status === "awaiting_payment" ? { ...item, status: "expired" } : item) });
            setSelected((current) => current?.id === booking.id ? undefined : current);
            onPaymentChanged?.();
          }} />}
          {overview ? (
            <a className="inline-flex min-h-10 items-center font-semibold text-blue-700 underline"
              href={`/app/orders?paid_booking=${encodeURIComponent(booking.reference)}`}>
              {booking.status === "awaiting_payment" ? t("ไปชำระเงิน", "Continue to payment") : t("ดูรายการจอง", "View booking")}
            </a>
          ) : <>
          {booking.status === "expired" && (
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-amber-800">{t("หมดเวลาชำระเงิน", "Payment hold expired")}</p>
              <button type="button" disabled={!!reactivating}
                className="inline-flex min-h-11 items-center rounded-lg bg-blue-600 px-4 py-2 font-semibold text-white hover:bg-blue-500 disabled:opacity-50"
                onClick={() => void reactivate(booking)}>
                {reactivating === booking.id ? t("กำลังเปิดรายการ…", "Reopening…") : t("เปิดรายการอีกครั้ง", "Reactivate booking")}
              </button>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-3">
            {!tickets && booking.status === "awaiting_payment" && <button type="button"
              className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 font-semibold text-white hover:bg-blue-700"
              onClick={() => {
                if (selected?.id === booking.id && slipAnchorRef.current) {
                  slipAnchorRef.current.scrollIntoView({ block: "start" });
                  return;
                }
                revealSlip.current = true;
                didScrollToInvoice.current = false;
                if (selected?.id !== booking.id) {
                  setError(undefined);
                  setDetail(undefined);
                  setSelected(booking);
                }
              }}>
              <UploadCloud className="h-4 w-4" aria-hidden="true" />{t("อัปโหลดสลิป", "Upload payment slip")}
            </button>}
            <button type="button" aria-expanded={selected?.id === booking.id}
              className="min-h-11 rounded-xl border border-slate-200 px-4 py-2 font-semibold text-blue-700"
              onClick={() => { setError(undefined); setDetail(undefined); revealSlip.current = false; didScrollToInvoice.current = false; setSelected(selected?.id === booking.id ? undefined : booking); }}>
              {selected?.id === booking.id ? t("ซ่อนรายละเอียด", "Hide details") : booking.status === "awaiting_payment" ? t("ดูวิธีชำระเงิน", "View payment instructions") : t("ดูหรือแก้ไขใบจอง", "View or edit booking")}
            </button>
            {!tickets && booking.event_slug && <a href={`/events/${encodeURIComponent(booking.event_slug)}#public-registration`}
              className="inline-flex min-h-11 items-center rounded-xl border border-slate-200 px-4 font-semibold text-blue-700">
              {t("ลงทะเบียนเพิ่ม", "Book more attendees")}
            </a>}
          </div>
          {selected?.id === booking.id && !detail && !error && <p role="status">{t("กำลังโหลดรายละเอียด", "Loading booking…")}</p>}
          {selected?.id === booking.id && detail && (
            <div ref={paymentAnchorRef} className="scroll-mt-24 space-y-3" aria-label={t("รายละเอียดการจองและชำระเงิน", "Payment and booking details")}>
            {!!detail.preference_fields?.length && <details className="rounded-lg border border-slate-200 p-3">
              <summary className="cursor-pointer font-semibold">{t("แก้ไขข้อมูลลงทะเบียน", "Edit registration details")}</summary>
              <div className="mt-3 space-y-3">
                {detail.preferences_close_at && <p>{t("แก้ไขได้ก่อน", "Edit before")} {formatCustomerDate(detail.preferences_close_at, locale)} {t("(เวลาไทย)", "(Thailand time)")}</p>}
                {detail.preference_fields.filter(({ scope }) => scope === "booking").map((field) =>
                  <PreferenceInput locale={locale} key={field.key} field={field} initial={detail.preference_answers?.[field.key]}
                    onSaved={(value) => showSavedAnswer(field.key, value)}
                    path={`/api/customer/paid-bookings/${encodeURIComponent(booking.event_id)}/${encodeURIComponent(booking.id)}/preferences`} />)}
                {detail.preference_fields.some(({ scope }) => scope === "attendee") && detail.attendees.map((attendee) =>
                  <section key={attendee.id} className="space-y-2">
                    <h4 className="font-semibold">{attendee.first_name} {attendee.last_name}</h4>
                    {detail.preference_fields?.filter(({ scope, surcharge }) => scope === "attendee" && (!surcharge || !attendee.registration_answers?.some(
                      ({ key, value }) => key === "accommodation" && value === "no"))).map((field) =>
                      <PreferenceInput locale={locale} key={field.key} field={field} initial={attendee.preference_answers?.[field.key]}
                        attendeeId={attendee.id}
                        onSaved={(value) => {
                          if (field.surcharge) setSelected((current) => current?.id === booking.id ? { ...current } : current);
                          else showSavedAnswer(field.key, value, attendee.id);
                        }}
                        path={`/api/customer/paid-bookings/${encodeURIComponent(booking.event_id)}/${encodeURIComponent(booking.id)}/preferences`} />)}
                  </section>)}
              </div>
            </details>}
            <details open className="rounded-lg border border-slate-200 p-3 text-sm">
              <summary className="cursor-pointer font-medium text-slate-700">{t("ผู้เข้าร่วมและรายละเอียดการจอง", "Attendees and booking details")}</summary>
              <div className="mt-3 space-y-3">
            {detail.registrant_name && <p>{t("ผู้จอง", "Booked by")} <strong>{detail.registrant_name}</strong></p>}
            {(detail.registrant_email || detail.registrant_phone) && <p className="break-words">{[detail.registrant_email, detail.registrant_phone].filter(Boolean).join(" · ")}</p>}
            {detail.registration_answers?.map(({ key, label, value }) => <p key={key}>{t(seminarLabels[key] ?? label, paidSeminarFields[key]?.label ?? label)} · {key === "accommodation" && value === "yes" ? t("ต้องการ", "Yes") : key === "accommodation" && value === "no" ? t("ไม่ต้องการ", "No") : value}</p>)}
            <ul className="space-y-2">{detail.attendees.map((attendee) => (
              <li key={attendee.id}>
                {attendee.first_name} {attendee.last_name} · {attendee.category_label} ·
                {" "}{baht(attendee.unit_minor, locale)}
                {!!attendee.accommodation_discount_minor && (
                  <span className="ml-2 text-emerald-700">
                    ({t("ไม่ใช้ที่พัก", "No accommodation")}: −{baht(attendee.accommodation_discount_minor, locale)})
                  </span>
                )}
                {(attendee.email || attendee.phone) && <p className="break-words text-slate-600">{[attendee.email, attendee.phone].filter(Boolean).join(" · ")}</p>}
                {attendee.registration_answers?.map(({ key, label, value }) => <p className="text-slate-600" key={key}>{t(seminarLabels[key] ?? label, paidSeminarFields[key]?.label ?? label)} · {key === "accommodation" && value === "yes" ? t("ต้องการ", "Yes") : key === "accommodation" && value === "no" ? t("ไม่ต้องการ", "No") : value}{key === "room_preference" && attendee.room_is_default ? t(" (ค่าเริ่มต้น)", " (Default)") : ""}</p>)}
                {detail.status === "confirmed" && (
                  <a className="ml-2 text-blue-700 underline" target="_blank" rel="noopener noreferrer"
                    href={`/api/customer/paid-bookings/${encodeURIComponent(booking.event_id)}/${encodeURIComponent(booking.id)}/attendees/${encodeURIComponent(attendee.id)}/credential`}>
                    {t("QR เข้างาน", "Admission QR")}
                  </a>
                )}
              </li>
            ))}</ul>
            {detail.coupon && <div className="space-y-1 rounded-lg border border-emerald-500/30 p-3 text-sm">
              <p className="font-semibold text-emerald-700">{t("คูปอง", "Coupon")}: {detail.coupon.code}</p>
              <div className="flex justify-between"><span>{t("ยอดก่อนหักส่วนลด", "Subtotal")}</span>
                <span>{baht(detail.coupon.subtotal_minor, locale)}</span></div>
              <div className="flex justify-between text-emerald-700"><span>{t("ส่วนลด", "Discount")}</span>
                <span>−{baht(detail.coupon.discount_minor, locale)}</span></div>
              {!!booking.credit_used_minor && <div className="flex justify-between"><span>{t("หักเครดิต", "Booking credit")}</span><span>−{baht(booking.credit_used_minor, locale)}</span></div>}
              <div className="flex justify-between font-semibold"><span>{t("ยอดที่ต้องชำระ", "Total due")}</span>
                <span>{baht(booking.total_due_minor, locale)}</span></div>
            </div>}
              </div>
            </details>
            {detail.status==="confirmed" && booking.total_due_minor===0 &&
              <p role="status" className="rounded-lg bg-emerald-50 p-3 text-emerald-700">
                {t("คูปองฟรี: ยืนยันแล้ว ไม่ต้องโอนเงิน", "Complimentary booking confirmed. No payment required.")}
              </p>}
            {booking.status === "awaiting_payment" && detail.status === "awaiting_payment" && <div className="space-y-3">
              <Step n={1} title={t("ยอดที่ต้องชำระ", "Amount to pay")}>
                <p className="text-3xl font-extrabold text-slate-900">{baht(booking.total_due_minor, locale)}</p>
                <p className="mt-1 text-xs text-slate-700">{t("ชำระภายใน", "Due")} {formatCustomerDate(booking.due_at, locale)} {t("(เวลาไทย)", "(Thailand time)")}</p>
              </Step>
              <Step n={2} title={t("สแกน QR หรือโอนเข้าบัญชี", "Pay")}>
                {detail.payment_mode === "external_manual"
                  ? <ExternalPaymentInstructions locale={locale} eventId={booking.event_id} bookingId={booking.id}/>
                  : <div className="space-y-3">
                      <img src={"/api/customer/paid-bookings/"+encodeURIComponent(booking.event_id)+"/"+
                        encodeURIComponent(booking.id)+"/payment-qr?v="+detail.version} alt={t("QR สำหรับชำระเงิน", "Payment QR code")}
                        className="h-auto w-56 max-w-full rounded-xl bg-[#fff] p-3"/>
                      <p className="text-slate-700">{t("สแกน QR แล้วตรวจชื่อบัญชีและยอดชำระก่อนโอน", "Scan the QR code and verify the account name and amount before transferring.")}</p>
                    </div>}
              </Step>
              <div ref={slipAnchorRef} className="scroll-mt-24"><Step n={3} title={t("อัปโหลดสลิปหลังโอน", "Upload slip")} emphasis>
                <PaidProofForm locale={locale} key={booking.id} path={"/api/customer/paid-bookings/" + encodeURIComponent(booking.event_id) + "/" + encodeURIComponent(booking.id)}
                  paymentMode={detail.payment_mode} submitRequest={customerApi} version={detail.version} totalMinor={booking.total_due_minor} onSubmitted={() => {
                    const updated = { ...booking, status: "verification_pending", payment_status: "proof_submitted" };
                    setDetail(undefined);setSelected(updated);
                    setPage((current) => current && { ...current, bookings: current.bookings.map((row) => row.id === booking.id ? updated : row) });
                    onPaymentChanged?.();
                  }}/>
              </Step></div>
              <Step n={4} title={t("รอผู้จัดงานยืนยัน", "Confirmation")}>
                <p className="text-sm text-slate-700">{t("หลังส่งสลิป ผู้จัดงานจะตรวจสอบเงินและยืนยันการลงทะเบียน จากนั้นจึงได้รับบัตรเข้างาน", "After you submit the slip, the organizer will verify your payment and confirm your registration before issuing your pass.")}</p>
              </Step>
            </div>}
            {!tickets && (detail.status === "verification_pending" || !!detail.balance_due_minor) && <div ref={slipAnchorRef} className="scroll-mt-24 space-y-3 rounded-xl border border-slate-200 p-3">
              {!!detail.pending_proofs && <p role="status" className="flex items-center gap-2 text-emerald-700">
                <CheckCircle2 className="h-5 w-5" aria-hidden="true" />
                {t(`ส่งสลิปแล้ว ${detail.pending_proofs} ใบ รอผู้จัดงานตรวจ`, `${detail.pending_proofs} slip(s) submitted for review`)}
              </p>}
              {!!detail.balance_due_minor && <>
                <p className="font-bold">{t("ยอดที่ต้องชำระเพิ่ม", "Additional amount due")} · {baht(detail.balance_due_minor, locale)}</p>
                {detail.payment_mode === "external_manual"
                  ? <ExternalPaymentInstructions locale={locale} eventId={booking.event_id} bookingId={booking.id} />
                  : <img src={`/api/customer/paid-bookings/${encodeURIComponent(booking.event_id)}/${encodeURIComponent(booking.id)}/payment-qr?v=${detail.version}`}
                      alt={t("QR สำหรับยอดชำระเพิ่ม", "QR code for the remaining balance")} className="w-48 max-w-full rounded-xl bg-white p-2" />}
              </>}
              <details className="rounded-lg border border-slate-200 p-3">
                <summary className="cursor-pointer font-semibold text-blue-700">{t("แนบสลิปเพิ่ม", "Add another slip")}</summary>
                <div className="mt-3">
                  <PaidProofForm locale={locale} key={detail.version} path={`/api/customer/paid-bookings/${encodeURIComponent(booking.event_id)}/${encodeURIComponent(booking.id)}`}
                    paymentMode={detail.payment_mode} submitRequest={customerApi} version={detail.version}
                    totalMinor={detail.balance_due_minor || detail.total_due_minor}
                    onSubmitted={() => { setSelected({ ...booking }); onPaymentChanged?.(); }} />
                </div>
              </details>
            </div>}
            {!tickets && detail.status === "awaiting_payment" && ["unpaid", "rejected"].includes(detail.payment_state) && (
              <div className="border-t border-slate-200 pt-3">
                {cancelTarget !== booking.id ? <button type="button" className="min-h-10 px-2 text-sm text-slate-600 underline"
                  onClick={() => setCancelTarget(booking.id)}>{t("จัดการการยกเลิก", "Manage cancellation")}</button> :
                  <section className="space-y-2 rounded-xl border border-rose-200 p-3">
                    <h4 className="font-semibold">{t("ยกเลิกใบจองและคืนที่นั่งทั้งหมดหรือไม่?", "Cancel this booking and release every seat?")}</h4>
                    <p className="text-sm">{t("ถ้าโอนเงินแล้ว ให้แนบสลิปหรือติดต่อผู้จัดงานก่อน", "If you transferred money, attach the slip or contact the organizer first.")}</p>
                    <div className="flex flex-wrap gap-3">
                      <button type="button" autoFocus disabled={!!cancelling} onClick={() => setCancelTarget(undefined)}
                        className="min-h-11 rounded-lg bg-blue-700 px-3 font-semibold text-white">{t("เก็บใบจองไว้", "Keep booking")}</button>
                      <button type="button" disabled={!!cancelling} onClick={() => void cancelBooking(booking)}
                        className="min-h-11 rounded-lg border border-rose-300 px-3 font-semibold text-rose-700 disabled:opacity-50">
                        {cancelling === booking.id ? t("กำลังยกเลิก…", "Cancelling…") : t("ยืนยันยกเลิกใบจอง", "Confirm cancellation")}
                      </button>
                    </div>
                  </section>}
              </div>
            )}



            </div>
          )}
          </>}
        </article>
      ))}
      {page && (offset > 0 || page.next_offset != null) && (
        <div className="flex gap-4 text-sm">
          {offset > 0 && <button type="button" className="underline" onClick={() => { setSelected(undefined); setOffset(Math.max(0, offset - 20)); }}>{t("ก่อนหน้า", "Previous")}</button>}
          {page.next_offset != null && <button type="button" className="underline" onClick={() => { setSelected(undefined); setOffset(page.next_offset!); }}>{t("ถัดไป", "Next")}</button>}
        </div>
      )}
    </section>
  );
}

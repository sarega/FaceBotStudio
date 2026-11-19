import { paidSeminarFields, type EditableSeminarKey, type PaidSeminarAnswer } from "../../../../backend/paidSeminarFields";
import { PaymentCountdown } from "../../../components/PaymentCountdown";
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
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
  total_due_minor: number;
  due_at: string;
};
type PreferenceField = { key: EditableSeminarKey; scope: "booking" | "attendee"; required: boolean; options?: string[] };

function PreferenceInput({ field, initial, path, attendeeId, onSaved }: {
  field: PreferenceField; initial?: string; path: string; attendeeId?: string; onSaved: (value: string) => void;
}) {
  const [value, setValue] = useState(initial ?? "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const inputClass = "mt-1 block w-full rounded-lg border border-slate-200 bg-white px-2 py-2";
  return <form className="rounded-lg border border-slate-200 p-2" onSubmit={async (event) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      await customerApi(path, { method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: field.key, attendee_id: attendeeId, value }) });
      onSaved(value.trim());
      setMessage("บันทึกแล้ว / Saved");
    } catch {
      setMessage("บันทึกไม่สำเร็จ กรุณาตรวจคำตอบแล้วลองอีกครั้ง / Could not save. Check your answer and retry.");
    } finally {
      setBusy(false);
    }
  }}>
    <label className="block font-medium">
      {field.key === "transport" ? "การเดินทาง / Transport" : field.key === "food" ? "อาหาร / Food preference" : paidSeminarFields[field.key].label}
      {field.options ? <select className={inputClass} required={field.required} value={value}
        onChange={(event) => { setValue(event.target.value); setMessage(""); }}>
        <option value="">เลือกคำตอบ / Select an answer</option>
        {value && !field.options.includes(value) && <option value={value} disabled>{value}</option>}
        {field.options.map((option) => <option key={option} value={option}>{option}</option>)}
      </select> : <input type={paidSeminarFields[field.key].type === "date" ? "date" : "text"} className={inputClass} maxLength={500} required={field.required} value={value}
        onChange={(event) => { setValue(event.target.value); setMessage(""); }} />}
    </label>
    <button type="submit" disabled={busy || (!!value && !!field.options && !field.options.includes(value))}
      className="mt-2 rounded-lg bg-blue-700 px-3 py-2 font-semibold text-white disabled:opacity-50">
      {busy ? "กำลังบันทึก… / Saving…" : "บันทึกคำตอบ / Save answer"}
    </button>
    {message && <p role="status" className="mt-1">{message}</p>}
  </form>;
}

type Detail = { registrant_name?: string; registrant_email?: string; registrant_phone?: string; preferences_close_at?: string | null; registration_answers?: PaidSeminarAnswer[];  preference_fields?: PreferenceField[]; preference_answers?: Record<string, string>; status: string; due_at: string; version: number; payment_state: string; payment_mode: "promptpay" | "external_manual";
  coupon?: { code: string; subtotal_minor: number; discount_minor: number } | null; attendees: { id: string; email?: string; phone?: string; registration_answers?: PaidSeminarAnswer[]; preference_answers?: Record<string, string>; first_name: string; last_name: string; category_label: string; unit_minor: number; base_minor?: number; accommodation_discount_minor?: number }[] };
type Page = { bookings: Booking[]; next_offset: number | null };
const baht = (minor:number) => new Intl.NumberFormat("th-TH",{style:"currency",currency:"THB"}).format(minor/100);
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


function PaidProofForm({ path, version, totalMinor, paymentMode, onSubmitted }: {
  path: string; version: number; totalMinor: number; paymentMode: "promptpay" | "external_manual"; onSubmitted: () => void;
}) {
  const [file, setFile] = useState<File>();
  const fileId=useId();
  const [amount, setAmount] = useState((totalMinor / 100).toFixed(2));
  const [paidAt, setPaidAt] = useState("");
  const [reference, setReference] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const command = useRef<{ signature: string; file: File; key: string } | undefined>(undefined);
  const submitting = useRef(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current || !file) return;
    const parts = /^(\d+)(?:\.(\d{1,2}))?$/.exec(amount.trim());
    const minor = parts ? Number(parts[1]) * 100 + Number((parts[2] ?? "").padEnd(2, "0")) : 0;
    const transferTime = new Date(paidAt);
    if (!Number.isSafeInteger(minor) || minor < 1 || !Number.isFinite(transferTime.getTime()) ||
        file.size < 1 || file.size > 4 * 1024 * 1024 || !["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setError("Enter the transferred amount and time and select a JPEG, PNG or WebP up to 4 MB.");
      return;
    }
    setError("");
    const claimedDate = transferTime.toISOString();
    const normalizedRef = reference.trim();
    if (normalizedRef && !/^[!-~]+$/.test(normalizedRef)) {
      setError("Use the transfer reference shown by your bank, without spaces or special characters outside ASCII.");
      return;
    }
    const signature = JSON.stringify([version, minor, claimedDate, normalizedRef]);
    if (command.current?.file !== file || command.current.signature !== signature) {
      command.current = { file, signature, key: crypto.randomUUID() };
    }
    submitting.current = true;
    setBusy(true);
    try {
      await customerApi(`${path}/proofs`, {
        method: "POST", body: file,
        headers: {
          "Content-Type": "application/octet-stream", "Idempotency-Key": command.current.key,
          "x-booking-version": String(version), "x-claimed-minor": String(minor),
          "x-claimed-transfer-at": claimedDate, "x-payment-method": paymentMode === "external_manual" ? "bank_transfer" : "promptpay",
          "x-proof-mime": file.type, "x-payment-reference": normalizedRef,
        },
      });
      onSubmitted();
    } catch (failure) {
      const code = failure instanceof Error ? failure.message : "";
      setError(code === "proof_storage_unavailable"
        ? "ยังไม่เปิดระบบเก็บสลิปอย่างปลอดภัย กรุณาติดต่อผู้จัดงาน / Secure slip upload is not configured."
        : code === "hold_expired"
          ? "หมดเวลาชำระเงินแล้ว กรุณาติดต่อผู้จัดงาน / Payment deadline has passed."
          : "ส่งสลิปไม่สำเร็จ กรุณาลองใหม่ / Slip upload failed. Please retry.");
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  const input = "mt-1 block w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-white";
  return (
    <form onSubmit={submit} className="space-y-3">
      {paymentMode==="promptpay" && <p className="text-xs text-slate-700">ตรวจสอบ QR ในขั้นตอนที่ 2 ก่อนโอน</p>}
      <label htmlFor={fileId} className="relative flex min-h-24 cursor-pointer focus-within:ring-2 focus-within:ring-blue-600 flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-blue-400 bg-blue-500/10 px-4 py-3 text-center font-semibold text-blue-700 hover:bg-blue-500/20">
        <UploadCloud className="h-7 w-7"/>
        <span>{file ? file.name : "เลือกภาพสลิป / Choose payment slip"}</span>
        <span className="text-xs font-normal text-slate-700">รูปภาพ JPG / PNG / WebP ไม่เกิน 4 MB</span>
        <input id={fileId} className="absolute inset-0 h-full w-full cursor-pointer opacity-0" type="file" accept="image/*"
          disabled={busy} onChange={(event) => {
            const chosen=event.target.files?.[0];
            setError("");
            if (chosen && (!["image/png", "image/jpeg", "image/webp"].includes(chosen.type) || chosen.size > 4 * 1024 * 1024 || chosen.size === 0)) {
              event.target.value = "";
              setFile(undefined);
              setError("กรุณาเลือกรูป JPG, PNG หรือ WebP ขนาดไม่เกิน 4 MB / Choose a JPG, PNG or WebP up to 4 MB.");
              return;
            }
            setFile(chosen);
            if(chosen&&!paidAt){
              const now=new Date();
              setPaidAt(new Date(now.getTime()-now.getTimezoneOffset()*60000).toISOString().slice(0,16));
            }
          }}/>
      </label>
      <details className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700">
        <summary className="cursor-pointer">แก้ไขยอดหรือเวลาโอน (ถ้าจำเป็น)</summary>
        <fieldset disabled={busy} className="mt-3 grid gap-3 sm:grid-cols-2">
          <label>ยอดที่โอน (บาท)
            <input className={input} inputMode="decimal" value={amount}
              onChange={(event) => setAmount(event.target.value)}/>
          </label>
          <label>วันเวลาโอน
            <input className={input} type="datetime-local" value={paidAt}
              onChange={(event) => setPaidAt(event.target.value)}/>
          </label>
          <label className="sm:col-span-2">เลขอ้างอิงธนาคาร (ถ้ามี)
            <input className={input} value={reference} maxLength={255}
              onChange={(event) => setReference(event.target.value)}/>
          </label>
        </fieldset>
      </details>
      <button type="submit" disabled={busy||!file}
        className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-blue-500 px-5 py-3 text-base font-bold text-white hover:bg-blue-400 disabled:cursor-not-allowed disabled:bg-slate-600">
        <UploadCloud className="h-5 w-5"/>
        {busy?"กำลังส่งสลิป…":"ส่งสลิปให้ผู้จัดงาน / Submit slip"}
      </button>
      {!file && <p className="text-center text-xs text-slate-600">เลือกภาพสลิปก่อนกดส่ง</p>}
      {error && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-rose-700">{error}</p>}
    </form>
  );
}

type PaymentDisplay = { bank_name: string; account_name: string; account_number: string; qr_png_base64: string };
function ExternalPaymentInstructions({ eventId, bookingId }: { eventId: string; bookingId: string }) {
  const [shareError, setShareError] = useState("");
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
  if (loading) return <p role="status" className="text-sm text-slate-700">กำลังโหลดบัญชีรับเงิน / Loading payment details…</p>;
  if (!details || !(details.account_name && (details.account_number || details.qr_png_base64))) {
    return <p role="alert" className="rounded-lg border border-amber-600/40 bg-amber-50 p-3 text-sm text-amber-800">
      ยังไม่มีข้อมูลบัญชีรับเงิน กรุณาติดต่อผู้จัดงานก่อนโอน<br />
      Payment details are incomplete. Contact the organizer before transferring.
    </p>;
  }
  const qrUrl = "data:image/png;base64," + details.qr_png_base64;
  const qrFile = details.qr_png_base64 && typeof navigator.share === "function" && typeof navigator.canShare === "function"
    ? new File([Uint8Array.from(atob(details.qr_png_base64), (character) => character.charCodeAt(0))],
        "meetrix-payment-qr.png", { type: "image/png" })
    : undefined;
  const canShareQr = qrFile && navigator.canShare({ files: [qrFile] });

  return <div className="space-y-2 text-sm">
    {!!details.bank_name && <p>ธนาคาร / Bank: {details.bank_name}</p>}
    {!!details.account_name && <p>ชื่อบัญชี / Recipient: <strong>{details.account_name}</strong></p>}
    {!!details.account_number && <p>เลขบัญชี / Account: <span className="font-mono font-semibold">{details.account_number}</span></p>}
    {!!details.qr_png_base64 && <div className="space-y-1">
      <img src={qrUrl} alt="Organizer-provided payment QR code"
        className="block h-auto w-full max-w-72 rounded-xl bg-[#fff] p-3 object-contain" />
      {canShareQr && <button type="button" className="mr-2 inline-flex min-h-11 items-center rounded-lg bg-blue-700 px-4 py-2 font-semibold text-white"
        onClick={async () => {
          setShareError("");
          try {
            await navigator.share({ files: [qrFile] });
          } catch (error) {
            if (!(error instanceof DOMException && error.name === "AbortError")) {
              setShareError("แชร์รูปไม่สำเร็จ ลองกดดาวน์โหลด / Could not share. Try downloading the QR.");
            }
          }
        }}>แชร์รูป QR / Share QR image</button>}
      <a href={qrUrl} download="meetrix-payment-qr.png"
        className="inline-flex min-h-11 items-center rounded-lg border border-blue-400/50 px-4 py-2 text-sm font-semibold text-blue-700 underline underline-offset-2">
        ดาวน์โหลด QR / Download QR
      </a>
      {shareError && <p role="status" className="text-xs text-rose-700">{shareError}</p>}
      <p className="text-xs">{canShareQr
        ? "แตะ แชร์รูป QR แล้วเลือกบันทึกรูป หากเครื่องมีตัวเลือกนี้ / Share the QR and choose Save Image if available."
        : "บนมือถือ ลองกดค้างที่รูป QR เพื่อดูเมนูบันทึกรูป / On mobile, press and hold the QR to see image options."}</p>
      <p className="text-xs">ตรวจชื่อผู้รับและยอดเงินก่อนโอน / Verify the recipient and amount.</p>
    </div>}

  </div>;
}
export function CustomerPaidBookings({ locale = "th", overview = false, tickets = false }: { locale?: "th" | "en"; overview?: boolean; tickets?: boolean }) {
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
  const [error, setError] = useState("");
  const [reactivating, setReactivating] = useState<string>();
  const paymentAnchorRef = useRef<HTMLDivElement>(null);
  const didScrollToInvoice = useRef(false);
  useEffect(() => {
    if (!detail || !selected || didScrollToInvoice.current) return;
    didScrollToInvoice.current = true;
    paymentAnchorRef.current?.scrollIntoView({ behavior: "auto", block: "start" });
  }, [reference, detail, selected]);
  useEffect(() => {
    const request = new AbortController();
    setPage(undefined);
    setError("");
    const params = new URLSearchParams({ offset: String(offset) });
    if (tickets) params.set("confirmed", "1");
    if (reference) params.set("reference", reference);
    void customerApi<Page>(`/api/customer/paid-bookings?${params}`, { signal: request.signal })
      .then((result) => {
        if (request.signal.aborted) return;
        setPage(result);
        if (reference) setSelected(result.bookings[0]);
      }).catch(() => { if (!request.signal.aborted) setError("Could not load paid registrations."); });
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
        booking.id === selected.id ? { ...booking, status: result.status, due_at: result.due_at } : booking) });
    }).catch(() => { if (!request.signal.aborted) setError("โหลดรายละเอียดการจองไม่สำเร็จ / Could not load booking details."); });
    return () => request.abort();
  }, [selected]);

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
    setError("");
    try {
      const result = await customerApi<{ status: string; due_at: string }>(
        "/api/customer/paid-bookings/" + encodeURIComponent(booking.event_id) + "/" +
        encodeURIComponent(booking.id) + "/reinstate", { method: "POST" },
      );
      const updated = { ...booking, status: result.status, due_at: result.due_at };
      setPage((previous) => previous && { ...previous,
        bookings: previous.bookings.map((entry) => entry.id === booking.id ? updated : entry) });
      setSelected(updated);
      setDetail(undefined);
      didScrollToInvoice.current = false;
    } catch (failure) {
      const code = failure instanceof Error ? failure.message : "";
      setError(code === "coupon_exhausted" || code === "coupon_unavailable"
        ? "คูปองของรายการเดิมไม่สามารถใช้ได้แล้ว กรุณาทำรายการใหม่ / Original coupon unavailable. Create a new booking."
        : code === "capacity_exhausted"
        ? "ที่นั่งเต็มแล้ว กรุณาติดต่อผู้จัดงาน / No capacity available for this booking."
        : code === "registration_unavailable" || code === "hold_expired"
          ? "ปิดรับลงทะเบียนแล้ว กรุณาติดต่อผู้จัดงาน / Registration window is closed."
          : code === "state_conflict"
            ? "สถานะเปลี่ยนไปแล้ว โปรดรีเฟรช / Booking state changed; please refresh."
            : "เปิดรายการอีกครั้งไม่สำเร็จ / Could not reactivate this booking.");
    } finally {
      setReactivating(undefined);
    }
  }

  return (
    <section className="space-y-4 rounded-3xl border border-slate-200 bg-white p-5 text-slate-700">
      <h2 className="text-lg font-bold text-slate-900">{tickets ? t("บัตรสัมมนา", "Seminar passes") : t("การจองและชำระเงิน", "My bookings")}</h2>
      {overview && page && (offset > 0 || page.bookings.length > 0) && <p className="text-sm text-slate-600">รายการจอง / Bookings {offset + 1}–{offset + page.bookings.length}</p>}
      {reference && <button type="button" className="text-sm text-blue-700 underline" onClick={() => {
        setReference("");
        didScrollToInvoice.current = false;
        setSelected(undefined);
        window.history.replaceState(window.history.state, "", "/app/orders");
      }}>Show all paid registrations</button>}
      {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}
      {!page && !error && <p role="status" className="text-sm">Loading bookings…</p>}
      {page?.bookings.length === 0 && <p className="text-sm text-slate-600">{reference ? "This booking is unavailable for your account." : tickets ? "บัตรสัมมนาจะแสดงหลังยืนยันการจอง / Passes appear after confirmation." : "No paid registrations yet."}</p>}
      {page?.bookings.map((booking) => (
        <article key={booking.id} className="space-y-2 border-t border-slate-200 pt-3 text-sm">
          <h3 className="font-semibold">{booking.event_name}</h3>
          <p className="break-all text-xs text-slate-600">เลขใบจอง / Booking {booking.reference}
            {booking.attendee_count != null && ` · ${booking.attendee_count} คน / attendees`}</p>
          <p className="font-semibold">{baht(booking.total_due_minor)} · {
            ({
              awaiting_payment: t("รอชำระเงิน", "Awaiting payment"),
              verification_pending: t("ส่งสลิปแล้ว รอตรวจสอบ", "Under review"),
              confirmed: t("ยืนยันแล้ว", "Confirmed"),
              expired: t("หมดเวลาชำระเงิน", "Expired"),
              cancelled: t("ยกเลิกแล้ว", "Cancelled"),
            } as Record<string, string>)[booking.status] || booking.status
          }</p>
          {booking.status === "awaiting_payment" && <p className="text-slate-600">
            ชำระภายใน / Due {new Date(booking.due_at).toLocaleString("th-TH", { timeZone: "Asia/Bangkok", timeZoneName: "short" })}
          </p>}
          {booking.status === "awaiting_payment" && <PaymentCountdown dueAt={booking.due_at} onExpired={() => {
            setPage((current) => current && { ...current, bookings: current.bookings.map((item) =>
              item.id === booking.id && item.status === "awaiting_payment" ? { ...item, status: "expired" } : item) });
            setSelected((current) => current?.id === booking.id ? undefined : current);
          }} />}
          {overview ? (
            <a className="inline-flex min-h-10 items-center font-semibold text-blue-700 underline"
              href={`/app/orders?paid_booking=${encodeURIComponent(booking.reference)}`}>
              {booking.status === "awaiting_payment" ? t("ไปชำระเงิน", "Continue to payment") : t("ดูรายการจอง", "View booking")}
            </a>
          ) : <>
          {booking.status === "expired" && (
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-amber-800">หมดเวลาชำระเงิน / Payment hold expired</p>
              <button type="button" disabled={!!reactivating}
                className="inline-flex min-h-11 items-center rounded-lg bg-blue-600 px-4 py-2 font-semibold text-white hover:bg-blue-500 disabled:opacity-50"
                onClick={() => void reactivate(booking)}>
                {reactivating === booking.id ? "กำลังเปิดรายการ… / Reopening…" : "เปิดรายการอีกครั้ง / Reactivate booking"}
              </button>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" aria-expanded={selected?.id === booking.id}
              className="min-h-11 rounded-xl bg-blue-600 px-4 py-2 font-semibold text-white hover:bg-blue-700"
              onClick={() => { setError(""); setDetail(undefined); didScrollToInvoice.current = false; setSelected(selected?.id === booking.id ? undefined : booking); }}>
              {selected?.id === booking.id ? "ซ่อนรายละเอียด / Hide details" : "ดูหรือแก้ไขใบจอง / View or edit booking"}
            </button>
            {!tickets && booking.event_slug && <a href={`/events/${encodeURIComponent(booking.event_slug)}#public-registration`}
              className="inline-flex min-h-11 items-center rounded-xl border border-slate-200 px-4 font-semibold text-blue-700">
              ลงทะเบียนเพิ่ม / Book more attendees
            </a>}
          </div>
          {selected?.id === booking.id && !detail && !error && <p role="status">กำลังโหลดรายละเอียด / Loading booking…</p>}
          {selected?.id === booking.id && detail && (
            <div ref={paymentAnchorRef} className="scroll-mt-4 space-y-3" aria-label="Payment and booking details">
            {!!detail.preference_fields?.length && <details className="rounded-lg border border-slate-200 p-3">
              <summary className="cursor-pointer font-semibold">แก้ไขข้อมูลลงทะเบียน / Edit registration details</summary>
              <div className="mt-3 space-y-3">
                {detail.preferences_close_at && <p>แก้ไขได้ก่อน / Edit before {new Date(detail.preferences_close_at).toLocaleString("th-TH", { timeZone: "Asia/Bangkok" })} (เวลาไทย)</p>}
                {detail.preference_fields.filter(({ scope }) => scope === "booking").map((field) =>
                  <PreferenceInput key={field.key} field={field} initial={detail.preference_answers?.[field.key]}
                    onSaved={(value) => showSavedAnswer(field.key, value)}
                    path={`/api/customer/paid-bookings/${encodeURIComponent(booking.event_id)}/${encodeURIComponent(booking.id)}/preferences`} />)}
                {detail.preference_fields.some(({ scope }) => scope === "attendee") && detail.attendees.map((attendee) =>
                  <section key={attendee.id} className="space-y-2">
                    <h4 className="font-semibold">{attendee.first_name} {attendee.last_name}</h4>
                    {detail.preference_fields?.filter(({ scope }) => scope === "attendee").map((field) =>
                      <PreferenceInput key={field.key} field={field} initial={attendee.preference_answers?.[field.key]}
                        attendeeId={attendee.id}
                        onSaved={(value) => showSavedAnswer(field.key, value, attendee.id)}
                        path={`/api/customer/paid-bookings/${encodeURIComponent(booking.event_id)}/${encodeURIComponent(booking.id)}/preferences`} />)}
                  </section>)}
              </div>
            </details>}
            <details open className="rounded-lg border border-slate-200 p-3 text-sm">
              <summary className="cursor-pointer font-medium text-slate-700">ผู้เข้าร่วมและรายละเอียดการจอง</summary>
              <div className="mt-3 space-y-3">
            {detail.registrant_name && <p>ผู้จอง / Booked by <strong>{detail.registrant_name}</strong></p>}
            {(detail.registrant_email || detail.registrant_phone) && <p className="break-words">{[detail.registrant_email, detail.registrant_phone].filter(Boolean).join(" · ")}</p>}
            {detail.registration_answers?.map(({ key, label, value }) => <p key={key}>{label} · {value}</p>)}
            <ul className="space-y-2">{detail.attendees.map((attendee) => (
              <li key={attendee.id}>
                {attendee.first_name} {attendee.last_name} · {attendee.category_label} ·
                {" "}{new Intl.NumberFormat("th-TH", { style: "currency", currency: "THB" }).format(attendee.unit_minor / 100)}
                {!!attendee.accommodation_discount_minor && (
                  <span className="ml-2 text-emerald-700">
                    (No accommodation: −{new Intl.NumberFormat("th-TH", { style: "currency", currency: "THB" })
                      .format(attendee.accommodation_discount_minor / 100)})
                  </span>
                )}
                {(attendee.email || attendee.phone) && <p className="break-words text-slate-600">{[attendee.email, attendee.phone].filter(Boolean).join(" · ")}</p>}
                {attendee.registration_answers?.map(({ key, label, value }) => <p className="text-slate-600" key={key}>{label} · {value}</p>)}
                {detail.status === "confirmed" && (
                  <a className="ml-2 text-blue-700 underline" target="_blank" rel="noopener noreferrer"
                    href={`/api/customer/paid-bookings/${encodeURIComponent(booking.event_id)}/${encodeURIComponent(booking.id)}/attendees/${encodeURIComponent(attendee.id)}/credential`}>
                    Admission QR
                  </a>
                )}
              </li>
            ))}</ul>
            {detail.coupon && <div className="space-y-1 rounded-lg border border-emerald-500/30 p-3 text-sm">
              <p className="font-semibold text-emerald-700">Coupon: {detail.coupon.code}</p>
              <div className="flex justify-between"><span>Subtotal</span>
                <span>{new Intl.NumberFormat("th-TH",{style:"currency",currency:"THB"})
                  .format(detail.coupon.subtotal_minor/100)}</span></div>
              <div className="flex justify-between text-emerald-700"><span>Discount</span>
                <span>−{new Intl.NumberFormat("th-TH",{style:"currency",currency:"THB"})
                  .format(detail.coupon.discount_minor/100)}</span></div>
              <div className="flex justify-between font-semibold"><span>Total due</span>
                <span>{new Intl.NumberFormat("th-TH",{style:"currency",currency:"THB"})
                  .format(booking.total_due_minor/100)}</span></div>
            </div>}
              </div>
            </details>
            {detail.status==="confirmed" && booking.total_due_minor===0 &&
              <p role="status" className="rounded-lg bg-emerald-50 p-3 text-emerald-700">
                คูปองฟรี: ยืนยันแล้ว ไม่ต้องโอนเงิน / Complimentary booking confirmed. No payment required.
              </p>}
            {booking.status === "awaiting_payment" && detail.status === "awaiting_payment" && <div className="space-y-3">
              <Step n={1} title="ยอดที่ต้องชำระ / Amount to pay">
                <p className="text-3xl font-extrabold text-slate-900">{baht(booking.total_due_minor)}</p>
                <p className="mt-1 text-xs text-slate-700">ชำระภายใน {new Date(booking.due_at).toLocaleString("th-TH", { timeZone: "Asia/Bangkok" })}</p>
              </Step>
              <Step n={2} title="สแกน QR หรือโอนเข้าบัญชี / Pay">
                {detail.payment_mode === "external_manual"
                  ? <ExternalPaymentInstructions eventId={booking.event_id} bookingId={booking.id}/>
                  : <div className="space-y-3">
                      <img src={"/api/customer/paid-bookings/"+encodeURIComponent(booking.event_id)+"/"+
                        encodeURIComponent(booking.id)+"/payment-qr"} alt="Payment QR code"
                        className="h-auto w-56 max-w-full rounded-xl bg-[#fff] p-3"/>
                      <p className="text-slate-700">สแกน QR แล้วตรวจชื่อบัญชีและยอดชำระก่อนโอน</p>
                    </div>}
              </Step>
              <Step n={3} title="อัปโหลดสลิปหลังโอน / Upload slip" emphasis>
                <PaidProofForm key={booking.id} path={"/api/customer/paid-bookings/" + encodeURIComponent(booking.event_id) + "/" + encodeURIComponent(booking.id)}
                  paymentMode={detail.payment_mode} version={detail.version} totalMinor={booking.total_due_minor} onSubmitted={() => {
                    const updated = { ...booking, status: "verification_pending" };
                    setDetail(undefined);setSelected(updated);
                    setPage((current) => current && { ...current, bookings: current.bookings.map((row) => row.id === booking.id ? updated : row) });
                  }}/>
              </Step>
              <Step n={4} title="รอผู้จัดงานยืนยัน / Confirmation">
                <p className="text-sm text-slate-700">หลังส่งสลิป ผู้จัดงานจะตรวจสอบเงินและยืนยันการลงทะเบียน จากนั้นจึงได้รับบัตรเข้างาน</p>
              </Step>
            </div>}
            {detail.status === "verification_pending" && <div role="status"
              className="flex items-center gap-3 rounded-xl border border-emerald-500/30 bg-emerald-50 p-4 font-semibold text-emerald-700">
              <CheckCircle2 className="h-6 w-6"/> ส่งสลิปสำเร็จแล้ว รอผู้จัดงานยืนยัน / Slip received
            </div>}


            </div>
          )}
          </>}
        </article>
      ))}
      {page && (offset > 0 || page.next_offset != null) && (
        <div className="flex gap-4 text-sm">
          {offset > 0 && <button type="button" className="underline" onClick={() => { setSelected(undefined); setOffset(Math.max(0, offset - 20)); }}>Previous</button>}
          {page.next_offset != null && <button type="button" className="underline" onClick={() => { setSelected(undefined); setOffset(page.next_offset!); }}>Next</button>}
        </div>
      )}
    </section>
  );
}

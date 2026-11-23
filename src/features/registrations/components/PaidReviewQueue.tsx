import { PaidTransferReportExport } from "../../reports/components/PaidTransferReportExport";
import { RegistrationSectionHeader } from "./RegistrationSectionHeader";
import { PaidBookingOperations } from "./PaidBookingOperations";
import { PaidProofForm } from "../../../components/PaidProofForm";
import { useEffect, useId, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, ChevronDown, Search, SlidersHorizontal, UploadCloud, XCircle } from "lucide-react";

type Review = {
  booking_id: string;
  attempt_id: string | null;
  booking_reference: string;
  event_id: string;
  event_name: string;
  customer_id: string;
  customer_first_name: string;
  customer_last_name: string;
  customer_email: string;
  customer_phone: string;
  booking_created_ms: number;
  created_ms: number | null;
  due_ms: number;
  version: number;
  total_minor: number;
  attendee_count: number;
  attendee_names?: string[];
  claimed_minor: number | null;
  proof_id: string | null;
  balance_due_minor: number;
  proofs: { attempt_id: string; proof_id: string; claimed_minor: number | null; matching_proofs: number }[];
  claimed_transfer_ms: number | null;
  claimed_reference: string | null;
  claimed_payer_name?: string | null;
  payment_mode: "promptpay" | "external_manual";
  receiver_name: string | null;
  receiver_last_four: string;
  matching_proofs: number;
  payment_state: string;
  reason: string | null;
};
type ApiFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const inputClass = "mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2";
const toolbarControl = "registration-admin-control";

function ReviewForm({ review, path, apiFetch, onUpdated, language }: {
  review: Review; path: string; apiFetch: ApiFetch; onUpdated: () => void; language: "th" | "en";
}) {
  const t = (th: string, en: string) => language === "th" ? th : en;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<[string, string] | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [showReject, setShowReject] = useState(false);
  const [showException, setShowException] = useState(false);
  const command = useRef<{ body: string; key: string } | undefined>(undefined);
  const [selectedAttempt, setSelectedAttempt] = useState(review.attempt_id);
  const hasDuplicates = review.proofs.some(proof => proof.matching_proofs > 0);
  const canApprove = !!review.attempt_id && review.proofs.length > 0 && !hasDuplicates;
  const reported = review.proofs.every(proof => proof.claimed_minor != null)
    ? review.proofs.reduce((total, proof) => total + (proof.claimed_minor ?? 0), 0) : null;

  async function submit(decision:"approve"|"reject"|"flag") {
    if (busy || (decision === "approve" && !canApprove)) return;
    setError(null);
    const reason = decision === "approve" ? "Verified transfer against bank records"
      : rejectReason.trim() || (decision === "reject" ? "Proof rejected by organizer" : "Proof flagged for follow-up");
    const body = JSON.stringify({ decision, attempt_id: decision === "approve" ? review.attempt_id : selectedAttempt, version: review.version, reason });
    if(command.current?.body!==body)command.current={body,key:crypto.randomUUID()};
    setBusy(true);
    try {
      const response=await apiFetch(path+"/review",{
        method:"POST",body,headers:{"Content-Type":"application/json","Idempotency-Key":command.current.key},
      });
      const result=await response.json().catch(()=>({}));
      if(!response.ok) {
        const messages:Record<string,[string,string]>={
          duplicate_reference_or_proof:["พบสลิปหรือเลขอ้างอิงซ้ำ กรุณาตรวจสอบก่อนอนุมัติ", "A duplicate slip or bank reference was found. Check before approving."],
          version_conflict:["รายการถูกแก้ไขแล้ว กรุณาโหลดคิวใหม่", "This booking has changed. Refresh the queue."],
        };
        setError(messages[result.error] ?? ["บันทึกผลไม่สำเร็จ กรุณาลองใหม่", "Could not save the decision. Try again."]);
        return;
      }
      onUpdated();
    } catch {
      setError(["ติดต่อระบบไม่สำเร็จ กรุณาลองใหม่", "Could not reach the server. Try again."]);
    } finally {setBusy(false);}
  }

  return <div className="space-y-2 text-sm">
    {review.attempt_id && <div className="space-y-2">
      {reported != null && reported !== (review.balance_due_minor || review.total_minor) && <p className="rounded-lg bg-amber-50 p-3 font-semibold text-amber-900">
        {t("ยอดที่แจ้งต่างจากยอดจอง กรุณาเทียบกับยอดในภาพสลิป", "The reported amount differs from the booking total. Check the slip image.")}
      </p>}
      {hasDuplicates && <p className="rounded-lg bg-rose-50 p-3 font-semibold text-rose-800">
        {t("พบภาพสลิปซ้ำกับรายการอื่น — ไม่ควรอนุมัติโดยไม่ตรวจสอบ", "This slip matches another booking. Check the duplicate before approving.")}
      </p>}
      <p className="text-xs font-medium text-slate-600">
        {t("กดอนุมัติเมื่อท่านตรวจสอบเงินเข้าบัญชีธนาคารแล้วเท่านั้น", "Confirm the deposit in the bank account before approving.")}
      </p>
      <div className="flex flex-wrap gap-1.5">
        <button type="button" onClick={() => void submit("approve")} disabled={!canApprove || busy}
          className="registration-admin-control registration-admin-control-primary">
          <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> {busy ? t("กำลังบันทึก…", "Saving…") : review.proofs.length > 1 ? t("อนุมัติสลิปทั้งหมด", "Approve all slips") : t("อนุมัติ", "Approve")}
        </button>
        <button type="button" aria-expanded={showReject} onClick={()=>{setShowReject(v=>!v);setShowException(false);}}
          className="registration-admin-control">
          <XCircle className="h-4 w-4" aria-hidden="true" /> {t("ปฏิเสธสลิป", "Reject slip")}
        </button>
        <button type="button" aria-expanded={showException} onClick={()=>{setShowException(v=>!v);setShowReject(false);}}
          className="registration-admin-control">
          <AlertTriangle className="h-4 w-4" aria-hidden="true" /> {t("ส่งตรวจสอบเพิ่มเติม", "Flag for follow-up")}
        </button>
      </div>
      {(showReject||showException)&&<div className="space-y-2 rounded-lg bg-slate-50 p-3">
        {review.proofs.length > 1 && <label className="block">{t("เลือกสลิป", "Choose slip")}
          <select className={inputClass} value={selectedAttempt ?? ""} onChange={event => setSelectedAttempt(event.target.value)}>
            {review.proofs.map((proof, index) => <option key={proof.attempt_id} value={proof.attempt_id}>
              {t(`สลิปใบที่ ${index + 1}`, `Slip ${index + 1}`)}
            </option>)}
          </select>
        </label>}
        <label className="block">{t("หมายเหตุให้ผู้ดูแล (ถ้ามี)", "Note for staff (optional)")}
          <input className={inputClass} maxLength={1000} value={rejectReason}
            onChange={e=>setRejectReason(e.target.value)} />
        </label>
        <button type="button" disabled={busy}
          onClick={()=>void submit(showReject?"reject":"flag")}
          className="registration-admin-control registration-admin-control-primary">
          {showReject ? t("ยืนยันการปฏิเสธ", "Confirm rejection") : t("ยืนยันส่งตรวจสอบ", "Confirm flag")}
        </button>
      </div>}
    </div>}
    {error&&<p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-800">{t(...error)}</p>}
  </div>;
}

export function PaidReviewQueue({ language, eventId, apiFetch, onOpenCustomer, focusBookingReference, onFocusConsumed, summary, summaryError, onSummaryRefresh }: {
  eventId: string; apiFetch: ApiFetch; onOpenCustomer?:(customerId:string)=>void;
  focusBookingReference?:string;
  onFocusConsumed: () => void;
  summary?: Record<string, unknown> | null;
  summaryError: boolean;
  onSummaryRefresh: () => void;
  language: "th" | "en";
}) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Review[]>();
  const [loadFailed, setLoadFailed] = useState(false);
  const [offset, setOffset] = useState(0);
  const [uploadedBooking, setUploadedBooking] = useState("");
  const [reference, setReference] = useState("");
  const [referenceDraft, setReferenceDraft] = useState("");
  const [next, setNext] = useState<number | null>(null);
  const [sort, setSort] = useState<"asc" | "desc">("desc");
  const [toolsOpen, setToolsOpen] = useState(false);
  const [tool, setTool] = useState<"download" | "dashboard" | "booking" | null>(null);
  const [refresh, setRefresh] = useState(0);
  const toolsId = useId();
  const t = (th: string, en: string) => language === "th" ? th : en;
  const locale = language === "th" ? "th-TH" : "en-GB";
  const money = new Intl.NumberFormat(locale, { style: "currency", currency: "THB" });
  const dateTime = new Intl.DateTimeFormat(locale, {
    dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Bangkok",
  });
  const bookingLabel = t("เลขอ้างอิงใบจอง", "Booking reference");
  useEffect(()=>{
    if(focusBookingReference === undefined)return;
    setOpen(true);setReference(focusBookingReference);setReferenceDraft(focusBookingReference);setOffset(0);
    onFocusConsumed();
  },[focusBookingReference,eventId]);
  const fetchRef = useRef(apiFetch);
  fetchRef.current = apiFetch;
  const prefix = `/api/events/${encodeURIComponent(eventId)}/paid-registration`;

  function showFullQueue() {
    setUploadedBooking("");
    setReference("");
    setReferenceDraft("");
    setOffset(0);
    onFocusConsumed();
    setRefresh((value) => value + 1);
  }

  function refreshAfterUpdate() {
    setOffset(0);
    setRefresh((value) => value + 1);
    window.dispatchEvent(new Event("meetrix:paid-booking-updated"));
  }

  useEffect(() => {
    if (refresh > 0) onSummaryRefresh();
  }, [refresh]);

  useEffect(() => {
    if (!open) return;
    const request = new AbortController();
    setRows(undefined);
    setLoadFailed(false);
    const params = new URLSearchParams({ offset: String(offset), sort });
    if (reference) params.set("reference", reference);
    void fetchRef.current(`${prefix}/review-queue?${params}`, { signal: request.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error();
        const result = await response.json();
        if (!request.signal.aborted) {
          setRows(result.reviews);
          setNext(result.next_offset);
        }
      }).catch(() => { if (!request.signal.aborted) setLoadFailed(true); });
    return () => request.abort();
  }, [open, offset, prefix, reference, refresh, sort]);

  return (
    <section id="paid-review-queue" className="registration-admin-section registration-admin-review">
      <RegistrationSectionHeader tone="review" title={t("ตรวจสลิป", "Slip Review")}
        subtitle={summary
          ? t(`รอตรวจสลิป ${Number(summary.pending_review_bookings)} ใบจอง · ยังไม่ส่งสลิป ${Number(summary.awaiting_payment_attendees)} คน`,
              `${Number(summary.pending_review_bookings)} bookings to review · ${Number(summary.awaiting_payment_attendees)} attendees awaiting payment`)
          : t("ตรวจสลิปและยืนยันการชำระเงิน", "Review slips and confirm payments")} open={open} onToggle={()=>setOpen(!open)}
        actions={<button type="button" className={toolbarControl} onClick={showFullQueue}>{t("โหลดใหม่", "Refresh")}</button>} />
      {open && <div className="registration-section-content space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <form className="flex min-w-0 flex-[1_1_8rem] items-center gap-1.5 sm:max-w-xs" onSubmit={(event) => {
            event.preventDefault();
            setReference(referenceDraft.trim());
            setOffset(0);
            setRefresh((value) => value + 1);
          }}>
            <input name="reference" aria-label={bookingLabel} placeholder={bookingLabel}
              className={`${toolbarControl} min-w-0 flex-1`} maxLength={36}
              value={referenceDraft} onChange={(event) => setReferenceDraft(event.target.value)} />
            <button type="submit" aria-label={t("ค้นหาใบจอง", "Find booking")} className={toolbarControl}>
              <Search className="h-4 w-4" aria-hidden="true" />
            </button>
          </form>
          <select aria-label={t("เรียงลำดับคิว", "Sort review queue")} value={sort} className={toolbarControl}
            onChange={(event) => {
              setSort(event.target.value === "asc" ? "asc" : "desc");
              setOffset(0);
            }}>
            <option value="desc">{t("ใหม่สุดก่อน", "Newest first")}</option>
            <option value="asc">{t("เก่าสุดก่อน", "Oldest first")}</option>
          </select>
          <button type="button" aria-expanded={toolsOpen} aria-controls={toolsId} onClick={() => setToolsOpen(!toolsOpen)}
            className={`${toolbarControl} ml-auto`}>
            <SlidersHorizontal className="h-4 w-4" aria-hidden="true" /> {t("เครื่องมือ", "Tools")}
          </button>
        </div>
        <div id={toolsId} hidden={!toolsOpen} className="space-y-2 rounded-lg border border-slate-200 bg-white p-2">
          <div className="flex flex-wrap gap-1">
            {([
              ["download", t("ดาวน์โหลด", "Download")],
              ["dashboard", t("สรุปการจอง", "Dashboard")],
              ["booking", t("จัดการใบจอง", "Booking operations")],
            ] as const).map(([value, label]) => (
              <button key={value} type="button" aria-pressed={tool === value} onClick={() => setTool(tool === value ? null : value)}
                className={toolbarControl}>
                {label}
              </button>
            ))}
          </div>
          <div hidden={tool !== "download"}>
            <PaidTransferReportExport key={eventId} eventId={eventId} apiFetch={apiFetch} language={language} />
          </div>
          <div hidden={tool !== "dashboard"} className="text-sm">
            {summaryError && <p role="alert" className="text-rose-700">{t("โหลดสรุปการจองไม่สำเร็จ", "Could not load booking totals.")}</p>}
            {summary && <div className="flex flex-wrap gap-x-4 gap-y-1 px-2 py-1">
              <span>{t("รอตรวจสลิป", "To review")} <strong>{Number(summary.pending_review_bookings ?? 0)}</strong></span>
              <span>{t("ยืนยันแล้ว", "Confirmed")} <strong>{Number(summary.confirmed_bookings ?? 0)}</strong></span>
              <span>{t("ผู้เข้าร่วม", "Attendees")} <strong>{Number(summary.attendees ?? 0)}</strong></span>
            </div>}
          </div>
          <div hidden={tool !== "booking"}>
            <PaidBookingOperations language={language} eventId={eventId} apiFetch={apiFetch}
              onChange={() => setRefresh((value) => value + 1)}/>
          </div>
        </div>
        {reference && <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="break-all">{t("กำลังแสดงใบจอง", "Filtered to booking")} {reference}</span>
          <button type="button" onClick={showFullQueue} className={toolbarControl}>
            {t("กลับไปคิวทั้งหมด", "Show all reviews")}
          </button>
        </div>}
        {loadFailed && <p role="alert" className="text-red-700">{t("โหลดคิวตรวจสลิปไม่สำเร็จ", "Could not load the review queue.")}</p>}
        {uploadedBooking && <p role="status" className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          {t("แนบสลิปแล้ว ใบจองเข้าคิวรอตรวจ", "Slip uploaded. The booking is awaiting review.")} {uploadedBooking}
        </p>}
        {!rows && !loadFailed && <p role="status">{t("กำลังโหลดคิวตรวจสลิป…", "Loading reviews…")}</p>}
        {rows?.length === 0 && <p>{reference
          ? t("ไม่พบใบจองที่ชำระได้หรือรอตรวจสำหรับเลขอ้างอิงนี้", "No payable or pending booking found for this reference.")
          : t("ไม่มีสลิปรอตรวจ", "No payment slips awaiting review.")}</p>}
        {rows && rows.length > 0 && <div className="grid gap-1.5">{rows.map((review) => {
          const path=prefix+"/bookings/"+encodeURIComponent(review.booking_id);
          const customerName = `${review.customer_first_name} ${review.customer_last_name}`.trim() || review.customer_email;
          return <details key={review.booking_id}
            className="paid-review-item group/review rounded-lg border border-slate-200">
            <summary className="grid min-h-10 cursor-pointer list-none grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_auto_auto] items-center gap-2 rounded-lg px-2.5 text-sm focus-visible:outline-2 focus-visible:outline-emerald-600 sm:gap-4 sm:px-3 [&::-webkit-details-marker]:hidden">
              <span className="truncate font-semibold text-slate-900" title={customerName}>{customerName}</span>
              <span className="truncate text-slate-600" title={review.event_name}>{review.event_name}</span>
              <span className="whitespace-nowrap text-right font-semibold tabular-nums text-slate-900">{money.format(review.total_minor/100)}</span>
              <ChevronDown className="h-4 w-4 text-slate-500 group-open/review:rotate-180" aria-hidden="true" />
            </summary>
            <div className="paid-review-details border-t border-slate-200 p-2.5 text-sm">
              <div className="min-w-0 space-y-2">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="rounded-md bg-amber-50 px-2 py-0.5 font-semibold text-amber-800">
                    {review.attempt_id ? t("รอตรวจสลิป", "Awaiting review") : t("ยังไม่ส่งสลิป", "No slip submitted")}
                  </span>
                  <span className="wrap-anywhere text-slate-600">{bookingLabel} {review.booking_reference}</span>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5">
                  <p className="font-semibold text-slate-900">
                    {t(`ผู้เข้าร่วมในใบจองนี้ (${review.attendee_count} คน)`, `Attendees in this booking (${review.attendee_count})`)}
                  </p>
                  {review.attendee_names?.length ? (
                    <ol className="list-decimal pl-5 text-slate-700">
                      {review.attendee_names.map((name, index) => <li key={index} className="wrap-anywhere">{name}</li>)}
                    </ol>
                  ) : <p className="text-slate-600">{t("ไม่มีรายชื่อผู้เข้าร่วมให้แสดง", "No attendee names to display.")}</p>}
                </div>
                <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-0.5 wrap-anywhere text-slate-700 [&>dt]:text-slate-600">
                  <dt>{t("ยอดที่ต้องชำระ", "Amount due")}</dt>
                  <dd className="font-semibold">{money.format(review.total_minor / 100)}</dd>
                  {review.balance_due_minor > 0 && <><dt>{t("ยอดชำระเพิ่ม", "Additional amount due")}</dt>
                    <dd className="font-semibold">{money.format(review.balance_due_minor / 100)}</dd></>}
                  {review.proofs.length === 1 && review.claimed_minor != null && <>
                    <dt>{t("ยอดที่ลูกค้าแจ้ง", "Reported amount")}</dt>
                    <dd className={review.claimed_minor === review.total_minor ? "font-semibold text-emerald-700" : "font-semibold text-rose-700"}>
                      {money.format(review.claimed_minor / 100)}
                    </dd>
                  </>}
                  {review.proofs.length === 1 && review.claimed_transfer_ms != null && <>
                    <dt>{t("เวลาโอนที่แจ้ง", "Reported transfer time")}</dt><dd>{dateTime.format(review.claimed_transfer_ms)}</dd>
                  </>}
                  {review.created_ms != null && <>
                    <dt>{t("ส่งสลิปเมื่อ", "Slip submitted")}</dt><dd>{dateTime.format(review.created_ms)}</dd>
                  </>}
                  {review.receiver_name && <>
                    <dt>{t("บัญชีรับเงิน", "Receiving account")}</dt><dd>{review.receiver_name}</dd>
                  </>}
                  {review.proofs.length === 1 && review.claimed_payer_name && <>
                    <dt>{t("ชื่อผู้โอนที่อ่านจากสลิป", "Payer name read from the slip")}</dt><dd>{review.claimed_payer_name}</dd>
                  </>}
                  {review.proofs.length === 1 && review.claimed_reference && <>
                    <dt>{t("เลขอ้างอิงสลิป", "Slip reference")}</dt><dd>{review.claimed_reference}</dd>
                  </>}
                  <dt>{t("ผู้จอง", "Booked by")}</dt><dd className="font-semibold">{customerName}</dd>
                  <dt>{t("อีเมล", "Email")}</dt><dd>{review.customer_email}</dd>
                  <dt>{t("รหัสบัญชีลูกค้า", "Customer ID")}</dt><dd>{review.customer_id}</dd>
                  {review.customer_phone && <>
                    <dt>{t("โทรศัพท์", "Phone")}</dt><dd>{review.customer_phone}</dd>
                  </>}
                  <dt>{t("งาน", "Event")}</dt><dd>{review.event_name}</dd>
                  <dt>{t("ลงทะเบียนเมื่อ", "Booked at")}</dt><dd>{dateTime.format(review.booking_created_ms)}</dd>
                </dl>
                {onOpenCustomer && <button type="button" className={toolbarControl}
                  onClick={() => onOpenCustomer(review.customer_id)}>
                  {t("เปิดบัญชีลูกค้า", "View customer account")}
                </button>}
              </div>
              <div className="min-w-0 space-y-2">
                <div className={review.proofs.length > 1 ? "grid gap-2 sm:grid-cols-2" : ""}>
                  {review.proofs.map((proof, index) => {
                    const url = path + "/proofs/" + encodeURIComponent(proof.attempt_id);
                    const label = t(`สลิปใบที่ ${index + 1}`, `Slip ${index + 1}`);
                    return <a key={proof.attempt_id} href={url} target="_blank" rel="noopener noreferrer" className="block space-y-1">
                      <img src={url} alt={label} loading="lazy" className="max-h-56 w-full rounded-lg border border-slate-200 bg-white object-contain" />
                      <span className="font-semibold text-blue-700 underline">
                        {review.proofs.length > 1 ? label : t("เปิดภาพสลิปขนาดเต็ม", "Open full-size slip")}
                      </span>
                      {review.proofs.length > 1 && proof.claimed_minor != null && <span className="ml-2">{money.format(proof.claimed_minor / 100)}</span>}
                    </a>;
                  })}
                </div>
                {review.attempt_id && <ReviewForm key={review.version} review={review} path={path} apiFetch={apiFetch} language={language}
                  onUpdated={refreshAfterUpdate} />}
                  <details>
                    <summary className="registration-admin-control paid-slip-staff-submit cursor-pointer list-none [&::-webkit-details-marker]:hidden">
                      <UploadCloud className="h-4 w-4" aria-hidden="true" /> {review.attempt_id ? t("แนบสลิปเพิ่มแทนลูกค้า", "Add another slip for customer") : t("อัปโหลดสลิปแทนลูกค้า", "Upload slip for customer")}
                    </summary>
                    <div className="mt-2 space-y-2">
                      <p className="text-slate-600">{t("แนบภาพเพื่อส่งเข้าคิวรอตรวจ ยอดและเวลาโอนระบุภายหลังได้", "Attach the slip to send it for review. The amount and transfer time can be added later.")}</p>
                      <PaidProofForm key={review.version} staff bookingReference={review.booking_reference} locale={language} path={path} version={review.version}
                        paymentMode={review.payment_mode} totalMinor={review.balance_due_minor || review.total_minor} onSubmitted={() => {
                          setUploadedBooking(review.booking_reference);
                          refreshAfterUpdate();
                        }}
                        submitRequest={async (url, init) => {
                          const response = await apiFetch(url, init);
                          const result = await response.json().catch(() => ({}));
                          if (!response.ok) throw new Error(result.error || "proof_unavailable");
                          return result;
                        }} />
                    </div>
                  </details>
              </div>
            </div>
          </details>;
        })}</div>}
        {rows && (offset > 0 || next != null) && <div className="flex gap-2 text-sm">
          {offset > 0 && <button type="button" className={toolbarControl} onClick={() => setOffset(Math.max(0, offset - 20))}>{t("ก่อนหน้า", "Previous")}</button>}
          {next != null && <button type="button" className={toolbarControl} onClick={() => setOffset(next)}>{t("ถัดไป", "Next")}</button>}
        </div>}
      </div>}
    </section>
  );
}

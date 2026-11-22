import { PaidTransferReportExport } from "../../reports/components/PaidTransferReportExport";
import { RegistrationSectionHeader } from "./RegistrationSectionHeader";
import { PaidBookingOperations } from "./PaidBookingOperations";
import { PaidProofForm } from "../../../components/PaidProofForm";
import { useEffect, useId, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, ChevronDown, Search, SlidersHorizontal, XCircle } from "lucide-react";

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
  claimed_transfer_ms: number | null;
  claimed_reference: string | null;
  payment_mode: "promptpay" | "external_manual";
  receiver_name: string | null;
  receiver_last_four: string;
  matching_proofs: number;
  payment_state: string;
  reason: string | null;
};
type ApiFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const money = new Intl.NumberFormat(undefined, { style: "currency", currency: "THB" });
const inputClass = "mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2";
const toolbarControl = "inline-flex min-h-[34px] items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2.5 text-sm text-slate-900";

function ReviewForm({ review, path, apiFetch, onUpdated }: {
  review: Review; path: string; apiFetch: ApiFetch; onUpdated: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [bankReference, setBankReference] = useState(
    review.claimed_reference || (review.attempt_id ? "SLIP-" + review.attempt_id : ""),
  );
  const [rejectReason, setRejectReason] = useState("");
  const [showReject, setShowReject] = useState(false);
  const [showException, setShowException] = useState(false);
  const [observedAmount,setObservedAmount]=useState((review.claimed_minor ?? review.total_minor)/100);
  const [observedTime,setObservedTime]=useState(() => {
    const epoch=review.claimed_transfer_ms ?? Date.now();
    const date=new Date(epoch);
    return new Date(epoch-date.getTimezoneOffset()*60000).toISOString().slice(0,16);
  });
  const [receiver,setReceiver]=useState("");
  const command=useRef<{body:string;key:string}|undefined>(undefined);
  const canApprove=!!review.attempt_id && !!review.proof_id &&
    review.claimed_minor===review.total_minor && review.matching_proofs===0 &&
    (review.payment_mode==="external_manual" || !!receiver.trim());

  async function submit(decision:"approve"|"reject"|"flag") {
    if(busy)return;
    setError("");
    if(decision==="approve" && !bankReference.trim()) {
      setError("กรุณากรอกเลขอ้างอิงธนาคารจากสลิป เพื่อป้องกันการใช้สลิปซ้ำ");return;
    }
    const amountMinor=Math.round(observedAmount*100);
    const paidAt=new Date(observedTime);
    if(decision==="approve"&&(!Number.isSafeInteger(amountMinor)||amountMinor<1||
      !Number.isFinite(paidAt.getTime()))) {
      setError("กรุณาตรวจยอดและเวลาโอน");return;
    }
    const reason=decision==="approve"?"Verified transfer against bank records":
      rejectReason.trim()||"Proof rejected by organizer";
    const body=JSON.stringify({decision,attempt_id:review.attempt_id,version:review.version,reason,
      observed:decision==="approve"?{
        amount_minor:amountMinor,currency:"THB",paid_at:paidAt.toISOString(),
        reference:bankReference.trim(),receiver_id:review.payment_mode==="external_manual" ?
          "EXTERNAL_MANUAL":receiver.trim(),
      }:undefined,
    });
    if(command.current?.body!==body)command.current={body,key:crypto.randomUUID()};
    setBusy(true);
    try {
      const response=await apiFetch(path+"/review",{
        method:"POST",body,headers:{"Content-Type":"application/json","Idempotency-Key":command.current.key},
      });
      const result=await response.json().catch(()=>({}));
      if(!response.ok) {
        const messages:Record<string,string>={
          duplicate_reference_or_proof:"พบสลิปหรือเลขอ้างอิงซ้ำ กรุณาตรวจสอบก่อนอนุมัติ",
          receiver_mismatch:"บัญชีปลายทางไม่ตรงกับบัญชีรับเงินของรายการนี้",
          transfer_outside_hold:"เวลาโอนไม่อยู่ในช่วงเวลาที่จอง กรุณาตรวจสอบ",
          version_conflict:"รายการถูกแก้ไขแล้ว กรุณา Refresh",
        };
        setError(messages[result.error]||"บันทึกผลไม่ได้: "+(result.error||"โปรดลองใหม่"));
        return;
      }
      onUpdated();
    } catch {
      setError("ติดต่อ Server ไม่สำเร็จ กรุณาลองใหม่");
    } finally {setBusy(false);}
  }

  return <div className="space-y-3">
    {review.attempt_id && <div className="space-y-3">
      {review.claimed_minor!==review.total_minor && <p className="rounded-lg bg-amber-50 p-3 font-semibold text-amber-900">
        ยอดในสลิปไม่ตรงกับยอดจอง — กรุณาตรวจสอบก่อนอนุมัติ
      </p>}
      {review.matching_proofs>0 && <p className="rounded-lg bg-rose-50 p-3 font-semibold text-rose-800">
        พบภาพสลิปซ้ำกับรายการอื่น — ไม่ควรอนุมัติโดยไม่ตรวจสอบ
      </p>}
      <p className="text-xs font-medium text-slate-600">
        กดอนุมัติเมื่อท่านตรวจสอบเงินเข้าบัญชีธนาคารแล้วเท่านั้น
      </p>
      <details className="rounded-lg border border-slate-200 p-3">
        <summary className="cursor-pointer text-slate-600">แก้ไขยอดและเวลาโอน (เฉพาะกรณีข้อมูลผิด)</summary>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label>ยอดที่รับจริง (บาท)
            <input className={inputClass} inputMode="decimal" type="number" min="0.01"
              value={observedAmount} onChange={e=>setObservedAmount(Number(e.target.value))}/>
          </label>
          <label>วันเวลาโอน
            <input className={inputClass} type="datetime-local" value={observedTime}
              onChange={e=>setObservedTime(e.target.value)}/>
          </label>
          <label className="sm:col-span-2">เลขอ้างอิงสลิปหรือธนาคาร
            <input className={inputClass} value={bankReference} maxLength={255}
              onChange={e=>setBankReference(e.target.value)}/>
          </label>
          {review.payment_mode!=="external_manual" && <label>บัญชีผู้รับ
            <input className={inputClass} value={receiver} onChange={e=>setReceiver(e.target.value)}/>
          </label>}
        </div>
      </details>
      <button type="button" onClick={()=>void submit("approve")}
        disabled={!canApprove||busy}
        className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-5 py-3 text-base font-bold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-400">
        <CheckCircle2 className="h-5 w-5"/> {busy?"กำลังดำเนินการ…":"ยืนยันเงินเข้าและอนุมัติ / Approve"}
      </button>
      {!canApprove && <p className="text-xs text-amber-800">
        ยังไม่สามารถอนุมัติได้ เพราะยอดไม่ตรง มีหลักฐานซ้ำ หรือไม่มีสลิป กรุณาตรวจสอบก่อน
      </p>}
      <div className="flex flex-wrap gap-3 text-sm">
        <button type="button" onClick={()=>{setShowReject(v=>!v);setShowException(false);}}
          className="inline-flex items-center gap-1 font-semibold text-rose-700 underline">
          <XCircle className="h-4 w-4"/> ปฏิเสธสลิป / Reject
        </button>
        <button type="button" onClick={()=>{setShowException(v=>!v);setShowReject(false);}}
          className="inline-flex items-center gap-1 text-amber-800 underline">
          <AlertTriangle className="h-4 w-4"/> ส่งตรวจสอบเพิ่มเติม
        </button>
      </div>
      {(showReject||showException)&&<div className="space-y-2 rounded-lg bg-slate-50 p-3">
        <label className="block">หมายเหตุให้ผู้ดูแล (ถ้ามี)
          <input className={inputClass} maxLength={1000} value={rejectReason}
            onChange={e=>setRejectReason(e.target.value)} placeholder="เหตุผลการปฏิเสธ"/>
        </label>
        <button type="button" disabled={busy}
          onClick={()=>void submit(showReject?"reject":"flag")}
          className="min-h-10 rounded-lg bg-slate-800 px-4 py-2 font-semibold text-white">
          ยืนยัน{showReject?"ปฏิเสธ":"ส่งตรวจสอบ"}
        </button>
      </div>}
    </div>}
    {!review.attempt_id && <p className="text-sm text-amber-800">
      ลูกค้ายังไม่ได้ส่งสลิป — ยังไม่มีหลักฐานให้อนุมัติ
    </p>}
    {error&&<p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}
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
  const [error, setError] = useState("");
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
    setError("");
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
      }).catch(() => { if (!request.signal.aborted) setError("Could not load the review queue."); });
    return () => request.abort();
  }, [open, offset, prefix, reference, refresh, sort]);

  return (
    <section id="paid-review-queue" className="registration-admin-section registration-admin-review">
      <RegistrationSectionHeader tone="review" title="Slip Review"
        subtitle={summary
          ? t(`รอตรวจสลิป ${Number(summary.pending_review_bookings)} ใบจอง · ยังไม่ส่งสลิป ${Number(summary.awaiting_payment_attendees)} คน`,
              `${Number(summary.pending_review_bookings)} bookings to review · ${Number(summary.awaiting_payment_attendees)} attendees awaiting payment`)
          : t("ตรวจสลิปและยืนยันการชำระเงิน", "Review slips and confirm payments")} open={open} onToggle={()=>setOpen(!open)}
        actions={<button type="button" className="registration-section-refresh" onClick={showFullQueue}>{t("รีเฟรช", "Refresh")}</button>} />
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
                className={`rounded-md px-2 py-1.5 text-sm text-slate-700 ${tool === value ? "bg-slate-100 font-semibold" : ""}`}>
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
            <PaidBookingOperations eventId={eventId} apiFetch={apiFetch}
              onChange={() => setRefresh((value) => value + 1)}/>
          </div>
        </div>
        {reference && <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="break-all">{t("กำลังแสดงใบจอง", "Filtered to booking")} {reference}</span>
          <button type="button" onClick={showFullQueue} className="rounded-lg border border-slate-300 px-3 py-2 font-semibold">
            {t("กลับไปคิวทั้งหมด", "Show all reviews")}
          </button>
        </div>}
        {error && <p role="alert" className="text-red-700">{error}</p>}
        {uploadedBooking && <p role="status" className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          {t("แนบสลิปแล้ว ใบจองเข้าคิวรอตรวจ", "Slip uploaded. The booking is awaiting review.")} {uploadedBooking}
        </p>}
        {!rows && !error && <p role="status">Loading reviews…</p>}
        {rows?.length === 0 && <p>{reference ? "No payable or pending booking found for this reference." : "No payment proofs awaiting review."}</p>}
        {rows && rows.length > 0 && <div className="grid gap-1.5">{rows.map((review) => {
          const path=prefix+"/bookings/"+encodeURIComponent(review.booking_id);
          const proofUrl=review.attempt_id ? path+"/proofs/"+encodeURIComponent(review.attempt_id) : "";
          const customerName = `${review.customer_first_name} ${review.customer_last_name}`.trim() || review.customer_email;
          return <details key={review.attempt_id??review.booking_id}
            className="paid-review-item group/review rounded-lg border border-slate-200">
            <summary className="grid min-h-10 cursor-pointer list-none grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_auto_auto] items-center gap-2 rounded-lg px-2.5 text-sm focus-visible:outline-2 focus-visible:outline-emerald-600 sm:gap-4 sm:px-3 [&::-webkit-details-marker]:hidden">
              <span className="truncate font-semibold text-slate-900" title={customerName}>{customerName}</span>
              <span className="truncate text-slate-600" title={review.event_name}>{review.event_name}</span>
              <span className="whitespace-nowrap text-right font-semibold tabular-nums text-slate-900">{money.format(review.total_minor/100)}</span>
              <ChevronDown className="h-4 w-4 text-slate-500 group-open/review:rotate-180" aria-hidden="true" />
            </summary>
            <div className="space-y-3 border-t border-slate-200 p-3">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                <span className="rounded-md bg-amber-50 px-2 py-0.5 font-semibold text-amber-800">
                  {review.attempt_id ? t("รอตรวจสลิป", "Awaiting review") : t("ยังไม่ส่งสลิป", "No slip submitted")}
                </span>
                <span className="wrap-anywhere text-slate-600">{bookingLabel} {review.booking_reference}</span>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-2">
                  <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
                    <p className="font-semibold text-slate-900">
                      {t(`ผู้เข้าร่วมในใบจองนี้ (${review.attendee_count} คน)`, `Attendees in this booking (${review.attendee_count})`)}
                    </p>
                    {review.attendee_names?.length ? (
                      <ol className="mt-1 list-decimal space-y-0.5 pl-5 text-slate-700">
                        {review.attendee_names.map((name, index) => <li key={index} className="wrap-anywhere">{name}</li>)}
                      </ol>
                    ) : <p className="mt-1 text-slate-600">
                      {t("ไม่มีรายชื่อผู้เข้าร่วมให้แสดง", "No attendee names to display.")}
                    </p>}
                  </div>
                  <p className="font-semibold">ยอดที่ต้องชำระ
                    <span className="ml-2 text-lg text-slate-900">{money.format(review.total_minor/100)}</span>
                  </p>
                  {review.claimed_minor!=null && <p>ยอดที่ลูกค้าแจ้ง:
                    <strong className={review.claimed_minor===review.total_minor?"ml-2 text-emerald-700":"ml-2 text-rose-700"}>
                      {money.format(review.claimed_minor/100)}
                    </strong>
                  </p>}
                  {review.claimed_transfer_ms!=null && <p className="text-slate-600">
                    เวลาโอน: {new Date(review.claimed_transfer_ms).toLocaleString("th-TH")}
                  </p>}
                  <p className="text-slate-700">{t("เจ้าของบัญชีผู้จอง", "Booking account holder")} <strong>{customerName}</strong></p>
                  <p className="break-all text-slate-700">อีเมลลูกค้า: {review.customer_email}</p>
                  <p className="break-all text-slate-700">บัญชีลูกค้า: {review.customer_id}</p>
                  {onOpenCustomer&&<button type="button" className="rounded-lg border border-blue-300 px-3 py-2 text-sm font-semibold text-blue-700"
                    onClick={()=>onOpenCustomer(review.customer_id)}>
                    เปิดบัญชีลูกค้า / View customer account
                  </button>}
                  {review.customer_phone && <p className="text-slate-700">โทรศัพท์: {review.customer_phone}</p>}
                  <p className="text-slate-700">งาน: {review.event_name}</p>
                  <p className="text-slate-500">ลงทะเบียนเมื่อ: {new Date(review.booking_created_ms).toLocaleString("th-TH")}</p>
                  {review.created_ms != null && <p className="text-slate-500">
                    {t("ส่งสลิปเมื่อ", "Slip submitted")} {new Date(review.created_ms).toLocaleString(language === "th" ? "th-TH" : "en-GB", { timeZone: "Asia/Bangkok" })}
                  </p>}
                  {review.receiver_name && <p className="text-slate-600">บัญชีรับเงิน: {review.receiver_name}</p>}
                  {review.claimed_reference && <p className="break-all text-slate-600">
                    เลขอ้างอิง: {review.claimed_reference}</p>}
                </div>
                <div>
                  {proofUrl && review.proof_id ? <>
                    <p className="mb-2 font-semibold">ภาพสลิปที่ลูกค้าส่ง</p>
                    <a href={proofUrl} target="_blank" rel="noopener noreferrer"
                      aria-label="เปิดภาพสลิปขนาดเต็ม">
                      <img src={proofUrl} alt="Payment slip submitted by customer"
                        loading="lazy" className="max-h-80 w-full rounded-lg border border-slate-200 bg-white object-contain"/>
                    </a>
                    <a href={proofUrl} target="_blank" rel="noopener noreferrer"
                      className="mt-2 inline-block text-sm font-semibold text-blue-700 underline">
                      เปิดภาพสลิปขนาดเต็ม
                    </a>
                  </> : <p className="rounded-lg bg-amber-50 p-3 text-amber-800">
                    ยังไม่มีสลิปที่ลูกค้าอัปโหลด
                  </p>}
                </div>
              </div>
              {review.attempt_id ? <ReviewForm key={review.version} review={review} path={path} apiFetch={apiFetch}
                onUpdated={refreshAfterUpdate}/> : <details className="rounded-lg border border-slate-200 p-3">
                <summary className="cursor-pointer font-semibold text-blue-700">{t("อัปโหลดสลิปแทนลูกค้า", "Upload slip for customer")}</summary>
                <div className="mt-3 space-y-2">
                  <p className="text-sm text-slate-600">{t("แนบภาพที่ลูกค้าส่งมาและกรอกยอดกับเวลาโอนตามสลิป รายการจะเข้าคิวรอตรวจ", "Attach the customer's slip and enter the amount and transfer time shown. The booking will enter the review queue.")}</p>
                  <PaidProofForm key={review.version} staff locale={language} path={path} version={review.version}
                    paymentMode={review.payment_mode} totalMinor={review.total_minor} onSubmitted={() => {
                      setUploadedBooking(review.booking_reference);
                      refreshAfterUpdate();
                    }}
                    submitRequest={async (url, init) => {
                      const response = await apiFetch(url, init);
                      if (!response.ok) {
                        const result = await response.json().catch(() => ({}));
                        throw new Error(result.error || "proof_unavailable");
                      }
                    }}/>
                </div>
              </details>}
            </div>
          </details>;
        })}</div>}
        {rows && (offset > 0 || next != null) && <div className="flex gap-4 text-sm">
          {offset > 0 && <button type="button" className="underline" onClick={() => setOffset(Math.max(0, offset - 20))}>{t("ก่อนหน้า", "Previous")}</button>}
          {next != null && <button type="button" className="underline" onClick={() => setOffset(next)}>{t("ถัดไป", "Next")}</button>}
        </div>}
      </div>}
    </section>
  );
}

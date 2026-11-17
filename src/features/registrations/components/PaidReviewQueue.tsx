import { RegistrationSectionHeader } from "./RegistrationSectionHeader";
import { PaidBookingOperations } from "./PaidBookingOperations";
import { useEffect, useRef, useState } from "react";
import { CheckCircle2, XCircle, AlertTriangle } from "lucide-react";

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
  due_ms: number;
  version: number;
  total_minor: number;
  attendee_count: number;
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

export function PaidReviewQueue({ eventId, apiFetch, onOpenCustomer,focusBookingReference }: {
  eventId: string; apiFetch: ApiFetch; onOpenCustomer?:(customerId:string)=>void;
  focusBookingReference?:string;
}) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Review[]>();
  const [error, setError] = useState("");
  const [offset, setOffset] = useState(0);
  const [reference, setReference] = useState("");
  const [summary, setSummary] = useState<Record<string, string | number>>();
  const [summaryError, setSummaryError] = useState(false);
  const [next, setNext] = useState<number | null>(null);
  const [refresh, setRefresh] = useState(0);
  useEffect(()=>{
    if(!focusBookingReference)return;
    setOpen(true);setReference(focusBookingReference);setOffset(0);
  },[focusBookingReference,eventId]);
  const fetchRef = useRef(apiFetch);
  fetchRef.current = apiFetch;
  const prefix = `/api/events/${encodeURIComponent(eventId)}/paid-registration`;

  useEffect(() => {
    if (!open) return;
    const request = new AbortController();
    setSummaryError(false);
    void fetchRef.current(`${prefix}/summary`, { signal: request.signal }).then(async (response) => {
      if (!response.ok) throw new Error();
      const result = await response.json();
      if (!request.signal.aborted) setSummary(result.summary ?? undefined);
    }).catch(() => { if (!request.signal.aborted) setSummaryError(true); });
    return () => request.abort();
  }, [open, prefix, refresh]);

  useEffect(() => {
    if (!open) return;
    const request = new AbortController();
    setRows(undefined);
    setError("");
    const params = new URLSearchParams({ offset: String(offset) });
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
  }, [open, offset, prefix, reference, refresh]);

  return (
    <section id="paid-review-queue" className="registration-admin-section registration-admin-review">
      <RegistrationSectionHeader tone="review" title="Slip Review"
        subtitle="ตรวจสลิป · ยืนยันการชำระเงิน" open={open} onToggle={()=>setOpen(!open)}
        actions={<button type="button" className="registration-section-refresh" onClick={()=>setRefresh((value)=>value+1)}>Refresh</button>} />
      {open && <div className="registration-section-content space-y-3">
        {summaryError && <p role="alert" className="text-red-700">Could not load the registration totals.</p>}
        {summary && <div className="flex flex-wrap gap-2 text-sm">
          <span className="rounded-lg bg-amber-50 px-3 py-2 font-bold text-amber-800">
            รอตรวจสลิป {summary.pending_review_bookings ?? 0} รายการ
          </span>
          <span className="rounded-lg bg-emerald-50 px-3 py-2 font-semibold text-emerald-800">
            ยืนยันแล้ว {summary.confirmed_bookings ?? 0} รายการ
          </span>
          <span className="rounded-lg bg-slate-100 px-3 py-2 text-slate-700">
            ผู้เข้าร่วม {summary.attendees ?? 0} คน
          </span>
        </div>}
        <details className="rounded-lg border border-slate-200 p-3">
          <summary className="cursor-pointer text-slate-600">เครื่องมือจัดการ Booking เพิ่มเติม</summary>
          <PaidBookingOperations eventId={eventId} apiFetch={apiFetch}
            onChange={() => setRefresh((value) => value + 1)}/>
        </details>
        <form className="flex flex-wrap items-end gap-2" onSubmit={(event) => {
          event.preventDefault();
          setReference(String(new FormData(event.currentTarget).get("reference") || "").trim());
          setOffset(0);
          setRefresh((value) => value + 1);
        }}>
          <label>Booking reference<input name="reference" className={inputClass} maxLength={36} /></label>
          <button type="submit" className="rounded-lg border border-slate-300 px-3 py-2">Find booking</button>
        </form>
        {error && <p role="alert" className="text-red-700">{error}</p>}
        {!rows && !error && <p role="status">Loading reviews…</p>}
        {rows?.length === 0 && <p>{reference ? "No payable or pending booking found for this reference." : "No payment proofs awaiting review."}</p>}
        {rows?.map((review) => {
          const path=prefix+"/bookings/"+encodeURIComponent(review.booking_id);
          const proofUrl=review.attempt_id ? path+"/proofs/"+encodeURIComponent(review.attempt_id) : "";
          return <details key={review.attempt_id??review.booking_id}
            className="rounded-xl border border-slate-200 bg-white p-3" open={undefined}>
            <summary className="cursor-pointer list-item space-y-1 text-sm">
              <span className="block font-bold text-slate-900">
                {review.customer_first_name} {review.customer_last_name}
              </span>
              <span className="block text-xs text-slate-700">{review.customer_email}</span>
              <span className="inline-flex gap-2 text-xs">
                <span className="text-blue-700">บัญชีลูกค้า: {review.customer_id}</span>
              </span>
              <span className="block text-xs text-slate-600">งาน: {review.event_name}</span>
              <span className="font-semibold text-slate-900">
                {review.attendee_count} คน · ยอดจอง {money.format(review.total_minor/100)}
              </span>
              <span className="ml-2 rounded-md bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-800">
                {review.attempt_id?"รอตรวจสลิป":"ยังไม่ส่งสลิป"}
              </span>
              <span className="block break-all text-xs text-slate-500">
                เลขจอง {review.booking_reference} · จองเมื่อ {new Date(review.booking_created_ms).toLocaleString("th-TH")}
              </span>
            </summary>
            <div className="mt-3 space-y-3 border-t border-slate-200 pt-3">
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-2">
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
                  <p className="text-slate-700">ผู้จอง: <strong>{review.customer_first_name} {review.customer_last_name}</strong></p>
                  <p className="break-all text-slate-700">บัญชีลูกค้า: {review.customer_email}</p>
                  {onOpenCustomer&&<button type="button" className="rounded-lg border border-blue-300 px-3 py-2 text-sm font-semibold text-blue-700"
                    onClick={()=>onOpenCustomer(review.customer_id)}>
                    เปิดบัญชีลูกค้า / View customer account
                  </button>}
                  {review.customer_phone && <p className="text-slate-700">โทรศัพท์: {review.customer_phone}</p>}
                  <p className="text-slate-700">งาน: {review.event_name}</p>
                  <p className="text-slate-500">ลงทะเบียนเมื่อ: {new Date(review.booking_created_ms).toLocaleString("th-TH")}</p>
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
              <ReviewForm key={review.version} review={review} path={path} apiFetch={apiFetch}
                onUpdated={()=>{setOffset(0);setRefresh(v=>v+1);
                  window.dispatchEvent(new Event("meetrix:paid-booking-updated"));}}/>
            </div>
          </details>;
        })}
        {rows && <div className="flex gap-4">
          {offset > 0 && <button type="button" className="underline" onClick={() => setOffset(Math.max(0, offset - 20))}>Previous</button>}
          {next != null && <button type="button" className="underline" onClick={() => setOffset(next)}>Next</button>}
        </div>}
      </div>}
    </section>
  );
}

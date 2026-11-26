import { AttendeePhoneEditor } from "../../../components/AttendeePhoneEditor";
import { PaidTransferReportExport } from "../../reports/components/PaidTransferReportExport";
import { RegistrationSectionHeader } from "./RegistrationSectionHeader";
import { getRosterStatus, RegistrationStatusTag } from "./RegistrationStatusTag";
import { PaidBookingOperations, type BookingEditRequest } from "./PaidBookingOperations";
import { PaidProofForm } from "../../../components/PaidProofForm";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { AlertTriangle, CheckCircle2, ChevronDown, FileCheck, FileClock, FileMinus, FileX, Flag, FlagOff, Send, Search, SlidersHorizontal, UploadCloud, XCircle, Maximize2, ZoomIn, ZoomOut, X } from "lucide-react";

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
  attendees: { id: string; name: string; category_label: string; unit_minor: number; price_flagged?: boolean; phone?: string }[];
  claimed_minor: number | null;
  proof_id: string | null;
  balance_due_minor: number;
  coupon_code?: string | null;
  coupon_discount_minor?: number | null;
  booking_state: string;
  cash_confirmed: boolean;
  amount_mismatch?:boolean; payment_warning?:boolean;
  previous_proofs: { attempt_id: string; status: string; observed_minor: number | null; claimed_minor: number | null; supporting?: boolean }[];
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

function SlipImage({url,label,language}:{url:string;label:string;language:"th"|"en"}){
 const t=(th:string,en:string)=>language==="th"?th:en;
 const dialog=useRef<HTMLDialogElement>(null);
 const [zoom,setZoom]=useState(1);
 const [failed,setFailed]=useState(false);
 return <div className="paid-slip-preview">
  <button type="button" className="paid-slip-image-button" onClick={()=>{setZoom(1);dialog.current?.showModal();}} aria-label={t("ขยายภาพสลิป","Enlarge slip")}>
    {!failed?<img src={url} alt={label} loading="lazy" onError={()=>setFailed(true)}/>:<span>{t("โหลดภาพไม่สำเร็จ","Image unavailable")}</span>}
  </button>
  <div className="flex flex-wrap items-center justify-between gap-2 p-2">
   <button type="button" className="registration-admin-control" onClick={()=>{setZoom(1);dialog.current?.showModal();}}><Maximize2 size={16}/>{t("ขยายเต็มหน้าจอ","Full screen")}</button>
   <a href={url} target="_blank" rel="noopener noreferrer" className="text-sm font-semibold text-blue-700 underline">{t("เปิดภาพต้นฉบับ","Original image")}</a>
  </div>
  <dialog ref={dialog} className="paid-slip-dialog" onClick={e=>{if(e.target===e.currentTarget)dialog.current?.close();}}>
   <div className="paid-slip-dialog-inner">
    <div className="paid-slip-dialog-toolbar"><strong>{label}</strong><div className="flex flex-wrap items-center gap-2">
      <button type="button" className="registration-admin-control" aria-label={t("ย่อภาพ","Zoom out")} onClick={()=>setZoom(z=>Math.max(1,z-.25))} disabled={zoom<=1}><ZoomOut size={18}/></button>
      <button type="button" className="registration-admin-control" onClick={()=>setZoom(1)}>{Math.round(zoom*100)}%</button>
      <button type="button" className="registration-admin-control" aria-label={t("ขยายภาพ","Zoom in")} onClick={()=>setZoom(z=>Math.min(4,z+.25))} disabled={zoom>=4}><ZoomIn size={18}/></button>
      <button type="button" className="registration-admin-control" onClick={()=>dialog.current?.close()} autoFocus><X size={18}/>{t("ปิด","Close")}</button>
    </div></div>
    <div className="paid-slip-dialog-scroll"><img src={url} alt={label} loading="lazy" style={{width:zoom===1?"auto":(zoom*100)+"%",maxWidth:zoom===1?"100%":"none",maxHeight:zoom===1?"calc(100dvh - 100px)":"none"}}/></div>
   </div>
  </dialog>
 </div>;
}

function CorrectSlipAmount({attemptId,amount,version,path,apiFetch,language,onUpdated,verified=false}:{attemptId:string;amount:number|null;version:number;path:string;apiFetch:ApiFetch;language:"th"|"en";onUpdated:()=>void;verified?:boolean}){
 const t=(th:string,en:string)=>language==="th"?th:en;
 const [value,setValue]=useState(amount==null?"":(amount/100).toFixed(2));
 const [reason,setReason]=useState("");const [busy,setBusy]=useState(false);const [error,setError]=useState("");
 const command=useRef<{body:string;key:string}|undefined>(undefined);
 async function submit(e:FormEvent<HTMLFormElement>){
  e.preventDefault();if(busy||!reason.trim()||!/^\d+(?:\.\d{1,2})?$/.test(value))return;
  const minor=Math.round(Number(value)*100);if(!Number.isSafeInteger(minor)||minor<=0)return;
  if(!window.confirm(t("ยืนยันยอดเงินจริงตามภาพสลิปและรายการเงินเข้าธนาคาร?","Confirm actual transfer amount against the slip and bank records?")))return;
  const body=JSON.stringify({action:"correct_slip_amount",attempt_id:attemptId,version,slip_amount_minor:minor,reason});
  if(command.current?.body!==body)command.current={body,key:crypto.randomUUID()};
  setBusy(true);setError("");
  try{const res=await apiFetch(path+"/manage",{method:"POST",headers:{"Content-Type":"application/json","Idempotency-Key":command.current.key},body});const result=await res.json();if(!res.ok)throw Error(result.error);onUpdated();}
  catch(e){const code=(e as Error).message;setError(code==="amount_exceeds_total"?t("ยอดเกินยอดใบจอง กรุณาตรวจการจัดสรรเงินก่อน","Amount exceeds the booking total; check allocation first."):code==="multiple_verified_payments"?t("มีหลายสลิปที่อนุมัติร่วมกัน ต้องตรวจการจัดสรรก่อน","Combined payments require separate allocation review."):t("บันทึกไม่สำเร็จ กรุณาโหลดข้อมูลและตรวจสถานะอีกครั้ง","Could not save. Refresh and verify booking status."));}
  finally{setBusy(false);}
 }
 return <details className="mt-2 rounded-lg border border-slate-300 p-2"><summary className="cursor-pointer font-semibold text-blue-700">{t("แก้ยอดเงินในสลิป","Correct slip amount")}</summary><form className="mt-2 space-y-2" onSubmit={submit}>
 <p className="text-xs">{verified?t("แก้ยอดรับเงินจริงที่อนุมัติแล้ว โดยคงภาพสลิปและ QR เดิม","Correct recorded verified cash while preserving the slip image and QR passes."):t("แก้ยอดที่อ่านจากสลิป ก่อนอนุมัติ","Correct the recorded slip amount before approval.")}</p>
 <label className="block">{t("ยอดเงินจริง (บาท)","Actual amount (THB)")}<input className={inputClass} type="number" min="0.01" step="0.01" required value={value} onChange={e=>setValue(e.target.value)}/></label>
 <label className="block">{t("เหตุผลที่แก้ไข","Correction reason")}<textarea className={inputClass} required maxLength={1000} value={reason} onChange={e=>setReason(e.target.value)}/></label>
 <button type="submit" disabled={busy||!reason.trim()} className="registration-admin-control registration-admin-control-primary">{t("บันทึกยอดสลิปที่ถูกต้อง","Save corrected slip amount")}</button>{error&&<p role="alert" className="text-rose-700">{error}</p>}</form></details>;
}

function RevokeSlip({attemptId,version,path,apiFetch,language,onUpdated}:{attemptId:string;version:number;path:string;apiFetch:ApiFetch;language:"th"|"en";onUpdated:()=>void}) {
  const t=(th:string,en:string)=>language==="th"?th:en;
  const [open,setOpen]=useState(false);const [busy,setBusy]=useState(false);const [error,setError]=useState("");
  const [reason,setReason]=useState("");const [minutes,setMinutes]=useState(1440);
  const command=useRef<{body:string;key:string}|null>(null);
  async function submit(){
    if(busy||!reason.trim()||!Number.isInteger(minutes)||minutes<5||minutes>43200)return;
    if(!window.confirm(t("ยกเลิกการอนุมัติ ลบภาพสลิปผิด และเพิกถอน QR เดิม? ไม่มีการโอนเงินคืน","Revoke approval, remove the incorrect slip image and revoke existing QR passes? No money will be refunded.")))return;
    setBusy(true);setError("");
    const body=JSON.stringify({action:"revoke_slip",attempt_id:attemptId,version,reason,hold_minutes:minutes});
    if(command.current?.body!==body)command.current={body,key:crypto.randomUUID()};
    try{
      const response=await apiFetch(path+"/manage",{method:"POST",headers:{"Content-Type":"application/json","Idempotency-Key":command.current!.key},body});
      const result=await response.json();if(!response.ok)throw Error(result.error);
      setOpen(false);onUpdated();
    }catch(e){
      const code=(e as Error).message;
      setError(code==="already_checked_in"?t("มีผู้เช็กอินแล้ว ไม่สามารถยกเลิกได้","An attendee has checked in; reversal is blocked."):code==="multiple_verified_payments"?t("ใบจองมีหลายยอดที่อนุมัติแล้ว ต้องตรวจสอบแยกรายการก่อน","Multiple verified payments exist; review them separately before reversal."):code==="version_conflict"?t("ข้อมูลเปลี่ยนแล้ว กรุณาโหลดใหม่","Booking changed. Reload and retry."):t("ยกเลิกไม่สำเร็จ กรุณาตรวจสอบสถานะล่าสุด","Reversal failed. Check current booking status."));
    }finally{setBusy(false);}
  }
  return <div className="mt-1"><button type="button" className="registration-admin-control text-rose-700" disabled={busy} onClick={()=>setOpen(!open)}><XCircle size={14}/>{t("ยกเลิกอนุมัติและลบสลิปผิด","Revoke approval & remove slip")}</button>{open&&<div className="mt-2 space-y-2 rounded-lg border border-rose-300 p-3">
    <p className="text-xs">{t("คืนสถานะรอชำระเงิน (หรือรอตรวจหากมีสลิปอื่น) และคงรายชื่อเดิม ไม่คืนเงินอัตโนมัติ","Return to unpaid (or pending review if other slips remain), retain attendees, and do not issue a refund.")}</p>
    <label className="block text-xs">{t("เหตุผล","Reason")}<textarea className={inputClass} rows={2} maxLength={1000} value={reason} disabled={busy} onChange={e=>setReason(e.target.value)}/></label>
    <label className="block text-xs">{t("เปิดเวลาชำระใหม่อย่างน้อย (นาที)","Minimum renewed payment window (minutes)")}<input className={inputClass} type="number" min={5} max={43200} value={minutes} disabled={busy} onChange={e=>setMinutes(Number(e.target.value))}/></label>
    <button type="button" className="registration-admin-control text-rose-700" disabled={busy||!reason.trim()||minutes<5||minutes>43200} onClick={()=>void submit()}>{t("ยืนยันยกเลิกอนุมัติ","Confirm reversal")}</button>
    {error&&<p role="alert" className="text-sm text-rose-700">{error}</p>}
  </div>}</div>;
}

function SlipStatus({ review, language }: { review: Review; language: "th" | "en" }) {
  const hasPendingSlip = review.proofs.length > 0;
  const hasVerifiedSlip = review.previous_proofs.some(proof=>proof.status==="verified");
  const rejectedOnly = review.previous_proofs.length>0&&review.previous_proofs.every(proof=>proof.status==="rejected");
  const [Icon,tone,th,en] = hasPendingSlip ? [FileClock,"pending","รอตรวจสลิป","Review slip"]
    : hasVerifiedSlip ? [FileCheck,"verified","ตรวจสลิปแล้ว","Slip verified"]
    : rejectedOnly ? [FileX,"rejected","สลิปถูกปฏิเสธ","Slip rejected"]
    : [FileMinus,"missing","ไม่มีสลิป","No slip"];
  const label=language==="th"?th:en;
  return <span className="registration-slip-state" data-slip-tone={tone}><Icon size={14}/>{label}</span>;
}

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

  const supporting = review.booking_state === "confirmed" && review.balance_due_minor === 0;
  return <div className="space-y-2 text-sm">
    {review.attempt_id && <div className="space-y-2">
      {!supporting && reported != null && reported !== (review.balance_due_minor || review.total_minor) && <p className="rounded-lg bg-amber-50 p-3 font-semibold text-amber-900">
        {t("ยอดที่แจ้งต่างจากยอดจอง กรุณาเทียบกับยอดในภาพสลิป", "The reported amount differs from the booking total. Check the slip image.")}
      </p>}
      {hasDuplicates && <p className="rounded-lg bg-rose-50 p-3 font-semibold text-rose-800">
        {t("พบภาพสลิปซ้ำกับรายการอื่น — ไม่ควรอนุมัติโดยไม่ตรวจสอบ", "This slip matches another booking. Check the duplicate before approving.")}
      </p>}
      <p className="text-xs font-medium text-slate-600">
        {supporting ? t("แนบไว้เป็นหลักฐานประกอบใบจอง", "Keep this slip as supporting evidence.") : t("กดอนุมัติเมื่อท่านตรวจสอบเงินเข้าบัญชีธนาคารแล้วเท่านั้น", "Confirm the deposit in the bank account before approving.")}
      </p>
      <div className="flex flex-wrap gap-1.5">
        <button type="button" onClick={() => void submit("approve")} disabled={!canApprove || busy}
          className="registration-admin-control registration-admin-control-primary">
          <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> {busy ? t("กำลังบันทึก…", "Saving…") : supporting ? t("รับเป็นหลักฐานเพิ่ม", "Accept supporting evidence") : review.proofs.length > 1 ? t("อนุมัติสลิปทั้งหมด", "Approve all slips") : t("อนุมัติ", "Approve")}
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

function ApplySupportingSlip({ attemptId, claimedMinor, balance, version, path, apiFetch, language, onUpdated }: {
  attemptId: string; claimedMinor: number | null; balance: number; version: number; path: string;
  apiFetch: ApiFetch; language: "th" | "en"; onUpdated: () => void;
}) {
  const t = (th: string, en: string) => language === "th" ? th : en;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const command = useRef<{ body: string; key: string } | undefined>(undefined);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const amountMinor = Math.round(Number(new FormData(event.currentTarget).get("amount")) * 100);
    if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0 || amountMinor > balance) return;
    const body = JSON.stringify({ decision: "apply_supporting", attempt_id: attemptId, version, balance_amount_minor: amountMinor,
      reason: "Confirmed transfer in bank records and applied it to the balance" });
    if (command.current?.body !== body) command.current = { body, key: crypto.randomUUID() };
    setBusy(true);
    setError("");
    try {
      const response = await apiFetch(path + "/review", {
        method: "POST", body, headers: { "Content-Type": "application/json", "Idempotency-Key": command.current.key },
      });
      if (response.ok) {
        onUpdated();
        return;
      }
      const result = await response.json().catch(() => ({}));
      setError(result.error === "version_conflict"
        ? t("ใบจองมีการเปลี่ยนแปลง กรุณากดโหลดใหม่", "The booking changed. Refresh and try again.")
        : t("อนุมัติสลิปนี้ไม่ได้ กรุณาโหลดใบจองใหม่เพื่อตรวจยอดค้างและสถานะสลิป", "Could not apply this slip. Refresh to check its status and the current balance."));
    } catch {
      setError(t("ติดต่อระบบไม่สำเร็จ กรุณาลองใหม่", "Could not reach the server. Try again."));
    } finally {
      setBusy(false);
    }
  }

  return <details className="mt-1 rounded-md border border-slate-200 p-2">
    <summary className="cursor-pointer font-semibold text-blue-700">
      {t("อนุมัติสลิปนี้เข้ายอดค้าง", "Approve this slip toward the balance")}
    </summary>
    <form onSubmit={submit} className="mt-2 space-y-2">
      <label className="block max-w-64">{t("ยอดที่ตรวจแล้ว (บาท)", "Verified transfer amount (THB)")}
        <input className={inputClass} type="number" name="amount" min="0.01" max={balance / 100} step="0.01" required
          defaultValue={claimedMinor != null && claimedMinor > 0 && claimedMinor <= balance ? claimedMinor / 100 : undefined} />
      </label>
      <p className="text-xs text-slate-600">
        {t("ตรวจว่ายอดเงินเข้าบัญชีแล้วก่อนกดอนุมัติ", "Confirm this transfer in the bank account before approving.")}
      </p>
      <button type="submit" disabled={busy} className={`${toolbarControl} registration-admin-control-primary`}>
        {busy ? t("กำลังบันทึก…", "Saving…") : t("ยืนยันการอนุมัติ", "Confirm approval")}
      </button>
      {error && <p role="alert" className="text-rose-800">{error}</p>}
    </form>
  </details>;
}

export function PaidReviewQueue({ language, eventId, apiFetch, onOpenCustomer, focusBookingReference, focusBookingEditor, onFocusConsumed, summary, summaryError, onSummaryRefresh }: {
  eventId: string; apiFetch: ApiFetch; onOpenCustomer?:(customerId:string)=>void;
  focusBookingReference?:string;
  focusBookingEditor?: boolean;
  onFocusConsumed: () => void;
  summary?: Record<string, unknown> | null;
  summaryError: boolean;
  onSummaryRefresh: () => void;
  language: "th" | "en";
}) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Review[]>();
  const [loadedReference, setLoadedReference] = useState("");
  const [loadFailed, setLoadFailed] = useState(false);
  const [offset, setOffset] = useState(0);
  const [uploadedBooking, setUploadedBooking] = useState("");
  const [reference, setReference] = useState("");
  const [referenceDraft, setReferenceDraft] = useState("");
  const [next, setNext] = useState<number | null>(null);
  const [sort, setSort] = useState<"asc" | "desc">("desc");
  const [toolsOpen, setToolsOpen] = useState(false);
  const [tool, setTool] = useState<"download" | "dashboard" | null>(null);
  const [refresh, setRefresh] = useState(0);
  const toolsId = useId();
  const sectionRef = useRef<HTMLElement>(null);
  const scrollToBooking = useRef(false);
  const [editingBooking, setEditingBooking] = useState("");
  const [editRequest, setEditRequest] = useState<{ reference: string; request: BookingEditRequest }>();
  const [flagBusy, setFlagBusy] = useState("");
  const [flagError, setFlagError] = useState<{ reference: string; text: string }>();
  const t = (th: string, en: string) => language === "th" ? th : en;
  const locale = language === "th" ? "th-TH" : "en-GB";
  const money = new Intl.NumberFormat(locale, { style: "currency", currency: "THB" });
  const dateTime = new Intl.DateTimeFormat(locale, {
    dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Bangkok",
  });
  const bookingLabel = t("เลขอ้างอิงใบจอง", "Booking reference");
  useEffect(()=>{
    if(focusBookingReference === undefined)return;
    setOpen(true);
    setReference(focusBookingReference);
    setReferenceDraft(focusBookingReference);
    setOffset(0);
    setToolsOpen(false);
    setEditingBooking(focusBookingEditor ? focusBookingReference : "");
    setEditRequest(undefined);
    scrollToBooking.current = true;
    onFocusConsumed();
  },[focusBookingReference,focusBookingEditor,eventId]);
  const fetchRef = useRef(apiFetch);
  fetchRef.current = apiFetch;
  const prefix = `/api/events/${encodeURIComponent(eventId)}/paid-registration`;

  // Poll the event's own summary even while this section is collapsed, independently of notification settings.
  const [liveSummary,setLiveSummary]=useState<{eventId:string;pending:number;warnings:number}|null>(null);
  const [summaryUnavailable,setSummaryUnavailable]=useState(false);
  useEffect(()=>{
    const controller=new AbortController();let inFlight=false;
    async function load(){
      if(inFlight||controller.signal.aborted)return;
      inFlight=true;
      try{
        const response=await fetchRef.current(prefix+"/summary",{signal:controller.signal,cache:"no-store"});
        if(!response.ok)throw Error("summary");
        const result=await response.json();const data=result.summary??result;
        if(!controller.signal.aborted){
          setLiveSummary({eventId,pending:Number(data.pending_review_bookings??0),warnings:Number(data.warning_bookings??0)});setSummaryUnavailable(false);
        }
      }catch{if(!controller.signal.aborted)setSummaryUnavailable(true);}finally{inFlight=false;}
    }
    void load();
    const timer=window.setInterval(()=>{if(document.visibilityState==="visible")void load();},15000);
    window.addEventListener("focus",load);window.addEventListener("meetrix:paid-booking-updated",load);
    return()=>{controller.abort();window.clearInterval(timer);window.removeEventListener("focus",load);window.removeEventListener("meetrix:paid-booking-updated",load);};
  },[prefix,eventId,refresh]);
  const localSummary=liveSummary?.eventId===eventId?liveSummary:null;
  const pendingCount=localSummary?.pending??Number(summary?.pending_review_bookings??0);
  const warningCount=localSummary?.warnings??Number(summary?.warning_bookings??0);

  function showFullQueue() {
    setUploadedBooking("");
    setRows(undefined);
    setReference("");
    setReferenceDraft("");
    setOffset(0);
    onFocusConsumed();
    setRefresh((value) => value + 1);
  }

  function refreshAfterUpdate(bookingReference: string) {
    setReference(bookingReference);
    setReferenceDraft(bookingReference);
    setOffset(0);
    setRefresh((value) => value + 1);
    window.dispatchEvent(new Event("meetrix:paid-booking-updated"));
  }

  function openEditor(bookingReference: string, request: BookingEditRequest) {
    setEditingBooking(bookingReference);
    setEditRequest({ reference: bookingReference, request });
  }

  async function updatePriceFlag(review: Review, attendeeId: string, clear: boolean) {
    if (flagBusy) return;
    setFlagBusy(attendeeId);
    setFlagError(undefined);
    try {
      const result = await apiFetch(`${prefix}/bookings/${encodeURIComponent(review.booking_id)}/manage`, {
        method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ attendee_id: attendeeId, version: review.version, action: clear ? "clear_price_flag" : "flag_price",
          reason: clear ? "Price flag cleared by staff" : "Attendee price flagged for correction" }),
      });
      if (!result.ok) {
        const body = await result.json().catch(() => ({}));
        if (body.error === "version_conflict") {
          refreshAfterUpdate(review.booking_reference);
          throw new Error(t("ใบจองมีการเปลี่ยนแปลง ระบบโหลดใหม่แล้ว ให้ลองอีกครั้ง", "The booking changed. It has been refreshed. Try again."));
        }
        throw new Error(t("บันทึกธงราคาไม่สำเร็จ", "Could not save the price flag."));
      }
      if (!clear) openEditor(review.booking_reference, { action: "correct_price", attendeeId });
      refreshAfterUpdate(review.booking_reference);
    } catch (error) {
      setFlagError({ reference: review.booking_reference, text: error instanceof Error ? error.message : t("บันทึกธงราคาไม่สำเร็จ", "Could not save the price flag.") });
    } finally {
      setFlagBusy("");
    }
  }

  useEffect(() => {
    if (refresh > 0) onSummaryRefresh();
  }, [refresh]);

  useEffect(() => {
    if (!open) return;
    const request = new AbortController();
    setLoadFailed(false);
    const params = new URLSearchParams({ offset: String(offset), sort });
    if (reference) params.set("reference", reference);
    void fetchRef.current(`${prefix}/review-queue?${params}`, { signal: request.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error();
        const result = await response.json();
        if (!request.signal.aborted) {
          setRows(result.reviews);
          setLoadedReference(reference);
          setNext(result.next_offset);
          if (scrollToBooking.current) {
            scrollToBooking.current = false;
            sectionRef.current?.scrollIntoView({ block: "start" });
          }
        }
      }).catch(() => { if (!request.signal.aborted) setLoadFailed(true); });
    return () => request.abort();
  }, [open, offset, prefix, reference, refresh, sort]);

  const matchingRows = reference ? rows?.filter(row => row.booking_reference === reference) : rows;
  const visibleRows = loadedReference === reference || matchingRows?.length ? matchingRows : undefined;
  return (
    <section id="paid-review-queue" ref={sectionRef} className="registration-admin-section registration-admin-review scroll-mt-20">
      <RegistrationSectionHeader tone="review" title={t("ใบจองและตรวจสลิป", "Bookings & Slip Review")}
        subtitle={summary
          ? t(`รอตรวจสลิป ${pendingCount} ใบจอง · ยังไม่ส่งสลิป ${Number(summary.awaiting_payment_attendees)} คน`,
              `${pendingCount} bookings to review · ${Number(summary.awaiting_payment_attendees)} attendees awaiting payment`)
          : t("ตรวจสลิปและยืนยันการชำระเงิน", "Review slips and confirm payments")} open={open} onToggle={()=>setOpen(!open)}
        indicators={<>{pendingCount>0&&<span className="registration-slip-state" data-slip-tone="pending"><FileClock size={15}/>{pendingCount} {t("รอตรวจ","to review")}</span>}{warningCount>0&&<span className="registration-payment-flag"><Flag size={14} fill="currentColor"/>{warningCount} {t("มีปัญหา","flagged")}</span>}{summaryUnavailable&&<span className="text-xs text-rose-700">{t("ข้อมูลอาจไม่ล่าสุด","Refresh unavailable")}</span>}</>}
        actions={<button type="button" className={toolbarControl} onClick={() => setRefresh(value => value + 1)}>{t("โหลดใหม่", "Refresh")}</button>} />
      {open && <div className="registration-section-content space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <form className={`flex min-w-0 items-center gap-1.5 ${reference ? "flex-[1_1_18rem] sm:max-w-lg" : "flex-[1_1_8rem] sm:max-w-xs"}`} onSubmit={(event) => {
            event.preventDefault();
            setRows(undefined);
            setReference(referenceDraft.trim().toLowerCase());
            setOffset(0);
            setRefresh((value) => value + 1);
          }}>
            <input name="reference" aria-label={bookingLabel} placeholder={bookingLabel}
              className={`${toolbarControl} min-w-0 flex-1`} maxLength={36}
              value={referenceDraft} onChange={(event) => setReferenceDraft(event.target.value)} />
            <button type="submit" aria-label={t("ค้นหาใบจอง", "Find booking")} className={toolbarControl}>
              <Search className="h-4 w-4" aria-hidden="true" />
            </button>
            {reference && <button type="button" onClick={showFullQueue}
              className={`${toolbarControl} registration-admin-control-primary shrink-0 whitespace-nowrap`}>
              {t("กลับไปคิวทั้งหมด", "Show all reviews")}
            </button>}
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
        </div>
        {loadFailed && <p role="alert" className="text-red-700">{t("โหลดคิวตรวจสลิปไม่สำเร็จ", "Could not load the review queue.")}</p>}
        {uploadedBooking && <p role="status" className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          {t("แนบสลิปแล้ว ใบจองเข้าคิวรอตรวจ", "Slip uploaded. The booking is awaiting review.")} {uploadedBooking}
        </p>}
        {!visibleRows && !loadFailed && <p role="status">{t("กำลังโหลดคิวตรวจสลิป…", "Loading reviews…")}</p>}
        {visibleRows?.length === 0 && <p>{reference
          ? t("ไม่พบใบจองสำหรับเลขอ้างอิงนี้", "No booking found for this reference.")
          : t("ไม่มีสลิปรอตรวจ", "No payment slips awaiting review.")}</p>}
        {visibleRows && visibleRows.length > 0 && <div className="grid gap-1.5">{visibleRows.map((review) => {
          const path=prefix+"/bookings/"+encodeURIComponent(review.booking_id);
          const customerName = `${review.customer_first_name} ${review.customer_last_name}`.trim() || review.customer_email;
          const canUpload = review.booking_state === "awaiting_payment" ||
            review.booking_state === "verification_pending" || review.cash_confirmed || review.balance_due_minor > 0;
          const hasFlag = review.payment_warning || review.attendees.some(attendee => attendee.price_flagged);
          const bookingStatus = getRosterStatus(review.booking_state);
          return <details key={review.booking_id} open={reference ? true : undefined}
            className="paid-review-item group/review rounded-lg border border-slate-200" data-payment-warning={hasFlag?"true":undefined}>
            <summary className="grid min-h-10 cursor-pointer list-none grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_auto_auto] items-center gap-2 rounded-lg px-2.5 text-sm focus-visible:outline-2 focus-visible:outline-emerald-600 sm:gap-4 sm:px-3 [&::-webkit-details-marker]:hidden">
              <span className="flex min-w-0 items-center gap-1.5 font-semibold text-slate-900" title={customerName}>
                {hasFlag && <Flag className="size-4 shrink-0 text-rose-600 fill-rose-600" aria-label={t("ต้องตรวจสอบการชำระเงิน", "Payment needs review")} />}
                <span className="truncate">{customerName}</span>

              </span>
              <span className="flex flex-wrap items-center gap-1"><SlipStatus review={review} language={language}/>{hasFlag&&<span className="registration-payment-flag">{review.amount_mismatch?t("ยอดไม่ตรง","Amount mismatch"):t("ต้องตรวจสอบ","Needs review")}</span>}</span>
              <span className="whitespace-nowrap text-right font-semibold tabular-nums text-slate-900">{money.format(review.total_minor/100)}</span>
              <ChevronDown className="h-4 w-4 text-slate-500 group-open/review:rotate-180" aria-hidden="true" />
            </summary>
            <div className="paid-review-details border-t border-slate-200 p-2.5 text-sm">
              <div className="min-w-0 space-y-2">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <RegistrationStatusTag status={bookingStatus} language={language} />
                  {review.attempt_id && bookingStatus !== "verification_pending" &&
                    <RegistrationStatusTag status="verification_pending" language={language} />}
                  {!review.attempt_id && review.balance_due_minor > 0 &&
                    <span className="registration-status-tag" data-registration-status="awaiting_payment">
                      {t("รอชำระส่วนต่าง", "Additional payment due")}
                    </span>}
                  <span className="wrap-anywhere text-slate-600">{bookingLabel} {review.booking_reference}</span>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5">
                  <p className="font-semibold text-slate-900">
                    {t(`ผู้เข้าร่วมในใบจองนี้ (${review.attendee_count} คน)`, `Attendees in this booking (${review.attendee_count})`)}
                  </p>
                  {review.attendees.length ? (
                    <table className="mt-1 w-full table-fixed text-left text-slate-700">
                      <thead className="text-xs text-slate-600">
                        <tr>
                          <th scope="col" className="w-[38%] py-1 pr-2">{t("ชื่อ", "Name")}</th>
                          <th scope="col" className="py-1 pr-2">{t("ประเภทบัตร", "Ticket category")}</th>
                          <th scope="col" className="w-[7rem] py-1 text-right">{t("ราคาต่อคน", "Price per person")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {review.attendees.map(attendee => <tr key={attendee.id} className={`border-t border-slate-200 align-top ${attendee.price_flagged ? "bg-rose-50" : ""}`}>
                          <td className="wrap-anywhere py-1 pr-2 font-medium">
                            {attendee.name}
                            {review.booking_state !== "cancelled" && review.payment_state !== "refunded" ?
                              <AttendeePhoneEditor key={review.version} phone={attendee.phone} language={language}
                                onSave={async phone => {
                                  const response = await apiFetch(path + "/manage", {
                                    method: "POST",
                                    headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
                                    body: JSON.stringify({ action: "set_attendee_phone", version: review.version,
                                      attendee_id: attendee.id, attendee_phone: phone, reason: "Updated attendee personal contact" }),
                                  });
                                  if (!response.ok) {
                                    const failure = await response.json().catch(() => ({}));
                                    if (failure.error === "version_conflict") refreshAfterUpdate(review.booking_reference);
                                    throw new Error(t("บันทึกเบอร์ไม่ได้ กรุณาลองอีกครั้ง", "Could not save the number. Try again."));
                                  }
                                  refreshAfterUpdate(review.booking_reference);
                                }} /> : attendee.phone && <p className="text-xs text-slate-600">{attendee.phone}</p>}
                            {attendee.price_flagged && <span className="block text-xs text-rose-800">{t("ต้องแก้ราคา", "Price flagged")}</span>}
                          </td>
                          <td className="wrap-anywhere py-1 pr-2">{attendee.category_label}</td>
                          <td className="wrap-anywhere py-1 text-right font-semibold tabular-nums">
                            {money.format(attendee.unit_minor / 100)}
                            {(review.cash_confirmed || attendee.price_flagged) && <div className="flex flex-wrap justify-end gap-1">
                              {review.cash_confirmed && <button type="button" className="inline-flex size-7 items-center justify-center rounded text-rose-700 hover:bg-rose-100 focus-visible:outline-2"
                                aria-label={t(`แก้ราคาที่ปักธง · ${attendee.name}`, `Flag or correct price · ${attendee.name}`)}
                                title={attendee.price_flagged ? t("แก้ราคาที่ปักธง", "Correct flagged price") : t("ปักธงราคาที่ผิด", "Flag incorrect price")}
                                disabled={!!flagBusy}
                                onClick={() => attendee.price_flagged
                                  ? openEditor(review.booking_reference, { action: "correct_price", attendeeId: attendee.id })
                                  : void updatePriceFlag(review, attendee.id, false)}>
                                <Flag className={`size-4 ${attendee.price_flagged ? "fill-current" : ""}`} aria-hidden="true" />
                              </button>}
                              {attendee.price_flagged && <button type="button" className="registration-admin-control inline-flex items-center gap-1 text-rose-700"
                                aria-label={t(`เอาธงออก · ${attendee.name}`, `Clear price flag · ${attendee.name}`)}
                                title={t("เอาธงออก", "Clear price flag")} disabled={!!flagBusy}
                                onClick={() => void updatePriceFlag(review, attendee.id, true)}>
                                <FlagOff className="size-4" aria-hidden="true" />{t("เอาธงออก","Clear flag")}
                              </button>}
                            </div>}
                          </td>
                        </tr>)}
                      </tbody>
                    </table>
                  ) : <p className="text-slate-600">{t("ไม่มีรายชื่อผู้เข้าร่วมให้แสดง", "No attendee names to display.")}</p>}
                  {flagError?.reference === review.booking_reference && <p role="alert" className="mt-1 text-sm text-rose-800">{flagError.text}</p>}
                </div>
                <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-0.5 wrap-anywhere text-slate-700 [&>dt]:text-slate-600">
                  <dt>{t("ยอดรวมใบจอง", "Booking total")}</dt>
                  <dd className="font-semibold">{money.format(review.total_minor / 100)}</dd>
                  {review.coupon_code && review.coupon_discount_minor != null && <>
                    <dt>{t("คูปอง", "Coupon")}</dt>
                    <dd className="font-semibold">{review.coupon_code} · −{money.format(review.coupon_discount_minor / 100)}</dd>
                  </>}
                  {review.balance_due_minor > 0 && <><dt>{t("ยอดชำระเพิ่ม", "Additional amount due")}</dt>
                    <dd className="flex flex-wrap items-center gap-2 font-semibold">{money.format(review.balance_due_minor / 100)}
                      {!review.proofs.length && <button type="button" className={toolbarControl}
                        onClick={() => openEditor(review.booking_reference, { action: "payment_notice" })}>
                        <Send className="size-4" aria-hidden="true" />{t("แจ้งยอดให้ผู้จอง", "Notify customer")}
                      </button>}
                    </dd></>}
                  {review.proofs.length === 1 && review.claimed_minor != null && <>
                    <dt>{t("ยอดที่ลูกค้าแจ้ง", "Reported amount")}</dt>
                    <dd className={review.claimed_minor === (review.booking_state === "confirmed" ? review.balance_due_minor : review.total_minor) ? "font-semibold text-emerald-700" : "font-semibold text-rose-700"}>
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
                <details className="rounded-lg border border-slate-200" open={editingBooking === review.booking_reference}
                  onToggle={event => {
                    const isOpen = event.currentTarget.open;
                    setEditingBooking(current => isOpen ? review.booking_reference :
                      current === review.booking_reference ? "" : current);
                  }}>
                  <summary className="cursor-pointer px-2.5 py-2 font-semibold text-blue-700">
                    {t("แก้ไขใบจอง", "Edit booking")}
                  </summary>
                  {editingBooking === review.booking_reference && <div className="px-2.5 pb-2.5">
                    <PaidBookingOperations eventId={eventId} apiFetch={apiFetch} language={language}
                      bookingReference={review.booking_reference} version={review.version}
                      request={editRequest?.reference === review.booking_reference ? editRequest.request : undefined}
                      onChange={() => refreshAfterUpdate(review.booking_reference)} />
                  </div>}
                </details>
                {onOpenCustomer && <button type="button" className={toolbarControl}
                  onClick={() => onOpenCustomer(review.customer_id)}>
                  {t("เปิดบัญชีลูกค้า", "View customer account")}
                </button>}
              </div>
              <div className="min-w-0 space-y-2">
                <div className="grid gap-4">
                  {review.proofs.map((proof, index) => {
                    const url = path + "/proofs/" + encodeURIComponent(proof.attempt_id);
                    const label = t(`สลิปใบที่ ${index + 1}`, `Slip ${index + 1}`);
                    return <div key={proof.attempt_id}><SlipImage url={url} label={label} language={language}/><div className="flex flex-wrap justify-between gap-2 py-1">
                      <span className="font-semibold text-blue-700 underline">
                        {label}
                      </span>
                      {proof.claimed_minor != null && <span className="ml-2">{money.format(proof.claimed_minor / 100)}</span>}
                    </div><CorrectSlipAmount key={review.version} attemptId={proof.attempt_id} amount={proof.claimed_minor} version={review.version} path={path} apiFetch={apiFetch} language={language} onUpdated={()=>refreshAfterUpdate(review.booking_reference)}/></div>;
                  })}
                </div>
                {review.attempt_id && <ReviewForm key={review.version} review={review} path={path} apiFetch={apiFetch} language={language}
                  onUpdated={() => refreshAfterUpdate(review.booking_reference)} />}
                {review.previous_proofs.length > 0 && <>
                  <p className="font-semibold">{t("สลิปก่อนหน้า", "Previous slips")}</p>
                  <ul className="grid gap-1.5">
                    {review.previous_proofs.map((proof, index) => {
                      const amount = proof.observed_minor ?? proof.claimed_minor;
                      const status = proof.supporting ? t("หลักฐานประกอบ", "Supporting evidence") : proof.status === "verified" ? t("ตรวจแล้ว", "Reviewed") :
                        proof.status === "rejected" ? t("ปฏิเสธแล้ว", "Rejected") : t("ส่งแล้ว", "Submitted");
                      return <li key={proof.attempt_id}>
                        <SlipImage url={path + "/proofs/" + encodeURIComponent(proof.attempt_id)} label={t(`สลิปก่อนหน้า ${index + 1}`,`Previous slip ${index + 1}`)} language={language}/>
                        <div className="flex flex-wrap justify-between gap-2 py-1 font-semibold"><span>{status}</span>{amount != null && <span>{money.format(amount / 100)}</span>}</div>
                        {proof.status==="verified"&&review.booking_state==="confirmed"&&<CorrectSlipAmount verified key={"amount-"+review.version} attemptId={proof.attempt_id} amount={proof.claimed_minor??proof.observed_minor} version={review.version} path={path} apiFetch={apiFetch} language={language} onUpdated={()=>refreshAfterUpdate(review.booking_reference)}/>}
                        {proof.status==="verified"&&review.booking_state==="confirmed"&&<RevokeSlip key={review.version} attemptId={proof.attempt_id} version={review.version} path={path} apiFetch={apiFetch} language={language} onUpdated={()=>refreshAfterUpdate(review.booking_reference)}/>}
                        {proof.supporting && review.balance_due_minor > 0 && <ApplySupportingSlip
                          key={review.version} attemptId={proof.attempt_id} claimedMinor={proof.claimed_minor}
                          balance={review.balance_due_minor} version={review.version} path={path} apiFetch={apiFetch}
                          language={language} onUpdated={() => refreshAfterUpdate(review.booking_reference)} />}
                      </li>;
                    })}
                  </ul>
                </>}
                {canUpload && <details>
                    <summary className="registration-admin-control paid-slip-staff-submit cursor-pointer list-none [&::-webkit-details-marker]:hidden">
                      <UploadCloud className="h-4 w-4" aria-hidden="true" /> {review.attempt_id || review.previous_proofs.length ? t("แนบสลิปเพิ่มแทนลูกค้า", "Add another slip for customer") : t("อัปโหลดสลิปแทนลูกค้า", "Upload slip for customer")}
                    </summary>
                    <div className="mt-2 space-y-2">
                      <p className="text-slate-600">{t("แนบภาพเพื่อส่งเข้าคิวรอตรวจ ยอดและเวลาโอนระบุภายหลังได้", "Attach the slip to send it for review. The amount and transfer time can be added later.")}</p>
                      <PaidProofForm key={review.version} staff bookingReference={review.booking_reference} locale={language} path={path} version={review.version}
                        paymentMode={review.payment_mode} totalMinor={review.booking_state === "confirmed" ? review.balance_due_minor || null : review.total_minor} onSubmitted={() => {
                          setUploadedBooking(review.booking_reference);
                          refreshAfterUpdate(review.booking_reference);
                        }}
                        submitRequest={async (url, init) => {
                          const response = await apiFetch(url, init);
                          const result = await response.json().catch(() => ({}));
                          if (!response.ok) throw new Error(result.error || "proof_unavailable");
                          return result;
                        }} />
                    </div>
                  </details>}
              </div>
            </div>
          </details>;
        })}</div>}
        {visibleRows && !reference && (offset > 0 || next != null) && <div className="flex gap-2 text-sm">
          {offset > 0 && <button type="button" className={toolbarControl} onClick={() => setOffset(Math.max(0, offset - 20))}>{t("ก่อนหน้า", "Previous")}</button>}
          {next != null && <button type="button" className={toolbarControl} onClick={() => setOffset(next)}>{t("ถัดไป", "Next")}</button>}
        </div>}
      </div>}
    </section>
  );
}

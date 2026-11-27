import { Lock, LockOpen, Pencil, Check, X } from "lucide-react";
import { paidSeminarFields, type PaidSeminarField } from "../../../../backend/paidSeminarFields";
import { useEffect, useRef, useState, type FormEvent } from "react";

type ApiFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
type Booking = {
  id: string; reference: string; state: string; payment_state: string; version: number;
  total_minor: number; balance_due_minor: number;
  verified_cash_minor?:number; surplus_minor?:number; settled_surplus_minor?:number; surplus_settlements?:{kind:string;amount_minor:number;reference:string;reason:string}[];
  cash_confirmed: boolean; pending_proofs: number; payment_notice?: string;
  can_apply_coupon: boolean;
  registration_locked_fields?:string[]; registration_fields?:PaidSeminarField[]; registration_answers?:Record<string,string>;
  attendee_prices: { registration_locked_fields?:string[]; registration_answers?:Record<string,string>; id: string; first_name: string; last_name: string; category_label: string; unit_minor: number }[];
  due_ms: number; attendees: number; checked_in: number;
  credit_used_minor: number; credit_issued_minor: number;
  refunds: { reference: string; amount_minor: number }[];
};
type Copy = [string, string];
const actionLabels: Record<string, Copy> = {
  adjust_room:["เปลี่ยนประเภทห้องและปรับราคา","Adjust room and price"],
  settle_surplus:["จัดการเงินส่วนเกิน","Settle surplus"],
  apply_coupon: ["ใช้คูปองแทนผู้จอง", "Apply coupon for customer"],
  payment_notice: ["ส่งข้อความแจ้งชำระส่วนต่าง", "Send a balance reminder"],
  correct_price: ["แก้ราคาผู้เข้าร่วมและเรียกเก็บส่วนต่าง", "Correct attendee price and collect the difference"],
  extend: ["ขยายเวลาชำระเงิน", "Extend payment deadline"],
  cancel: ["ยกเลิกใบจอง", "Cancel booking"],
  reinstate: ["เปิดใบจองที่หมดอายุอีกครั้ง", "Reinstate expired booking"],
  refund: ["บันทึกว่าโอนเงินคืนแล้ว", "Record a completed refund"],
  credit: ["ยกเลิกและเก็บเป็นเครดิต", "Cancel and keep as credit"],
};
const errorLabels: Record<string, Copy> = {
  amount_exceeds_surplus:["ยอดเกินเงินส่วนเกินที่เหลือ","Amount exceeds remaining surplus"],
  surplus_already_settled:["มีรายการจัดการเงินส่วนเกินแล้ว ต้องตรวจสอบบัญชีก่อนแก้สลิปหรือยกเลิกใบจอง","Surplus has been settled; reconcile before reversing payment or cancelling."],
  coupon_invalid: ["รูปแบบรหัสคูปองไม่ถูกต้อง", "Enter a valid coupon code."],
  coupon_not_found: ["ไม่พบคูปองนี้สำหรับงานนี้", "This event has no coupon with that code."],
  coupon_disabled: ["คูปองนี้ถูกปิดใช้งาน", "This coupon is disabled."],
  coupon_not_started: ["คูปองนี้ยังไม่เริ่มใช้", "This coupon is not active yet."],
  coupon_expired: ["คูปองนี้หมดอายุแล้ว", "This coupon has expired."],
  coupon_exhausted: ["คูปองนี้ถึงโควตาการใช้แล้ว", "The coupon usage limit has been reached."],
  coupon_already_applied: ["ใบจองนี้ใช้คูปองแล้ว", "This booking already has a coupon."],
  pending_supporting_proof: ["กรุณาตรวจสลิปที่แนบไว้ก่อนแก้ราคา", "Review the attached slip before changing the price."],
  invalid_price_correction: ["ราคาใหม่ต้องสูงกว่าราคาเดิม", "The corrected price must be higher than the current price."],
  credit_changed: ["เครดิตเดิมถูกใช้ไปแล้ว ให้สร้างใบจองใหม่", "The original credit is no longer available. Create a new booking."],
  booking_not_found: ["ไม่พบใบจอง", "Booking not found."],
  version_conflict: ["ใบจองนี้มีการแก้ไข กรุณาค้นหาใหม่", "This booking has changed. Look it up again."],
  registration_unavailable: ["งานนี้ไม่ได้เปิดรับลงทะเบียน", "Registration is closed for this event."],
  capacity_exhausted: ["ที่ว่างไม่พอสำหรับเปิดใบจองใหม่", "There is insufficient capacity to reinstate the booking."],
  attendee_already_registered: ["มีชื่อผู้เข้าร่วมซ้ำกับใบจองอื่นของงานนี้", "Another booking for this event has a matching attendee name."],
  duplicate_attendee_in_booking: ["มีชื่อผู้เข้าร่วมซ้ำกันในใบจองนี้", "This booking contains a duplicate attendee name."],
  state_conflict: ["สถานะใบจองไม่รองรับการดำเนินการนี้", "This operation is unavailable for the current booking status."],
  hold_expired: ["หมดเวลาชำระเงินแล้ว", "The payment deadline has passed."],
  already_checked_in: ["มีผู้เข้าร่วมเช็กอินแล้ว", "An attendee has already checked in."],
  registration_field_locked: ["ช่องนี้ถูกล็อก กรุณาปลดล็อกก่อนแก้ไข", "Unlock this field before editing."],
  invalid_admin_action: ["กรุณาตรวจข้อมูลการดำเนินการ", "Check the operation details."],
};
const control = "registration-admin-control";
const input = "mt-0.5 block w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5";

const fieldLabels:Record<string,string>={arrival:"วันเดินทางมาถึง",departure:"วันเดินทางกลับ",accommodation:"ต้องการที่พัก",room_preference:"ประเภทห้องพัก",transport:"การเดินทาง",food:"อาหาร",notes:"ข้อมูลเพิ่มเติม"};
function AnswerEditor({field,initial,locked,language,busy,onSave,onLock}:{field:PaidSeminarField;initial:string;locked:boolean;language:"th"|"en";busy:boolean;onSave:(value:string)=>Promise<void>;onLock:(locked:boolean)=>Promise<void>}){
 const [value,setValue]=useState(initial);const [editing,setEditing]=useState(false);const t=(th:string,en:string)=>language==="th"?th:en;
 const type=paidSeminarFields[field.key].type;
 const choices=field.options??(type==="boolean"?["yes","no"]:undefined);
 const label=language==="th"?fieldLabels[field.key]:paidSeminarFields[field.key].label;
 const display=(v:string)=>type==="boolean"?v==="yes"?t("ต้องการ","Yes"):v==="no"?t("ไม่ต้องการ","No"):v:v;
 const lockLabel=locked?t("ปลดล็อก "+label,"Unlock "+label):t("ล็อก "+label,"Lock "+label);
 return <div className="border-b border-slate-200 py-1.5">
 <div className="flex items-center gap-2">
 <span className="text-xs text-slate-600 min-w-0 flex-1">{label}</span>
 <span className="text-sm font-medium break-words min-w-0 flex-[1.4]">{display(initial)||"—"}</span>
 {!locked&&<button type="button" className="p-1.5 rounded hover:bg-slate-100" disabled={busy} title={t("แก้ไข","Edit")} aria-label={t("แก้ไข "+label,"Edit "+label)} onClick={()=>{setValue(initial);setEditing(v=>!v);}}><Pencil size={14}/></button>}
 <button type="button" className={`p-1.5 rounded hover:bg-slate-100 ${locked?"text-amber-700":"text-slate-400"}`} disabled={busy} title={lockLabel} aria-label={lockLabel} onClick={()=>{setEditing(false);void onLock(!locked);}}>{locked?<Lock size={14}/>:<LockOpen size={14}/>}</button>
 </div>
 {editing&&!locked&&<form className="flex items-start gap-1.5 mt-1" onSubmit={e=>{e.preventDefault();void onSave(value);}}>
 <div className="min-w-0 flex-1">
 {choices?<select aria-label={label} className={input} required={field.required} value={value} onChange={e=>setValue(e.target.value)}><option value="">{t("เลือกคำตอบ","Choose answer")}</option>{value&&!choices.includes(value)&&<option value={value} disabled>{value}</option>}{choices.map(choice=><option key={choice} value={choice}>{display(choice)}</option>)}</select>:type==="date"?<input aria-label={label} className={input} type="date" required={field.required} value={value} onChange={e=>setValue(e.target.value)}/>:<input aria-label={label} className={input} maxLength={500} required={field.required} value={value} onChange={e=>setValue(e.target.value)}/>}
 </div><button type="submit" disabled={busy||value===initial} title={t("บันทึก","Save")} aria-label={t("บันทึก","Save")} className="p-2 text-emerald-700"><Check size={17}/></button><button type="button" title={t("ยกเลิก","Cancel")} aria-label={t("ยกเลิก","Cancel")} className="p-2" onClick={()=>setEditing(false)}><X size={17}/></button>
 </form>}
 </div>;
}

export type BookingEditRequest = { action: "correct_price"; attendeeId: string } | { action: "payment_notice" };

export function PaidBookingOperations({ eventId, apiFetch, onChange, language, bookingReference, version, request }: {
  eventId: string; apiFetch: ApiFetch; onChange: () => void; language: "th" | "en"; bookingReference: string; version: number; request?: BookingEditRequest;
}) {
  const t = (th: string, en: string) => language === "th" ? th : en;
  const locale = language === "th" ? "th-TH" : "en-GB";
  const money = new Intl.NumberFormat(locale, { style: "currency", currency: "THB" });
  const [chosenAction, setChosenAction] = useState("");
  const [attendeeId, setAttendeeId] = useState("");
  const [booking, setBooking] = useState<Booking | null>(null);
  const [error, setError] = useState<Copy | null>(null);
  const [busy, setBusy] = useState(false);
  const [noticeSent, setNoticeSent] = useState(false);
  const [couponApplied, setCouponApplied] = useState<{ code: string; totalMinor: number }>();
  const noticeInput = useRef<HTMLTextAreaElement>(null);
  const fetchRef = useRef(apiFetch);
  fetchRef.current = apiFetch;
  const base = `/api/events/${encodeURIComponent(eventId)}/paid-registration/bookings`;

  async function loadBooking(bookingReference: string, signal?: AbortSignal) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetchRef.current(`${base}/by-reference/${encodeURIComponent(bookingReference)}`, { signal });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "booking_not_found");
      if (!signal?.aborted) setBooking(result.booking as Booking);
    } catch (failure) {
      if (!signal?.aborted) {
        setBooking(null);
        setError((failure instanceof Error && errorLabels[failure.message]) || ["โหลดใบจองไม่สำเร็จ", "Could not load booking."]);
      }
    } finally {
      if (!signal?.aborted) setBusy(false);
    }
  }

  useEffect(() => {
    const request = new AbortController();
    void loadBooking(bookingReference, request.signal);
    return () => request.abort();
  }, [base, bookingReference, version]);

  useEffect(() => {
    if (!request) return;
    setChosenAction(request.action);
    if (request.action === "correct_price") setAttendeeId(request.attendeeId);
  }, [request]);

  async function manage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!booking || booking.version !== version || busy || !selectedAction) return;
    const values = new FormData(event.currentTarget);
    const action = selectedAction;
    const couponCode = String(values.get("coupon_code") || "").trim().toUpperCase();
    const reason = String(values.get("reason") || "").trim() || (action === "apply_coupon" ? "Coupon applied by staff" : "");
    const copy = actionLabels[action];
    if (!copy) return;
    const unitMinor = Math.round(Number(values.get("unit_price")) * 100);
    if (action === "correct_price" && (!attendee || !Number.isSafeInteger(unitMinor) || unitMinor <= attendee.unit_minor)) {
      setError(errorLabels.invalid_price_correction);
      return;
    }
    const label = action === "adjust_room" ? t("เปลี่ยนห้องและราคาของผู้เข้าร่วม โดยรักษาสลิปเดิม","Change room and attendee price while retaining original slip") : action === "settle_surplus" ? t("บันทึกการจ่ายเงินส่วนเกินที่ดำเนินการแล้ว","Record completed surplus settlement") : action === "correct_price"
      ? `${attendee?.first_name} ${attendee?.last_name}: ${money.format((attendee?.unit_minor ?? 0) / 100)} → ${money.format(unitMinor / 100)}`
      : action === "refund"
      ? t("บันทึกการคืนเงินเต็มจำนวนที่โอนแล้วและยกเลิกบัตรคิวอาร์ทั้งหมด", "Record the completed full refund and revoke all QR tickets")
      : t(...copy);
    if (action !== "payment_notice" && !window.confirm(`${label}${action === "apply_coupon" ? ` · ${couponCode}` : ""}?\n${t("ใบจอง", "Booking")} ${booking.reference}\n${t("เหตุผล", "Reason")} ${reason}`)) return;
    const body = {
      action, reason, version: booking.version,
      ...(action==="adjust_room"?{attendee_id:attendee?.id,answer_key:"room_preference",answer_value:String(values.get("room_preference")||""),unit_minor:unitMinor}:{}),
      ...(action==="settle_surplus"?{settlement_kind:String(values.get("settlement_kind")),settlement_minor:Math.round(Number(values.get("settlement_amount"))*100),refund_reference:String(values.get("settlement_reference")||"").trim()}:{}),
      ...(["extend", "reinstate"].includes(action) ? { hold_minutes: Number(values.get("hold_minutes")) } : {}),
      ...(action === "correct_price" ? { attendee_id: attendee?.id, unit_minor: unitMinor } : {}),
      ...(action === "apply_coupon" ? { coupon_code: couponCode } : {}),
      ...(action === "refund" ? { refund_reference: String(values.get("refund_reference") || "").trim() } : {}),
    };
    setBusy(true); setError(null);
    try {
      const response = await apiFetch(`${base}/${encodeURIComponent(booking.id)}/manage`, {
        method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify(body),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Booking update failed");
      setChosenAction("");
      setNoticeSent(action === "payment_notice");
      setCouponApplied(action === "apply_coupon" ? { code: couponCode, totalMinor: result.total_minor } : undefined);
      onChange();
    } catch (failure) { setError((failure instanceof Error && errorLabels[failure.message]) || ["บันทึกการเปลี่ยนแปลงไม่สำเร็จ", "Could not update the booking."]); }
    finally { setBusy(false); }
  }
  async function saveAnswer(field:PaidSeminarField,value:string,personId?:string){
    if(!booking||busy||booking.version!==version)return;
    if((field.key==="accommodation"||field.key==="room_preference")&&!window.confirm(t("การเปลี่ยนคำตอบจะไม่ปรับยอดเงินอัตโนมัติ ตรวจราคาแยกต่างหากหรือไม่?","This changes the answer only, not the price. Review pricing separately. Continue?")))return;
    setBusy(true);setError(null);
    try{
      const response=await apiFetch(`${base}/${encodeURIComponent(booking.id)}/manage`,{method:"POST",headers:{"Content-Type":"application/json","Idempotency-Key":crypto.randomUUID()},body:JSON.stringify({action:"edit_registration_answer",version:booking.version,answer_key:field.key,answer_value:value,attendee_id:personId,reason:"Staff updated registration answer"})});
      const result=await response.json();if(!response.ok)throw Error(result.error);
      await loadBooking(bookingReference);onChange();
    }catch(failure){setError((failure instanceof Error&&errorLabels[failure.message])||[ "บันทึกคำตอบไม่สำเร็จ กรุณาตรวจข้อมูล","Could not save the answer. Check the value and refresh."]);}
    finally{setBusy(false);}
  }
  async function setFieldLock(field:PaidSeminarField,locked:boolean,personId?:string){
    if(!booking||busy||booking.version!==version)return;
    if(!locked&&!window.confirm(t("ปลดล็อกช่องนี้ให้แก้ไขได้อีกครั้ง?","Unlock this field for editing again?")))return;
    setBusy(true);setError(null);
    try{
      const response=await apiFetch(`${base}/${encodeURIComponent(booking.id)}/manage`,{method:"POST",headers:{"Content-Type":"application/json","Idempotency-Key":crypto.randomUUID()},body:JSON.stringify({action:"set_registration_field_lock",version:booking.version,answer_key:field.key,field_locked:locked,attendee_id:personId,reason:locked?"Staff locked registration field":"Staff unlocked registration field"})});
      const result=await response.json();if(!response.ok)throw Error(result.error);
      await loadBooking(bookingReference);onChange();
    }catch(failure){setError((failure instanceof Error&&errorLabels[failure.message])||["บันทึกการล็อกไม่สำเร็จ","Could not update field lock."]);}
    finally{setBusy(false);}
  }
  const actions = booking?.state === "expired" ? ["reinstate"] :
    booking?.state === "confirmed" && booking.payment_state === "verified"
      ? booking.cash_confirmed || booking.total_minor > (booking.balance_due_minor ?? 0)
        ? [...(booking.pending_proofs ? [] : ["correct_price",...(booking.registration_fields?.some(f=>f.key==="room_preference"&&f.scope==="attendee")?["adjust_room"]:[]),...(Number(booking.surplus_minor)>0?["settle_surplus"]:[])]),
          ...(booking.balance_due_minor > 0 && !booking.pending_proofs ? ["payment_notice"] : []),
          ...(booking.checked_in || booking.balance_due_minor > 0 || booking.pending_proofs || Number(booking.settled_surplus_minor)>0 || Number(booking.surplus_minor)>0 ? [] : ["refund", "credit"])]
        : booking.credit_used_minor > 0 && !booking.checked_in ? ["credit"] : [] :
    booking?.state === "awaiting_payment" && booking.due_ms > Date.now() ? [...(booking.can_apply_coupon ? ["apply_coupon"] : []), "extend", "cancel"] :
    booking?.state === "verification_pending" || booking?.state === "payment_exception" ? ["cancel"] : [];
  const selectedAction = actions.includes(chosenAction) ? chosenAction : actions[0];
  useEffect(() => {
    if (request?.action === "payment_notice" && selectedAction === "payment_notice" && booking?.version === version) {
      noticeInput.current?.focus();
    }
  }, [request, selectedAction, booking?.version, version]);
  const attendee = booking?.attendee_prices?.find(item => item.id === attendeeId) ?? booking?.attendee_prices?.[0];
  return (
    <div className="space-y-2 text-sm">
      {busy && !booking && <p role="status">{t("กำลังโหลดใบจอง…", "Loading booking…")}</p>}
      {booking && <div className="space-y-1.5">
        <p>{t("กำหนดชำระ", "Payment deadline")} {new Date(booking.due_ms).toLocaleString(locale, { timeZone: "Asia/Bangkok" })} · {t("เช็กอินแล้ว", "Checked in")} {booking.checked_in}</p>
        {!!booking.refunds?.length && <p>{t("บันทึกคืนเงินแล้ว", "Refund recorded")} {booking.refunds.map(item => `${money.format(item.amount_minor / 100)} · ${item.reference}`).join(", ")}</p>}
        {booking.credit_issued_minor > 0 && <p>{t("เครดิตที่ออกให้", "Credit issued")} {money.format(booking.credit_issued_minor / 100)}</p>}
        {booking.credit_used_minor > 0 && <p>{booking.state === "cancelled" ? t("คืนเครดิตที่ใช้", "Credit restored") : t("ใช้เครดิต", "Credit applied")} {money.format(booking.credit_used_minor / 100)}</p>}
        {couponApplied && <p role="status" className="font-semibold text-emerald-700">
          {t(`ใช้คูปอง ${couponApplied.code} แล้ว · ยอดใหม่`, `Coupon ${couponApplied.code} applied · New total`)} {money.format(couponApplied.totalMinor / 100)}
        </p>}
        {noticeSent && <p role="status" className="font-semibold text-emerald-700">{t("แจ้งในบัญชีแล้ว ระบบจะส่งอีเมลตามการตั้งค่าของผู้จอง", "Posted to the customer’s account. Email follows their notification settings.")}</p>}
        {booking.balance_due_minor > 0 && booking.payment_notice && <p className="whitespace-pre-wrap text-slate-700">
          <strong>{t("ข้อความล่าสุดถึงผู้จอง", "Latest message to the customer")}</strong> {booking.payment_notice}
        </p>}
        {booking.state!=="cancelled"&&booking.payment_state!=="refunded"&&!!booking.registration_fields?.length&&<section className="space-y-3 rounded-xl border border-slate-300 p-3">
          <h3 className="font-bold">{t("แก้ไขข้อมูลลงทะเบียน","Edit registration details")}</h3>
          <p className="text-xs">{t("แก้ไขคำตอบของผู้เข้าร่วมโดยตรง ยอดเงินจะไม่เปลี่ยนอัตโนมัติ","Edit attendee answers directly. Payment amounts do not change automatically.")}</p>
          {booking.registration_fields.filter(f=>f.scope==="booking").map(field=><AnswerEditor key={field.key+"-"+booking.version} field={field} initial={booking.registration_answers?.[field.key]??""} language={language} busy={busy} locked={booking.registration_locked_fields?.includes(field.key)??false} onLock={locked=>setFieldLock(field,locked)} onSave={value=>saveAnswer(field,value)}/>)}
          {booking.attendee_prices.map(person=><div key={person.id} className="space-y-2 border-t border-slate-200 pt-2">
            <h4 className="font-bold">{person.first_name} {person.last_name}</h4>
            {booking.registration_fields?.filter(f=>f.scope==="attendee").map(field=><AnswerEditor key={field.key+"-"+booking.version} field={field} initial={person.registration_answers?.[field.key]??""} language={language} busy={busy} locked={person.registration_locked_fields?.includes(field.key)??false} onLock={locked=>setFieldLock(field,locked,person.id)} onSave={value=>saveAnswer(field,value,person.id)}/>)}
          </div>)}
        </section>}
        {!!booking.cash_confirmed&&<div className="rounded-lg border border-slate-200 p-2 text-sm grid gap-1">
          <div>{t("ยอดรับจริง","Verified cash received")}: <strong>{money.format(Number(booking.verified_cash_minor||0)/100)}</strong></div>
          <div>{t("ยอดตามใบจองปัจจุบัน","Current booking value")}: <strong>{money.format(booking.total_minor/100)}</strong></div>
          <div>{t("ส่วนเกินรอจัดการ","Unsettled surplus")}: <strong>{money.format(Number(booking.surplus_minor||0)/100)}</strong></div>
          {booking.surplus_settlements?.map((item,i)=><div key={i} className="text-xs">{item.kind==="external"?t("จ่ายภายนอก","External disbursement"):t("คืนเงินบางส่วน","Partial refund")}: {money.format(item.amount_minor/100)} · {item.reference} · {item.reason}</div>)}
        </div>}
        <h3 className="font-semibold">{t("จัดการการเงินและใบจอง","Payment and booking operations")}</h3>
        {actions.length === 0 && <p className="text-slate-600">{t("สถานะนี้ไม่มีรายการให้แก้ไข", "No edits available for this status.")}</p>}
        {actions.length > 0 && <form key={selectedAction} onSubmit={manage} className="grid max-w-xl gap-2 rounded-lg bg-slate-50 p-2 sm:grid-cols-2">
          <label>{t("การดำเนินการ", "Operation")}
            <select value={selectedAction} onChange={event => setChosenAction(event.target.value)} className={input} required>
              {actions.map((item) => <option key={item} value={item}>{t(...actionLabels[item])}</option>)}
            </select>
          </label>
          {selectedAction === "apply_coupon" && <label>{t("รหัสคูปอง", "Coupon code")}
            <input name="coupon_code" required maxLength={32} autoCapitalize="characters" spellCheck={false} className={input} />
          </label>}
          {selectedAction==="adjust_room"&&<>
            <label>{t("ผู้เข้าร่วม","Attendee")}<select required className={input} value={attendee?.id||""} onChange={e=>setAttendeeId(e.target.value)}>{booking.attendee_prices.map(item=><option key={item.id} value={item.id}>{item.first_name} {item.last_name} · {money.format(item.unit_minor/100)}</option>)}</select></label>
            <label>{t("ประเภทห้องใหม่","New room preference")}<select key={attendee?.id} required name="room_preference" className={input} defaultValue={attendee?.registration_answers?.room_preference||""}><option value="">{t("เลือกห้อง","Choose room")}</option>{booking.registration_fields?.find(f=>f.key==="room_preference"&&f.scope==="attendee")?.options?.map(option=><option key={option}>{option}</option>)}</select></label>
            <label>{t("ราคาใหม่ต่อคน (บาท)","New attendee price (THB)")}<input key={attendee?.id} type="number" name="unit_price" min="0" step="0.01" required className={input} defaultValue={Number(attendee?.unit_minor||0)/100}/></label>
            <p className="text-xs sm:col-span-2">{t("ราคานี้ปรับยอดใบจอง ส่วนเกินจะรอดำเนินการ สลิปและ QR เดิมไม่เปลี่ยน","This adjusts booking value. Surplus remains pending; original slip and QR are retained.")}</p>
          </>}
          {selectedAction==="settle_surplus"&&<>
            <label>{t("ประเภทการจ่าย","Settlement type")}<select name="settlement_kind" className={input}><option value="external">{t("จ่ายค่าใช้จ่ายภายนอกแล้ว","External disbursement completed")}</option><option value="refund">{t("คืนเงินบางส่วนแล้ว","Partial refund completed")}</option></select></label>
            <label>{t("จำนวนเงิน (บาท)","Amount (THB)")}<input name="settlement_amount" type="number" required min="0.01" max={Number(booking.surplus_minor||0)/100} step="0.01" defaultValue={Number(booking.surplus_minor||0)/100} className={input}/></label>
            <label>{t("เลขอ้างอิงการจ่าย","Settlement reference")}<input name="settlement_reference" required maxLength={255} className={input}/></label>
            <p className="text-xs sm:col-span-2">{t("บันทึกหลังจ่ายเงินจริงเท่านั้น ไม่ใช่คำสั่งโอนเงิน","Record only after payment is completed. This does not transfer money.")}</p>
          </>}
          {selectedAction === "correct_price" && <>
            <label>{t("ผู้เข้าร่วมที่ต้องแก้ราคา", "Attendee to correct")}
              <select required className={input} value={attendee?.id ?? ""} onChange={event => setAttendeeId(event.target.value)}>
                {booking.attendee_prices?.map(item => <option key={item.id} value={item.id}>
                  {item.first_name} {item.last_name} · {item.category_label} · {money.format(item.unit_minor / 100)}
                </option>)}
              </select>
            </label>
            <label>{t("ราคาที่ถูกต้อง (บาท)", "Correct price (THB)")}
              <input key={attendee?.id} name="unit_price" type="number" required min={((attendee?.unit_minor ?? 0) + 1) / 100} step="0.01"
                placeholder={((attendee?.unit_minor ?? 0) / 100).toFixed(2)} className={input} />
            </label>
          </>}
          {(selectedAction === "extend" || selectedAction === "reinstate") && <label>{t("ระยะเวลาชำระเพิ่ม (นาที)", "Additional payment time (minutes)")}
            <input name="hold_minutes" type="number" min={5} max={43200} defaultValue={1440} className={input} />
          </label>}
          {selectedAction === "refund" && <label>{t("เลขอ้างอิงการโอนคืน", "Refund transfer reference")}
            <input name="refund_reference" className={input} required />
          </label>}
          <label className="sm:col-span-2">{selectedAction === "payment_notice"
            ? t("ข้อความถึงผู้จอง", "Message to the customer")
            : selectedAction === "apply_coupon" ? t("เหตุผล (ไม่บังคับ)", "Reason (optional)") : t("เหตุผล", "Reason")}
            {selectedAction === "payment_notice"
              ? <textarea key={booking.balance_due_minor} ref={noticeInput} name="reason" required rows={3} maxLength={1000} className={input}
                  defaultValue={`ผู้จัดงานปรับราคาในใบจองแล้ว กรุณาชำระส่วนต่าง ${money.format(booking.balance_due_minor / 100)} แล้วแนบสลิปในใบจองนี้\nThe organizer updated your booking price. Please pay the remaining ${money.format(booking.balance_due_minor / 100)} and upload the slip to this booking.`} />
              : <input name="reason" required={selectedAction !== "apply_coupon"} maxLength={1000} className={input} />}
          </label>
          {selectedAction === "refund" && <p className="text-xs text-amber-800 sm:col-span-2">{t("บันทึกหลังโอนเงินคืนสำเร็จ การบันทึกจะยกเลิกบัตรคิวอาร์ที่ยังไม่ได้สแกน", "Record the refund after completing the bank transfer. This revokes all unscanned QR tickets.")}</p>}
          {selectedAction === "credit" && <p className="text-xs text-amber-800 sm:col-span-2">
            {t("ยอดชำระจะเก็บไว้เป็นเครดิตในบัญชีผู้จองสำหรับงานนี้ ระบบจะยกเลิกบัตรของใบจองเดิม", "The paid amount becomes credit for this event in the booker’s account. Existing passes are revoked.")}
          </p>}
          <button disabled={busy || booking.version !== version} className={`${control} registration-admin-control-primary justify-self-start`}>{selectedAction === "payment_notice" ? t("ส่งข้อความ", "Send message") : selectedAction === "apply_coupon" ? t("ใช้คูปอง", "Apply coupon") : t("บันทึก", "Save operation")}</button>
        </form>}
      </div>}
      {error && <p role="alert" className="text-red-700">{t(...error)}</p>}
    </div>
  );
}

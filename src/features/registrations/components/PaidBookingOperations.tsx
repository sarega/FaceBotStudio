import { useState, type FormEvent } from "react";

type ApiFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
type Booking = {
  id: string; reference: string; state: string; payment_state: string; version: number;
  total_minor: number; balance_due_minor: number;
  attendee_prices: { id: string; first_name: string; last_name: string; category_label: string; unit_minor: number }[];
  due_ms: number; attendees: number; checked_in: number;
  credit_used_minor: number; credit_issued_minor: number;
  refunds: { reference: string; amount_minor: number }[];
};
type Copy = [string, string];
const statusLabels: Record<string, Copy> = {
  awaiting_payment: ["รอชำระเงิน", "Awaiting payment"],
  verification_pending: ["รอตรวจสลิป", "Awaiting review"],
  confirmed: ["ยืนยันแล้ว", "Confirmed"],
  expired: ["หมดอายุ", "Expired"],
  cancelled: ["ยกเลิกแล้ว", "Cancelled"],
  payment_exception: ["ต้องตรวจสอบเพิ่มเติม", "Needs follow-up"],
  unpaid: ["ยังไม่ชำระ", "Unpaid"],
  proof_submitted: ["ส่งสลิปแล้ว", "Slip submitted"],
  verified: ["ตรวจสอบยอดแล้ว", "Payment verified"],
  rejected: ["สลิปถูกปฏิเสธ", "Slip rejected"],
  underpaid: ["ชำระไม่ครบ", "Underpaid"],
  refunded: ["คืนเงินแล้ว", "Refunded"],
};
const actionLabels: Record<string, Copy> = {
  correct_price: ["แก้ราคาผู้เข้าร่วมและเรียกเก็บส่วนต่าง", "Correct attendee price and collect the difference"],
  extend: ["ขยายเวลาชำระเงิน", "Extend payment deadline"],
  cancel: ["ยกเลิกใบจอง", "Cancel booking"],
  reinstate: ["เปิดใบจองที่หมดอายุอีกครั้ง", "Reinstate expired booking"],
  refund: ["บันทึกว่าโอนเงินคืนแล้ว", "Record a completed refund"],
  credit: ["ยกเลิกและเก็บเป็นเครดิต", "Cancel and keep as credit"],
};
const errorLabels: Record<string, Copy> = {
  invalid_price_correction: ["ราคาใหม่ต้องสูงกว่าราคาเดิม", "The corrected price must be higher than the current price."],
  credit_changed: ["เครดิตเดิมถูกใช้ไปแล้ว ให้สร้างใบจองใหม่", "The original credit is no longer available. Create a new booking."],
  booking_not_found: ["ไม่พบใบจอง", "Booking not found."],
  version_conflict: ["ใบจองนี้มีการแก้ไข กรุณาค้นหาใหม่", "This booking has changed. Look it up again."],
  registration_unavailable: ["งานนี้ไม่ได้เปิดรับลงทะเบียน", "Registration is closed for this event."],
  capacity_exhausted: ["ที่ว่างไม่พอสำหรับเปิดใบจองใหม่", "There is insufficient capacity to reinstate the booking."],
  state_conflict: ["สถานะใบจองไม่รองรับการดำเนินการนี้", "This operation is unavailable for the current booking status."],
  hold_expired: ["หมดเวลาชำระเงินแล้ว", "The payment deadline has passed."],
  already_checked_in: ["มีผู้เข้าร่วมเช็กอินแล้ว", "An attendee has already checked in."],
  invalid_admin_action: ["กรุณาตรวจข้อมูลการดำเนินการ", "Check the operation details."],
};
const control = "registration-admin-control";
const input = "mt-0.5 block w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5";

export function PaidBookingOperations({ eventId, apiFetch, onChange, language }: {
  eventId: string; apiFetch: ApiFetch; onChange: () => void; language: "th" | "en";
}) {
  const t = (th: string, en: string) => language === "th" ? th : en;
  const locale = language === "th" ? "th-TH" : "en-GB";
  const money = new Intl.NumberFormat(locale, { style: "currency", currency: "THB" });
  const statusLabel = (state: string) => t(...(statusLabels[state] ?? ["ไม่ทราบสถานะ", "Unknown status"]));
  const [chosenAction, setChosenAction] = useState("");
  const [attendeeId, setAttendeeId] = useState("");
  const [reference, setReference] = useState("");
  const [booking, setBooking] = useState<Booking | null>(null);
  const [error, setError] = useState<Copy | null>(null);
  const [busy, setBusy] = useState(false);
  const base = `/api/events/${encodeURIComponent(eventId)}/paid-registration/bookings`;

  async function find(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setError(null); setBooking(null); setChosenAction(""); setAttendeeId("");
    try {
      const response = await apiFetch(`${base}/by-reference/${encodeURIComponent(reference.trim())}`);
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "booking_not_found");
      setBooking(result.booking as Booking);
    } catch (failure) { setError((failure instanceof Error && errorLabels[failure.message]) || ["โหลดใบจองไม่สำเร็จ", "Could not load booking."]); }
    finally { setBusy(false); }
  }

  async function manage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!booking || busy || !selectedAction) return;
    const values = new FormData(event.currentTarget);
    const action = selectedAction;
    const reason = String(values.get("reason") || "").trim();
    const copy = actionLabels[action];
    if (!copy) return;
    const unitMinor = Math.round(Number(values.get("unit_price")) * 100);
    if (action === "correct_price" && (!attendee || !Number.isSafeInteger(unitMinor) || unitMinor <= attendee.unit_minor)) {
      setError(errorLabels.invalid_price_correction);
      return;
    }
    const label = action === "correct_price"
      ? `${attendee?.first_name} ${attendee?.last_name}: ${money.format((attendee?.unit_minor ?? 0) / 100)} → ${money.format(unitMinor / 100)}`
      : action === "refund"
      ? t("บันทึกการคืนเงินเต็มจำนวนที่โอนแล้วและยกเลิกบัตรคิวอาร์ทั้งหมด", "Record the completed full refund and revoke all QR tickets")
      : t(...copy);
    if (!window.confirm(`${label}?\n${t("ใบจอง", "Booking")} ${booking.reference}\n${t("เหตุผล", "Reason")} ${reason}`)) return;
    const body = {
      action, reason, version: booking.version,
      ...(["extend", "reinstate"].includes(action) ? { hold_minutes: Number(values.get("hold_minutes")) } : {}),
      ...(action === "correct_price" ? { attendee_id: attendee?.id, unit_minor: unitMinor } : {}),
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
      setBooking({ ...booking, state: result.status, payment_state: result.payment_status,
        version: result.version, due_ms: Date.parse(result.due_at),
        total_minor: result.total_minor ?? booking.total_minor,
        balance_due_minor: result.balance_due_minor ?? booking.balance_due_minor,
        attendee_prices: action === "correct_price" ? booking.attendee_prices.map(item =>
          item.id === attendee?.id ? { ...item, unit_minor: unitMinor } : item) : booking.attendee_prices,
        credit_issued_minor: action === "credit" ? booking.total_minor : booking.credit_issued_minor,
        refunds: action === "refund" ? [...booking.refunds, { reference: body.refund_reference!, amount_minor: booking.total_minor }] : booking.refunds,
      });
      setChosenAction("");
      onChange();
    } catch (failure) { setError((failure instanceof Error && errorLabels[failure.message]) || ["บันทึกการเปลี่ยนแปลงไม่สำเร็จ", "Could not update the booking."]); }
    finally { setBusy(false); }
  }
  const actions = booking?.state === "expired" ? ["reinstate"] :
    booking?.state === "confirmed" && booking.payment_state === "verified"
      ? booking.total_minor > (booking.balance_due_minor ?? 0)
        ? ["correct_price", ...(booking.checked_in || booking.balance_due_minor > 0 ? [] : ["refund", "credit"])]
        : booking.credit_used_minor > 0 && !booking.checked_in ? ["credit"] : [] :
    booking?.state === "awaiting_payment" && booking.due_ms > Date.now() ? ["extend", "cancel"] :
    booking?.state === "verification_pending" || booking?.state === "payment_exception" ? ["cancel"] : [];
  const selectedAction = actions.includes(chosenAction) ? chosenAction : actions[0];
  const attendee = booking?.attendee_prices?.find(item => item.id === attendeeId) ?? booking?.attendee_prices?.[0];
  return (
    <div className="space-y-2 text-sm">
      <form className="flex flex-wrap items-end gap-1.5" onSubmit={find}>
        <label className="min-w-0 flex-[0_1_14rem]">{t("เลขอ้างอิงใบจอง", "Booking reference")}
          <input className={input} required value={reference} onChange={(event) => setReference(event.target.value)} />
        </label>
        <button disabled={busy} className={control}>{t("ค้นหา", "Find booking")}</button>
      </form>
      {booking && <div className="space-y-1.5">
        <p className="break-all font-medium">{booking.reference}</p>
        <p>{t(`ผู้เข้าร่วม ${booking.attendees} คน`, `${booking.attendees} attendees`)} · {money.format(booking.total_minor / 100)} · {statusLabel(booking.state)} / {statusLabel(booking.payment_state)}</p>
        {booking.balance_due_minor > 0 && <p className="font-semibold text-amber-800">{t("ยอดชำระเพิ่ม", "Additional amount due")} {money.format(booking.balance_due_minor / 100)}</p>}
        <p>{t("กำหนดชำระ", "Payment deadline")} {new Date(booking.due_ms).toLocaleString(locale, { timeZone: "Asia/Bangkok" })} · {t("เช็กอินแล้ว", "Checked in")} {booking.checked_in}</p>
        {!!booking.refunds?.length && <p>{t("บันทึกคืนเงินแล้ว", "Refund recorded")} {booking.refunds.map(item => `${money.format(item.amount_minor / 100)} · ${item.reference}`).join(", ")}</p>}
        {booking.credit_issued_minor > 0 && <p>{t("เครดิตที่ออกให้", "Credit issued")} {money.format(booking.credit_issued_minor / 100)}</p>}
        {booking.credit_used_minor > 0 && <p>{booking.state === "cancelled" ? t("คืนเครดิตที่ใช้", "Credit restored") : t("ใช้เครดิต", "Credit applied")} {money.format(booking.credit_used_minor / 100)}</p>}
        {actions.length > 0 && <form onSubmit={manage} className="grid max-w-xl gap-2 rounded-lg bg-slate-50 p-2 sm:grid-cols-2">
          <label>{t("การดำเนินการ", "Operation")}
            <select value={selectedAction} onChange={event => setChosenAction(event.target.value)} className={input} required>
              {actions.map((item) => <option key={item} value={item}>{t(...actionLabels[item])}</option>)}
            </select>
          </label>
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
          <label className="sm:col-span-2">{t("เหตุผล", "Reason")}
            <input name="reason" required maxLength={1000} className={input} />
          </label>
          {selectedAction === "refund" && <p className="text-xs text-amber-800 sm:col-span-2">{t("บันทึกหลังโอนเงินคืนสำเร็จ การบันทึกจะยกเลิกบัตรคิวอาร์ที่ยังไม่ได้สแกน", "Record the refund after completing the bank transfer. This revokes all unscanned QR tickets.")}</p>}
          {selectedAction === "credit" && <p className="text-xs text-amber-800 sm:col-span-2">
            {t("ยอดชำระจะเก็บไว้เป็นเครดิตในบัญชีผู้จองสำหรับงานนี้ ระบบจะยกเลิกบัตรของใบจองเดิม", "The paid amount becomes credit for this event in the booker’s account. Existing passes are revoked.")}
          </p>}
          <button disabled={busy} className={`${control} registration-admin-control-primary justify-self-start`}>{t("บันทึก", "Save operation")}</button>
        </form>}
      </div>}
      {error && <p role="alert" className="text-red-700">{t(...error)}</p>}
    </div>
  );
}

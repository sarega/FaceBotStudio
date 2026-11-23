import { useRef, useState } from "react";
import { Pencil } from "lucide-react";
import { paidSeminarFields } from "../../../../backend/paidSeminarFields";
import { RegistrationStatusTag, getRosterStatus } from "./RegistrationStatusTag";
import type { AppLanguage } from "../../../lib/i18n";
import type { PaidRosterPerson } from "./paidRosterTypes";

type Props = {
  onManageBooking?: (reference: string) => void;
  people: PaidRosterPerson[];
  total: number;
  language: AppLanguage;
  onRefresh: () => void;
  onCancelBooking?: (person: PaidRosterPerson, reason: string, key: string) => Promise<void>;
};
function CancelBookingForm({ person, language, onCancel }: {
  person: PaidRosterPerson;
  language: AppLanguage;
  onCancel: NonNullable<Props["onCancelBooking"]>;
}) {
  const t = (th: string, en: string) => language === "th" ? th : en;
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const command = useRef<{ reason: string; key: string } | null>(null);
  if (!open) return <button type="button" className="registration-cancel-link mt-1 font-semibold underline" onClick={() => setOpen(true)}>
    {t("ยกเลิกใบจอง", "Cancel booking")}
  </button>;
  return <form className="mt-2 space-y-1 rounded-lg border border-rose-300 p-2" onSubmit={async event => {
    event.preventDefault();
    const note = reason.trim();
    if (busy || !note) return;
    setBusy(true);
    setError("");
    if (command.current?.reason !== note) command.current = { reason: note, key: crypto.randomUUID() };
    try {
      await onCancel(person, note, command.current.key);
      setOpen(false);
    } catch (failure) {
      setError(failure instanceof Error && ["state_conflict", "version_conflict"].includes(failure.message)
        ? t("สถานะใบจองเปลี่ยนแล้ว กรุณาโหลดรายชื่อใหม่", "Booking changed. Refresh the attendee list.")
        : t("ยกเลิกไม่สำเร็จ กรุณาลองใหม่", "Could not cancel. Try again."));
    } finally {
      setBusy(false);
    }
  }}>
    <p>{t("คืนที่นั่งทั้งหมดในใบจองนี้", "Release all places in this booking")}</p>
    <label className="block">{t("เหตุผล", "Reason")}
      <input value={reason} onChange={event => setReason(event.target.value)} required maxLength={1000} disabled={busy}
        className="mt-0.5 w-full rounded border border-slate-300 px-1.5 py-1" />
    </label>
    <div className="flex flex-wrap items-center gap-2">
      <button type="submit" disabled={busy || !reason.trim()} className="registration-cancel-confirm rounded px-2 py-1 font-semibold disabled:opacity-50">
        {busy ? t("กำลังยกเลิก…", "Cancelling…") : t("ยืนยันยกเลิก", "Confirm cancellation")}
      </button>
      <button type="button" disabled={busy} className="underline" onClick={() => { setOpen(false); setError(""); }}>
        {t("กลับ", "Back")}
      </button>
    </div>
    {error && <p role="alert" className="registration-cancel-link">{error}</p>}
  </form>;
}

export function PaidAttendeeRoster({people,total,onRefresh,language,onCancelBooking,onManageBooking}:Props) {
  if(!total)return null;
  const t = (th: string, en: string) => language === "th" ? th : en;
  const money = new Intl.NumberFormat(language === "th" ? "th-TH" : "en-GB", { style: "currency", currency: "THB" });
  const format = (minor: number) => money.format(minor / 100);
  const shownBookings = new Set<string>();
  return <section className="paid-attendee-roster border-b border-emerald-200 p-3">
    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
      <h3 className="text-sm font-bold text-emerald-900">
        {t(`ลงทะเบียนแบบชำระเงิน · ${total} คน (แสดง ${people.length})`, `Paid registration · ${total} attendees (showing ${people.length})`)}
      </h3>
      <button type="button" onClick={onRefresh}
        className="text-xs font-semibold text-emerald-700 underline">{t("โหลดใหม่", "Refresh")}</button>
    </div>
    <div className="max-h-[30rem] overflow-auto rounded-lg border border-emerald-200">
      <table className="w-full min-w-[780px] text-left text-xs">
        <thead className="sticky top-0 text-emerald-950"><tr>
          <th className="px-3 py-2">{t("ผู้เข้าร่วมและสถานะ", "Attendee and status")}</th><th className="px-3 py-2">{t("ประเภท", "Category")}</th>
          <th className="px-3 py-2">{t("ผู้จอง", "Booked by")}</th><th className="px-3 py-2">{t("ใบจอง", "Booking")}</th>
          <th className="px-3 py-2">{t("ยอดเงิน", "Amount")}</th><th className="px-3 py-2">{t("รายละเอียดลงทะเบียน", "Registration details")}</th>
        </tr></thead>
        <tbody className="divide-y divide-slate-100">
          {people.map(person => {
            const status = getRosterStatus(person.booking_state, person.checked_in_ms != null);
            const firstInBooking = !shownBookings.has(person.booking_id);
            shownBookings.add(person.booking_id);
            const canCancel = firstInBooking && status === "awaiting_payment" &&
              ["unpaid", "rejected"].includes(person.payment_state) && Number.isSafeInteger(person.booking_version);
            return <tr key={person.attendee_id} data-registration-status={status}>
              <td className="w-44 px-3 py-2 font-semibold text-slate-900">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span>{person.first_name} {person.last_name}</span>
                  <RegistrationStatusTag status={status} language={language} />
                </div>
                {canCancel && onCancelBooking && <CancelBookingForm person={person} language={language} onCancel={onCancelBooking} />}
              </td>
              <td className="px-3 py-2">{person.category_label}</td>
              <td className="px-3 py-2">
                {person.customer_first_name} {person.customer_last_name}
                <span className="block break-all text-slate-500">{person.customer_email}</span>
              </td>
              <td className="px-3 py-2 break-all text-slate-500">
                <div className="flex items-start gap-1.5">
                  <span className="min-w-0">{person.booking_reference}</span>
                  {firstInBooking && onManageBooking && <button type="button"
                    aria-label={t("จัดการใบจอง", "Manage booking")}
                    className="group/edit relative inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-blue-700 hover:bg-blue-50 focus-visible:outline-2 focus-visible:outline-blue-700"
                    onClick={() => onManageBooking(person.booking_reference)}>
                    <Pencil className="h-4 w-4" aria-hidden="true" />
                    <span aria-hidden="true" className="pointer-events-none absolute right-0 top-full z-10 hidden whitespace-nowrap rounded bg-slate-900 px-2 py-1 text-xs text-white group-hover/edit:block group-focus-visible/edit:block">
                      {t("จัดการใบจอง", "Manage booking")}
                    </span>
                  </button>}
                </div>
              </td>
              <td className="px-3 py-2 font-semibold text-slate-700">
                <span className="block font-normal tabular-nums">{format(person.unit_minor)} {t("ต่อคน", "per person")}</span>
                <span className="block whitespace-nowrap font-normal tabular-nums">{format(person.booking_total_minor)} {t("ทั้งใบจอง", "per booking")}</span>
                {person.pending_slip_minor != null && <span className="block font-normal tabular-nums">{t("ตามสลิป", "On slip")} {format(person.pending_slip_minor)}</span>}
              </td>
              <td className="px-3 py-2">
                {Object.keys(person.answers ?? {}).length || Object.keys(person.booking_answers ?? {}).length ? (
                  <details>
                    <summary className="cursor-pointer whitespace-nowrap font-semibold text-blue-700">{t("ดูคำตอบ", "View answers")}</summary>
                    <dl className="space-y-1 pt-1">
                      {Object.entries({ ...person.booking_answers, ...person.answers }).map(([key, value]) =>
                        <div key={key}><dt className="font-semibold">{paidSeminarFields[key as keyof typeof paidSeminarFields]?.label ?? key}</dt>
                          <dd className="break-words text-slate-600">{value}</dd></div>)}
                    </dl>
                  </details>
                ) : "—"}
              </td>
            </tr>;
          })}
        </tbody>
      </table>
      {people.length===0&&<p className="p-3 text-xs text-slate-500">{t("ไม่พบผู้เข้าร่วมตามคำค้นหา", "No matching attendees.")}</p>}
    </div>
    <p className="mt-2 text-xs text-slate-600">
      {t("แสดงผู้เข้าร่วมทุกคนในใบจอง ไฟล์ CSV มีหนึ่งแถวต่อคน", "All attendees in each booking are listed. The CSV has one row per person.")}
    </p>
  </section>;
}

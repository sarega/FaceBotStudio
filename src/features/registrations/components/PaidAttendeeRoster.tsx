import { useRef, useState } from "react";
import { Check, Copy, Pencil } from "lucide-react";
import { paidSeminarFields } from "../../../../backend/paidSeminarFields";
import { RegistrationStatusTag, getRosterStatus } from "./RegistrationStatusTag";
import type { AppLanguage } from "../../../lib/i18n";
import type { PaidRosterPerson } from "./paidRosterTypes";

type Props = {
  checkerMode?: boolean;
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

const rosterColumnWidths = [172, 104, 144, 132, 132, 102];

function BookingReference({ reference, language, onManage }: {
  reference: string; language: AppLanguage; onManage?: () => void;
}) {
  const [copyStatus, setCopyStatus] = useState<"copied" | "failed">();
  const copyLabel = language === "th" ? "คัดลอกเลขใบจองเต็ม" : "Copy full booking reference";
  const manageLabel = language === "th" ? "จัดการใบจอง" : "Manage booking";
  return <div className="flex items-center gap-1 whitespace-nowrap">
    <span className="min-w-0 truncate font-mono" title={reference}>{reference.slice(0, 8)}</span>
    <button type="button" className="inline-flex size-6 shrink-0 items-center justify-center rounded text-blue-700 hover:bg-blue-50"
      title={copyLabel} aria-label={copyLabel} onClick={async () => {
        try {
          await navigator.clipboard.writeText(reference);
          setCopyStatus("copied");
        } catch {
          setCopyStatus("failed");
        }
      }}>
      {copyStatus === "copied" ? <Check className="size-3.5" aria-hidden="true" /> : <Copy className="size-3.5" aria-hidden="true" />}
    </button>
    {onManage && <button type="button" className="inline-flex size-6 shrink-0 items-center justify-center rounded text-blue-700 hover:bg-blue-50"
      title={manageLabel} aria-label={manageLabel} onClick={onManage}>
      <Pencil className="size-3.5" aria-hidden="true" />
    </button>}
    <span className="sr-only" role="status">
      {copyStatus === "copied" ? (language === "th" ? "คัดลอกเลขใบจองแล้ว" : "Booking reference copied")
        : copyStatus === "failed" ? (language === "th" ? "คัดลอกไม่สำเร็จ" : "Could not copy the booking reference") : ""}
    </span>
  </div>;
}

export function PaidAttendeeRoster({people,total,onRefresh,language,onCancelBooking,onManageBooking,checkerMode=false}:Props) {
  const [widths, setWidths] = useState(rosterColumnWidths);
  const drag = useRef<{ index: number; startX: number; startWidth: number } | null>(null);
  if (!total) return null;
  const t = (th: string, en: string) => language === "th" ? th : en;
  const money = new Intl.NumberFormat(language === "th" ? "th-TH" : "en-GB", { style: "currency", currency: "THB" });
  const format = (minor: number) => money.format(minor / 100);
  const shownBookings = new Set<string>();
  const headers = [
    t("ผู้เข้าร่วมและสถานะ", "Attendee and status"), t("ประเภท", "Category"), t("ผู้จอง", "Booked by"),
    t("ใบจอง", "Booking"), t("ยอดเงิน", "Amount"), t("รายละเอียด", "Details"),
  ];
  const visibleColumns = checkerMode ? [0, 1] : headers.map((_, index) => index);
  const setColumnWidth = (index: number, width: number) => {
    setWidths(current => current.map((value, column) => column === index
      ? Math.min(520, Math.max(index === 3 ? 132 : 76, width)) : value));
  };
  return <section className="paid-attendee-roster border-b border-emerald-200 p-3">
    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
      <h3 className="text-sm font-bold text-emerald-900">
        {t(`ลงทะเบียนแบบชำระเงิน · ${total} คน (แสดง ${people.length})`, `Paid registration · ${total} attendees (showing ${people.length})`)}
      </h3>
      <button type="button" onClick={onRefresh}
        className="text-xs font-semibold text-emerald-700 underline">{t("โหลดใหม่", "Refresh")}</button>
    </div>
    <div className="relative max-h-[30rem] overflow-auto rounded-lg border border-emerald-200">
      <table className="w-full table-fixed text-left text-xs" style={{ minWidth: visibleColumns.reduce((sum, index) => sum + widths[index], 0) }}>
        <colgroup>{visibleColumns.map(index => <col key={index} style={{ width: widths[index] }} />)}</colgroup>
        <thead className="sticky top-0 z-10 text-emerald-950"><tr>
          {visibleColumns.map(index => <th key={headers[index]} scope="col" className="relative break-words py-2 pl-2 pr-3">
            {headers[index]}
            <span role="separator" aria-orientation="vertical" tabIndex={0}
              aria-label={t(`ปรับความกว้างคอลัมน์ ${headers[index]}`, `Resize ${headers[index]} column`)}
              aria-valuemin={index === 3 ? 132 : 76} aria-valuemax={520} aria-valuenow={widths[index]}
              className="absolute inset-y-0 right-0 w-2 cursor-col-resize touch-none select-none border-r border-emerald-700/25 hover:bg-emerald-600/30 focus-visible:bg-emerald-600/30"
              onPointerDown={event => {
                if (event.button !== 0) return;
                drag.current = { index, startX: event.clientX, startWidth: widths[index] };
                event.currentTarget.setPointerCapture(event.pointerId);
              }}
              onPointerMove={event => {
                if (drag.current?.index === index) setColumnWidth(index, drag.current.startWidth + event.clientX - drag.current.startX);
              }}
              onPointerUp={event => {
                if (drag.current?.index === index) setColumnWidth(index, drag.current.startWidth + event.clientX - drag.current.startX);
              }}
              onLostPointerCapture={() => { drag.current = null; }}
              onDoubleClick={() => setColumnWidth(index, rosterColumnWidths[index])}
              onKeyDown={event => {
                if (event.key === "Home") setColumnWidth(index, rosterColumnWidths[index]);
                else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                  setColumnWidth(index, widths[index] + (event.key === "ArrowRight" ? 12 : -12));
                } else return;
                event.preventDefault();
              }} />
          </th>)}
        </tr></thead>
        <tbody className="divide-y divide-slate-100">
          {people.map(person => {
            const status = getRosterStatus(person.booking_state, person.checked_in_ms != null);
            const firstInBooking = !shownBookings.has(person.booking_id);
            shownBookings.add(person.booking_id);
            const canCancel = firstInBooking && status === "awaiting_payment" &&
              ["unpaid", "rejected"].includes(person.payment_state) && Number.isSafeInteger(person.booking_version);
            return <tr key={person.attendee_id} data-registration-status={status}>
              <td className="break-words p-2 align-top font-semibold text-slate-900">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span>{person.first_name} {person.last_name}</span>
                  <RegistrationStatusTag status={status} language={language} />
                </div>
                {!checkerMode && person.attendee_phone && <a className="mt-1 block text-xs font-normal text-blue-700 underline"
                  href={`tel:${person.attendee_phone.replace(/[^+0-9]/g, "")}`}
                  title={t("เบอร์โทรส่วนตัว", "Personal phone")}>{person.attendee_phone}</a>}
                {canCancel && onCancelBooking && <CancelBookingForm person={person} language={language} onCancel={onCancelBooking} />}
              </td>
              <td className="break-words p-2 align-top">{person.category_label}</td>
              {!checkerMode && <>
              <td className="break-words p-2 align-top">
                {person.customer_first_name} {person.customer_last_name}
                <span className="block truncate text-slate-500" title={person.customer_email}>{person.customer_email}</span>
              </td>
              <td className="p-2 align-top text-slate-500">
                <BookingReference key={person.booking_reference} reference={person.booking_reference} language={language}
                  onManage={firstInBooking && onManageBooking ? () => onManageBooking(person.booking_reference) : undefined} />
              </td>
              <td className="p-2 align-top font-semibold text-slate-700">
                <span className="block font-normal tabular-nums"><span className="whitespace-nowrap">{format(person.unit_minor)}</span> {t("ต่อคน", "per person")}</span>
                <span className="block font-normal tabular-nums"><span className="whitespace-nowrap">{format(person.booking_total_minor)}</span> {t("ทั้งใบจอง", "per booking")}</span>
                {person.pending_slip_minor != null && <span className="block font-normal tabular-nums">{t("ตามสลิป", "On slip")} {format(person.pending_slip_minor)}</span>}
              </td>
              <td className="break-words p-2 align-top">
                {Object.keys(person.answers ?? {}).length || Object.keys(person.booking_answers ?? {}).length ? (
                  <details>
                    <summary className="cursor-pointer font-semibold text-blue-700">{t("ดูคำตอบ", "View answers")}</summary>
                    <dl className="space-y-1 pt-1">
                      {Object.entries({ ...person.booking_answers, ...person.answers }).map(([key, value]) =>
                        <div key={key}><dt className="font-semibold">{paidSeminarFields[key as keyof typeof paidSeminarFields]?.label ?? key}</dt>
                          <dd className="break-words text-slate-600">{value}</dd></div>)}
                    </dl>
                  </details>
                ) : "—"}
              </td>
              </>}
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

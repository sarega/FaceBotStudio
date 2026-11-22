import { paidSeminarFields } from "../../../../backend/paidSeminarFields";
import { RegistrationStatusTag, getRosterStatus } from "./RegistrationStatusTag";
import type { AppLanguage } from "../../../lib/i18n";
import type { PaidRosterPerson } from "./paidRosterTypes";

type Props = {
  people: PaidRosterPerson[];
  total: number;
  language: AppLanguage;
  onRefresh: () => void;
};
export function PaidAttendeeRoster({people,total,onRefresh,language}:Props) {
  if(!total)return null;
  const t = (th: string, en: string) => language === "th" ? th : en;
  const money = new Intl.NumberFormat(language === "th" ? "th-TH" : "en-GB", { style: "currency", currency: "THB" });
  const format = (minor: number) => money.format(minor / 100);
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
            return <tr key={person.attendee_id} data-registration-status={status}>
              <td className="w-44 px-3 py-2 font-semibold text-slate-900">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span>{person.first_name} {person.last_name}</span>
                  <RegistrationStatusTag status={status} language={language} />
                </div>
              </td>
              <td className="px-3 py-2">{person.category_label}</td>
              <td className="px-3 py-2">
                {person.customer_first_name} {person.customer_last_name}
                <span className="block break-all text-slate-500">{person.customer_email}</span>
              </td>
              <td className="px-3 py-2 break-all text-slate-500">{person.booking_reference}</td>
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

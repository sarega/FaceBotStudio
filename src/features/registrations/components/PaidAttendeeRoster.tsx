import { paidSeminarFields } from "../../../../backend/paidSeminarFields";
import type { PaidRosterPerson } from "./paidRosterTypes";

type Props = {
  people: PaidRosterPerson[];
  total: number;
  onRefresh: () => void;
};
export function PaidAttendeeRoster({people,total,onRefresh}:Props) {
  if(!total)return null;
  const money = new Intl.NumberFormat("th-TH", { style: "currency", currency: "THB" });
  const format = (minor: number) => money.format(minor / 100);
  return <section className="paid-attendee-roster border-b border-emerald-200 p-3">
    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
      <h3 className="text-sm font-bold text-emerald-900">
        Paid Registration · {total} คน (แสดง {people.length})
      </h3>
      <button type="button" onClick={onRefresh}
        className="text-xs font-semibold text-emerald-700 underline">Refresh</button>
    </div>
    <div className="max-h-[30rem] overflow-auto rounded-lg border border-emerald-200">
      <table className="w-full min-w-[780px] text-left text-xs">
        <thead className="sticky top-0 text-emerald-950"><tr>
          <th className="px-3 py-2">ผู้เข้าร่วม</th><th className="px-3 py-2">ประเภท</th>
          <th className="px-3 py-2">ผู้จอง</th><th className="px-3 py-2">Booking</th>
          <th className="px-3 py-2">สถานะและยอด</th><th className="px-3 py-2">รายละเอียดลงทะเบียน</th>
        </tr></thead>
        <tbody className="divide-y divide-slate-100">
          {people.map(person=><tr key={person.attendee_id}>
            <td className="px-3 py-2 font-semibold text-slate-900">
              {person.first_name} {person.last_name}
              {person.checked_in_ms!=null&&<span className="block text-emerald-700">Checked in</span>}
            </td>
            <td className="px-3 py-2">{person.category_label}</td>
            <td className="px-3 py-2">
              {person.customer_first_name} {person.customer_last_name}
              <span className="block break-all text-slate-500">{person.customer_email}</span>
            </td>
            <td className="px-3 py-2 break-all text-slate-500">{person.booking_reference}</td>
            <td className="px-3 py-2 font-semibold text-slate-700">
              {person.booking_state==="confirmed"?"ยืนยันแล้ว":
                person.booking_state==="verification_pending"?"ส่งสลิป · รอตรวจ":
                person.booking_state==="awaiting_payment"?"รอชำระ":
                person.booking_state==="expired"?"หมดอายุ":
                person.booking_state==="cancelled"?"ยกเลิก":"ต้องตรวจสอบ"}
              <span className="block font-normal tabular-nums">{format(person.unit_minor)} ต่อคน</span>
              <span className="block whitespace-nowrap font-normal tabular-nums">{format(person.booking_total_minor)} ทั้งใบจอง</span>
              {person.pending_slip_minor != null && <span className="block font-normal tabular-nums">ตามสลิป {format(person.pending_slip_minor)}</span>}
            </td>
            <td className="px-3 py-2">
              {Object.keys(person.answers ?? {}).length || Object.keys(person.booking_answers ?? {}).length ? (
                <details>
                  <summary className="cursor-pointer whitespace-nowrap font-semibold text-blue-700">ดูคำตอบ</summary>
                  <dl className="space-y-1 pt-1">
                    {Object.entries({ ...person.booking_answers, ...person.answers }).map(([key, value]) =>
                      <div key={key}><dt className="font-semibold">{paidSeminarFields[key as keyof typeof paidSeminarFields]?.label ?? key}</dt>
                        <dd className="break-words text-slate-600">{value}</dd></div>)}
                  </dl>
                </details>
              ) : "—"}
            </td>
          </tr>)}
        </tbody>
      </table>
      {people.length===0&&<p className="p-3 text-xs text-slate-500">ไม่พบผู้เข้าร่วมตามคำค้นหา</p>}
    </div>
    <p className="mt-2 text-xs text-slate-600">
      แสดงทุกคนใน Booking รวมผู้เข้าร่วมคนที่ 2, 3, 4 · CSV ออกหนึ่งแถวต่อคน
    </p>
  </section>;
}

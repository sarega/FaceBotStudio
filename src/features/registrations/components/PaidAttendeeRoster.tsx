import type { PaidRosterPerson } from "./paidRosterTypes";

type Props = {
  people: PaidRosterPerson[];
  total: number;
  onRefresh: () => void;
};
export function PaidAttendeeRoster({people,total,onRefresh}:Props) {
  if(!total)return null;
  return <section className="paid-attendee-roster border-b border-emerald-200 p-3">
    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
      <h3 className="text-sm font-bold text-emerald-900">
        Paid Registration · {total} คน (แสดง {people.length})
      </h3>
      <button type="button" onClick={onRefresh}
        className="text-xs font-semibold text-emerald-700 underline">Refresh</button>
    </div>
    <div className="max-h-[30rem] overflow-auto rounded-lg border border-emerald-200">
      <table className="w-full min-w-[600px] text-left text-xs">
        <thead className="sticky top-0 text-emerald-950"><tr>
          <th className="px-3 py-2">ผู้เข้าร่วม</th><th className="px-3 py-2">ประเภท</th>
          <th className="px-3 py-2">ผู้จอง</th><th className="px-3 py-2">Booking</th>
          <th className="px-3 py-2">สถานะ</th>
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

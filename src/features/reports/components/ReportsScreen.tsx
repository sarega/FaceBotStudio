import { useCallback, useEffect, useMemo, useState } from "react";
import { BarChart3, Download, RefreshCw, TicketCheck, Users, WalletCards } from "lucide-react";

type ReportSummary = {
  generated_at: string;
  event: { id: string; name: string; event_date: string | null; event_end_date: string | null };
  registrations: {
    total: number;
    registered: number;
    cancelled: number;
    checked_in: number;
    active: number;
    check_in_rate: number;
    by_day: Array<{ date: string; registrations: number; checked_in: number }>;
  };
  direct_tickets: {
    seats: { total: number; available: number; held: number; issued: number; voided: number };
    total: number;
    held: number;
    issued: number;
    checked_in: number;
    voided: number;
    awaiting_payment: number;
    proof_submitted: number;
    verified: number;
    rejected: number;
    refunded: number;
    revenue_verified: number;
    revenue_issued: number;
    by_performance: Array<{ id: string; label: string; tickets: number; issued: number; checked_in: number; revenue_verified: number }>;
    by_class: Array<{ label: string; tickets: number; issued: number; revenue_verified: number }>;
  };
};

type ReportsScreenProps = {
  eventId: string;
  apiFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  canExportDirectTickets: boolean;
};

const money = (value: number) => new Intl.NumberFormat("th-TH", { style: "currency", currency: "THB", maximumFractionDigits: 0 }).format(value || 0);
const number = (value: number) => new Intl.NumberFormat("th-TH").format(value || 0);

function MetricCard({ icon: Icon, label, value, helper, tone = "blue" }: { icon: typeof Users; label: string; value: string; helper: string; tone?: "blue" | "violet" | "emerald" | "amber" }) {
  const colors = {
    blue: "bg-blue-50 text-blue-700",
    violet: "bg-violet-50 text-violet-700",
    emerald: "bg-emerald-50 text-emerald-700",
    amber: "bg-amber-50 text-amber-700",
  };
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold text-slate-500">{label}</p>
          <p className="mt-1 text-2xl font-bold tracking-tight text-slate-900">{value}</p>
        </div>
        <span className={`flex h-9 w-9 items-center justify-center rounded-xl ${colors[tone]}`}><Icon className="h-4 w-4" /></span>
      </div>
      <p className="mt-2 text-[11px] text-slate-500">{helper}</p>
    </div>
  );
}

export function ReportsScreen({ eventId, apiFetch, canExportDirectTickets }: ReportsScreenProps) {
  const [report, setReport] = useState<ReportSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  const loadReport = useCallback(async () => {
    if (!eventId) return;
    setLoading(true);
    setMessage("");
    try {
      const response = await apiFetch(`/api/reports/summary?event_id=${encodeURIComponent(eventId)}`);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error || "โหลดรายงานไม่สำเร็จ");
      setReport(data as ReportSummary);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "โหลดรายงานไม่สำเร็จ");
      setReport(null);
    } finally {
      setLoading(false);
    }
  }, [apiFetch, eventId]);

  useEffect(() => { void loadReport(); }, [loadReport]);

  const peakRegistrations = useMemo(() => Math.max(...(report?.registrations.by_day.map((row) => row.registrations) || [0]), 1), [report]);
  const ticketFillRate = report?.direct_tickets.seats.total ? Math.round(((report.direct_tickets.seats.issued + report.direct_tickets.seats.held) / report.direct_tickets.seats.total) * 100) : 0;

  if (loading && !report) return <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">กำลังสร้างรายงาน…</div>;
  if (!report) return <div className="rounded-2xl border border-rose-200 bg-rose-50 p-5 text-sm text-rose-800">{message || "ยังไม่มีข้อมูลรายงาน"}<button type="button" onClick={() => void loadReport()} className="ml-3 font-bold underline">ลองใหม่</button></div>;

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[.18em] text-blue-600">Event report</p>
          <h2 className="mt-1 text-xl font-bold text-slate-900">{report.event.name}</h2>
          <p className="mt-1 text-xs text-slate-500">สรุปข้อมูลล่าสุดเมื่อ {new Date(report.generated_at).toLocaleString("th-TH")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => void loadReport()} disabled={loading} className="inline-flex items-center gap-2 rounded-xl border border-slate-300 px-3 py-2 text-xs font-bold text-slate-700 disabled:opacity-50"><RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />รีเฟรช</button>
          <a href={`/api/registrations/export?event_id=${encodeURIComponent(eventId)}`} className="inline-flex items-center gap-2 rounded-xl bg-blue-700 px-3 py-2 text-xs font-bold text-white"><Download className="h-3.5 w-3.5" />ผู้ลงทะเบียน CSV</a>
          {canExportDirectTickets && <><a href={`/api/direct-ticketing/tickets/export?event_id=${encodeURIComponent(eventId)}`} className="inline-flex items-center gap-2 rounded-xl border border-violet-300 px-3 py-2 text-xs font-bold text-violet-700"><Download className="h-3.5 w-3.5" />Direct sales CSV</a><a href={`/api/direct-ticketing/inventory/export?event_id=${encodeURIComponent(eventId)}`} className="inline-flex items-center gap-2 rounded-xl border border-slate-300 px-3 py-2 text-xs font-bold text-slate-700"><Download className="h-3.5 w-3.5" />Inventory CSV</a></>}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard icon={Users} label="ผู้ลงทะเบียนทั้งหมด" value={number(report.registrations.total)} helper={`${number(report.registrations.active)} active · ${number(report.registrations.cancelled)} cancelled`} />
        <MetricCard icon={TicketCheck} label="Check-in rate" value={`${report.registrations.check_in_rate}%`} helper={`${number(report.registrations.checked_in)} จาก ${number(report.registrations.active)} active`} tone="emerald" />
        <MetricCard icon={BarChart3} label="Direct tickets" value={number(report.direct_tickets.total)} helper={`${number(report.direct_tickets.issued)} issued · ${number(report.direct_tickets.checked_in)} checked-in`} tone="violet" />
        <MetricCard icon={WalletCards} label="ยอดชำระยืนยันแล้ว" value={money(report.direct_tickets.revenue_verified)} helper={`${number(report.direct_tickets.proof_submitted)} slips รอตรวจ · ${number(report.direct_tickets.rejected)} rejected`} tone="amber" />
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.25fr)_minmax(18rem,.75fr)]">
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between gap-3"><div><h3 className="font-bold text-slate-900">Registration activity</h3><p className="text-xs text-slate-500">จำนวนลงทะเบียนรายวัน (14 วันที่มีข้อมูลล่าสุด)</p></div><span className="rounded-full bg-blue-50 px-2.5 py-1 text-[11px] font-bold text-blue-700">{number(report.registrations.total)} total</span></div>
          <div className="mt-5 space-y-2.5">
            {report.registrations.by_day.length === 0 ? <p className="py-6 text-center text-sm text-slate-400">ยังไม่มีข้อมูลรายวัน</p> : report.registrations.by_day.map((row) => (
              <div key={row.date} className="grid grid-cols-[4.5rem_minmax(0,1fr)_4rem] items-center gap-2 text-xs"><span className="text-slate-500">{new Date(`${row.date}T00:00:00`).toLocaleDateString("th-TH", { day: "2-digit", month: "short" })}</span><div className="h-2.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-blue-500" style={{ width: `${Math.max(5, (row.registrations / peakRegistrations) * 100)}%` }} /></div><span className="text-right font-semibold text-slate-700">{number(row.registrations)} <span className="text-emerald-600">({number(row.checked_in)})</span></span></div>
            ))}
          </div>
          <p className="mt-4 text-[11px] text-slate-400">ตัวเลขในวงเล็บคือ check-in ของวันนั้น</p>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex items-center justify-between"><div><h3 className="font-bold text-slate-900">Direct inventory</h3><p className="text-xs text-slate-500">สถานะที่นั่งที่นำเข้า</p></div><span className="text-lg font-bold text-violet-700">{ticketFillRate}%</span></div><div className="mt-4 h-3 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-violet-500" style={{ width: `${Math.min(100, ticketFillRate)}%` }} /></div><div className="mt-4 grid grid-cols-2 gap-2 text-xs">{([['Available', report.direct_tickets.seats.available], ['Held', report.direct_tickets.seats.held], ['Issued', report.direct_tickets.seats.issued], ['Voided', report.direct_tickets.seats.voided]] as const).map(([label, value]) => <div key={label} className="rounded-xl bg-slate-50 p-3"><p className="text-slate-500">{label}</p><p className="mt-1 text-lg font-bold text-slate-900">{number(value)}</p></div>)}</div><p className="mt-3 text-[11px] text-slate-500">รวม {number(report.direct_tickets.seats.total)} ที่นั่ง · คิดจาก held + issued</p></section>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><h3 className="font-bold text-slate-900">ยอดขายตามรอบการแสดง</h3><p className="mt-1 text-xs text-slate-500">ยอดที่ยืนยันการชำระแล้ว</p><div className="mt-4 divide-y divide-slate-100">{report.direct_tickets.by_performance.length === 0 ? <p className="py-6 text-center text-sm text-slate-400">ยังไม่มี direct ticket</p> : report.direct_tickets.by_performance.map((row) => <div key={row.id} className="flex items-center justify-between gap-3 py-3 text-sm"><div><p className="font-semibold text-slate-800">{row.label}</p><p className="mt-0.5 text-xs text-slate-500">{number(row.issued)} issued · {number(row.checked_in)} checked-in จาก {number(row.tickets)} tickets</p></div><p className="font-bold text-violet-700">{money(row.revenue_verified)}</p></div>)}</div></section>
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex items-center justify-between"><div><h3 className="font-bold text-slate-900">Payment pipeline</h3><p className="mt-1 text-xs text-slate-500">ติดตามสถานะการชำระเงิน</p></div><p className="text-sm font-bold text-slate-700">ออกบัตรแล้ว {money(report.direct_tickets.revenue_issued)}</p></div><div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">{([['Awaiting', report.direct_tickets.awaiting_payment], ['Proof submitted', report.direct_tickets.proof_submitted], ['Verified', report.direct_tickets.verified], ['Rejected', report.direct_tickets.rejected], ['Refunded', report.direct_tickets.refunded], ['Voided tickets', report.direct_tickets.voided]] as const).map(([label, value]) => <div key={label} className="rounded-xl border border-slate-100 bg-slate-50 p-3"><p className="text-[11px] text-slate-500">{label}</p><p className="mt-1 text-xl font-bold text-slate-900">{number(value)}</p></div>)}</div><div className="mt-5"><p className="mb-2 text-xs font-semibold text-slate-600">ประเภทบัตร</p><div className="divide-y divide-slate-100">{report.direct_tickets.by_class.map((row) => <div key={row.label} className="flex items-center justify-between py-2 text-xs"><span className="font-semibold text-slate-700">{row.label} <span className="font-normal text-slate-400">· {number(row.issued)}/{number(row.tickets)} issued</span></span><span className="font-bold text-violet-700">{money(row.revenue_verified)}</span></div>)}</div></div></section>
      </div>
    </div>
  );
}

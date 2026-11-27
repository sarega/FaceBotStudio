import { useCallback, useEffect, useMemo, useState } from "react";
import { Mail, RefreshCw, Search, ShoppingBag, Trash2, UserRound, XCircle, Settings2, KeyRound, LogOut, ShieldOff, ShieldCheck, Pencil } from "lucide-react";

type CustomerEmailDelivery = {
  status: "queued" | "processing" | "sent" | "failed";
  provider: string | null;
  attempt_count: number;
  last_error: string | null;
  queued_at: string;
  sent_at: string | null;
  updated_at: string;
};

type CustomerOrder = {
  id: string;
  event_id: string;
  event_name: string;
  event_slug: string;
  performance_id: string;
  performance_title: string;
  status: string;
  payment_status: string;
  currency: string;
  subtotal_amount: number;
  total_amount: number;
  created_at: string;
  hold_expires_at: string | null;
  tickets: Array<{
    id: string;
    ticket_class: string;
    price_amount: number;
    payment_status: string;
    status: string;
    zone: string;
    row_label: string;
    seat_label: string;
  }>;
};

type CustomerPaidBooking = {
  booking_id:string;booking_reference:string;customer_id:string;
  event_id:string;event_name:string;event_slug:string;
  customer_first_name:string;customer_last_name:string;customer_email:string;
  attendee_count:number;state:string;payment_state:string;
  total_minor:number;created_ms:number;due_ms:number;
  claimed_transfer_ms:number|null;slip_uploaded_ms:number|null;
};
function paidBookingStatus(b:CustomerPaidBooking) {
  return b.state==="confirmed"?"ยืนยันแล้ว":b.state==="verification_pending"?
    "ส่งสลิป · รอตรวจ":b.state==="awaiting_payment"?"ยังไม่ชำระ":
    b.state==="expired"?"หมดอายุ":b.state==="cancelled"?"ยกเลิก":"ต้องตรวจสอบ";
}

type CustomerRecord = {
  id: string;
  can_manage_account?:boolean;
  email: string;
  first_name: string;
  last_name: string;
  phone: string;
  email_verified_at: string | null;
  status: "pending" | "active" | "disabled";
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
  email_delivery: CustomerEmailDelivery | null;
  order_count: number;
  paid_order_count: number;
  paid_amount: number;
  orders: CustomerOrder[];
  booking_count:number;
  paid_bookings:CustomerPaidBooking[];
};

type CustomerResponse = {
  can_delete_unverified?: boolean;
  pagination?:{offset:number;limit:number;has_more:boolean};
  email: { provider: string; worker: "embedded" | "external" };
  summary: {
    total: number;
    verified: number;
    pending: number;
    disabled: number;
    with_orders: number;
    paid_orders: number;
    paid_amount: number;
    bookings:number;awaiting_payment:number;awaiting_review:number;
    confirmed:number;exceptions:number;expired:number;cancelled:number;confirmed_minor:number;
  };
  customers: CustomerRecord[];
  bookings:CustomerPaidBooking[];
};

type Props = {
  language: "th" | "en";
  apiFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  focusCustomerId?:string;
  onOpenBooking?:(booking:CustomerPaidBooking)=>void;
};

const money = (value: number) => new Intl.NumberFormat("th-TH", { style: "currency", currency: "THB", maximumFractionDigits: 0 }).format(value || 0);

function formatDate(value: string | null) {
  if (!value) return "—";
  const normalized = value.includes("T") ? value : `${value.replace(" ", "T")}Z`;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function statusLabel(status: CustomerRecord["status"]) {
  if (status === "active") return "Active";
  if (status === "disabled") return "Disabled";
  return "Pending verification";
}

function deliveryLabel(delivery: CustomerEmailDelivery | null) {
  if (!delivery) return "No verification email record";
  if (delivery.status === "sent") return "Accepted by email provider";
  if (delivery.status === "failed") return "Email delivery failed";
  if (delivery.status === "processing") return "Sending now";
  return "Waiting to send";
}

function badgeClass(tone: "green" | "amber" | "rose" | "slate" | "blue") {
  return {
    green: "border-emerald-200 bg-emerald-50 text-emerald-700",
    amber: "border-amber-200 bg-amber-50 text-amber-700",
    rose: "border-rose-200 bg-rose-50 text-rose-700",
    slate: "border-slate-200 bg-slate-50 text-slate-600",
    blue: "border-blue-200 bg-blue-50 text-blue-700",
  }[tone];
}

function deliveryTone(delivery: CustomerEmailDelivery | null): "green" | "amber" | "rose" | "slate" {
  if (delivery?.status === "sent") return "green";
  if (delivery?.status === "failed") return "rose";
  if (delivery?.status === "queued" || delivery?.status === "processing") return "amber";
  return "slate";
}

export function CustomerManagementScreen({ language, apiFetch,focusCustomerId,onOpenBooking }: Props) {
  const t = (th: string, en: string) => language === "th" ? th : en;
  const [data, setData] = useState<CustomerResponse | null>(null);
  const [query, setQuery] = useState("");
  const [searchTerm,setSearchTerm]=useState("");
  const [offset,setOffset]=useState(0);
  const [focusId,setFocusId]=useState(focusCustomerId||"");
  const [actionsOpen,setActionsOpen]=useState(false);
  const [editProfile,setEditProfile]=useState(false);
  const [profile,setProfile]=useState({first_name:"",last_name:"",phone:""});
  useEffect(()=>{const timer=window.setTimeout(()=>{setSearchTerm(query.trim());setOffset(0);},250);return ()=>window.clearTimeout(timer);},[query]);
  useEffect(()=>{if(focusCustomerId){setFocusId(focusCustomerId);setOffset(0);}},[focusCustomerId]);
  const [statusFilter, setStatusFilter] = useState<"all" | "email_failed" | CustomerRecord["status"]>("all");
  const [selectedId, setSelectedId] = useState("");
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState("");
  const [message, setMessage] = useState("");
  const [exporting,setExporting]=useState(false);
  const [bookingQuery,setBookingQuery]=useState("");
  const [bookingFilter,setBookingFilter]=useState("all");

  const load = useCallback(async (signal?:AbortSignal) => {
    setLoading(true);
    try {
      const params=new URLSearchParams({limit:"50",offset:String(offset),search:searchTerm,status:statusFilter});
      if(focusId){params.set("id",focusId);params.set("search","");params.set("status","all");}
      const response = await apiFetch("/api/admin/customers?"+params.toString(),{signal});
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || "Failed to load customer accounts");
      if(!signal?.aborted)setData(payload as CustomerResponse);
    } catch (error) {
      if(!signal?.aborted){setMessage(error instanceof Error ? error.message : "Failed to load customer accounts");setData(null);}
    } finally {
      if(!signal?.aborted)setLoading(false);
    }
  }, [apiFetch,offset,searchTerm,statusFilter,focusId]);

  useEffect(() => {const c=new AbortController();void load(c.signal);return ()=>c.abort();}, [load]);

  const filteredBookings=useMemo(()=>{
    const q=bookingQuery.trim().toLowerCase();
    return (data?.bookings||[]).filter(booking=>
      (bookingFilter==="all"||booking.state===bookingFilter) &&
      (!q||[booking.event_name,booking.booking_reference,booking.customer_first_name,
        booking.customer_last_name,booking.customer_email,booking.customer_id,booking.event_id]
        .join(" ").toLowerCase().includes(q)));
  },[data?.bookings,bookingQuery,bookingFilter]);
  const filteredCustomers = data?.customers||[];
  useEffect(() => {
    if (filteredCustomers.some((customer) => customer.id === selectedId)) return;
    setSelectedId(filteredCustomers[0]?.id || "");
  }, [filteredCustomers, selectedId]);

  const selectedCustomer = filteredCustomers.find((customer) => customer.id === selectedId) || null;
  useEffect(()=>{setActionsOpen(false);setEditProfile(false);},[selectedId]);
  async function manageAccount(action:string,patch:Record<string,string>={}){
    if(!selectedCustomer?.can_manage_account||busyId)return;
    const labels:Record<string,string>={profile:t("แก้ไขข้อมูลบัญชี","Edit account profile"),suspend:t("ระงับบัญชีและออกจากระบบทุกอุปกรณ์","Suspend account and revoke sessions"),reactivate:t("เปิดบัญชีกลับมาใช้งาน","Reactivate account"),reset_password:t("ส่งลิงก์ตั้งรหัสผ่านใหม่","Send password reset link"),revoke_sessions:t("ออกจากระบบทุกอุปกรณ์","Sign out all devices")};
    if(!window.confirm(labels[action]+" · "+selectedCustomer.email+"?"))return;
    const reason=window.prompt(t("ระบุเหตุผลในการจัดการบัญชี","Reason for account action"));
    if(!reason?.trim())return;
    setBusyId(selectedCustomer.id);setMessage("");
    try{
      const response=await apiFetch("/api/admin/customers/"+encodeURIComponent(selectedCustomer.id)+"/manage",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action,reason,...patch})});
      const result=await response.json().catch(()=>({}));
      if(!response.ok)throw new Error(result.error||"customer_action_failed");
      setEditProfile(false);setActionsOpen(false);await load();
      setMessage(action==="reset_password"?t("ส่งคำขอเข้าคิวอีเมลแล้ว","Password reset email queued"):t("จัดการบัญชีสำเร็จ","Account updated"));
    }catch(e){setMessage(t("ดำเนินการไม่สำเร็จ: ","Action failed: ")+(e instanceof Error?e.message:""));}
    finally{setBusyId("");}
  }


  async function deleteUnverified(customer: CustomerRecord) {
    if (busyId || !window.confirm(t(`ลบบัญชีที่ยังไม่ยืนยัน ${customer.email}? เจ้าของอีเมลจะต้องสมัครใหม่`, `Delete the unverified account ${customer.email}? The email owner will need to register again.`))) return;
    setBusyId(customer.id);
    setMessage("");
    try {
      const response = await apiFetch(`/api/admin/customers/${encodeURIComponent(customer.id)}`, { method: "DELETE" });
      if (!response.ok) {
        setMessage(response.status === 409
          ? t("ลบไม่ได้ บัญชีอาจมีการยืนยันแล้วหรือมีรายการจอง ลงทะเบียน หรือบัตรผูกอยู่", "The account may already be verified or linked to a booking, registration or ticket.")
          : t("ลบบัญชีไม่สำเร็จ", "Could not delete the account."));
        return;
      }
      await load();
      setMessage(t("ลบบัญชีที่ยังไม่ยืนยันแล้ว", "Unverified account deleted."));
    } catch {
      setMessage(t("ลบบัญชีไม่สำเร็จ", "Could not delete the account."));
    } finally {
      setBusyId("");
    }
  }

  const resendVerification = async (customer: CustomerRecord) => {
    setBusyId(customer.id);
    setMessage("");
    try {
      const response = await apiFetch(`/api/admin/customers/${encodeURIComponent(customer.id)}/resend-verification`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || "Failed to resend verification email");
      setMessage(payload?.verification_delivery_queued === false
        ? "The verification email could not be queued. Check the email configuration."
        : `Verification email queued for ${customer.email}.`);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to resend verification email");
    } finally {
      setBusyId("");
    }
  };

  async function exportCsv(path:string,filename:string) {
    if(exporting)return;
    setExporting(true);
    try {
      const response=await apiFetch(path);
      if(!response.ok)throw new Error("ไม่สามารถส่งออกไฟล์ได้ โปรดตรวจสอบสิทธิ์และจำนวนรายการ");
      const url=URL.createObjectURL(await response.blob());
      const anchor=document.createElement("a");
      anchor.href=url;anchor.download=filename;
      document.body.appendChild(anchor);anchor.click();anchor.remove();
      URL.revokeObjectURL(url);
    }catch(error){setMessage(error instanceof Error?error.message:"Export failed");}
    finally{setExporting(false);}
  }
  const summary = data?.summary || {
    total:0,verified:0,pending:0,disabled:0,with_orders:0,paid_orders:0,paid_amount:0,
    bookings:0,awaiting_payment:0,awaiting_review:0,confirmed:0,exceptions:0,
    expired:0,cancelled:0,confirmed_minor:0,
  };

  return (
    <div className="customer-management-screen space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-950">{t("บัญชีลูกค้า", "Customer accounts")}</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" disabled={exporting}
            onClick={()=>void exportCsv("/api/admin/customers/attendee-roster.csv","meetrix-all-events-attendee-roster.csv")}
            className="rounded-xl bg-emerald-600 px-3 py-2 text-sm font-bold text-white hover:bg-emerald-500 disabled:opacity-50">
            {exporting?t("กำลังส่งออก…", "Exporting…"):t("ส่งออกรายชื่อผู้เข้าร่วม", "Export attendees")}
          </button>
          <button type="button" disabled={exporting}
            onClick={()=>void exportCsv("/api/admin/customers/paid-bookings.csv","meetrix-paid-bookings.csv")}
            className="rounded-xl border border-blue-300 bg-white px-3 py-2 text-sm font-bold text-blue-700 hover:bg-blue-50 disabled:opacity-50">
            {t("ส่งออกรายการจอง", "Export bookings")}
          </button>
        <button type="button" onClick={() => void load()} disabled={loading} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm hover:border-blue-300 hover:text-blue-700 disabled:opacity-50">
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> {t("รีเฟรช", "Refresh")}
        </button>
        </div>
      </div>

      <dl aria-label="Customer and booking summary" className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,9rem),1fr))] gap-1.5">
        {[
          { label: t("บัญชีในหน้านี้", "Accounts on page"), value: summary.total },
          { label: t("ยืนยันอีเมล (หน้านี้)", "Verified on page"), value: summary.verified },
          { label: t("รอยืนยัน (หน้านี้)", "Pending on page"), value: summary.pending },
          { label: t("การจองทุกงาน", "All event bookings"), value: summary.bookings },
          { label: t("รอชำระเงิน", "Awaiting payment"), value: summary.awaiting_payment },
          { label: t("รอตรวจสลิป", "Slips to review"), value: summary.awaiting_review },
          { label: t("ยืนยันการจองแล้ว", "Confirmed bookings"), value: summary.confirmed, amount: money(summary.confirmed_minor / 100) },
          { label: t("หมดอายุ / ยกเลิก", "Expired / cancelled"), value: summary.expired + summary.cancelled },
          { label: t("ออเดอร์ตั๋ว (หน้านี้)", "Ticket orders on page"), value: summary.paid_orders },
        ].map(({ label, value, amount }) => (
          <div key={label} className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5 rounded-lg border border-slate-200 bg-white px-2.5 py-2">
            <dt className="text-xs font-medium leading-snug text-slate-600">{label}</dt>
            <dd className="text-base font-bold leading-tight text-slate-900 tabular-nums">{value}</dd>
            {amount && <dd className="basis-full text-xs font-medium text-emerald-700 tabular-nums">{amount}</dd>}
          </div>
        ))}
      </dl>

      {data && <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center gap-2 p-3">
          <h2 className="mr-auto font-bold text-slate-900">
            Bookings ทุก Event · {filteredBookings.length} รายการ
          </h2>
          <input value={bookingQuery} onChange={e=>setBookingQuery(e.target.value)}
            aria-label="Search bookings by event or customer"
            className="min-w-0 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
            placeholder="ค้นหาชื่องาน / ลูกค้า / เลขจอง"/>
          <select value={bookingFilter} onChange={e=>setBookingFilter(e.target.value)}
            aria-label="Filter booking status"
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm">
            <option value="all">ทุกสถานะ</option>
            <option value="awaiting_payment">รอชำระเงิน</option>
            <option value="verification_pending">ส่งสลิป · รอตรวจสอบ</option>
            <option value="confirmed">ยืนยันแล้ว</option>
            <option value="payment_exception">ต้องตรวจสอบเพิ่มเติม</option>
            <option value="expired">หมดอายุ</option>
            <option value="cancelled">ยกเลิก</option>
          </select>
        </div>
        <div className="max-h-80 overflow-auto">
          <table className="w-full min-w-[690px] border-collapse text-left text-xs">
            <thead className="sticky top-0 bg-slate-100 text-slate-600">
              <tr>
                <th className="px-3 py-2">Event / งาน</th>
                <th className="px-3 py-2">บัญชีลูกค้า</th>
                <th className="px-3 py-2">Booking</th>
                <th className="px-3 py-2">ยอด</th>
                <th className="px-3 py-2">สถานะ</th>
                <th className="px-3 py-2">วันที่ / เวลา</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredBookings.slice(0,300).map(booking=><tr key={booking.booking_id}>
                <td className="px-3 py-2 font-medium text-slate-900">{booking.event_name}</td>
                <td className="px-3 py-2">
                  <button type="button" className="text-left text-blue-700 underline"
                    onClick={()=>{setQuery("");setStatusFilter("all");setSelectedId(booking.customer_id);}}>
                    {booking.customer_first_name} {booking.customer_last_name}
                  </button>
                  <span className="block text-slate-500">{booking.customer_email}</span>
                </td>
                <td className="px-3 py-2 text-slate-600">
                  <span className="block font-medium">{booking.booking_reference}</span>
                  <span>{booking.attendee_count} คน</span>
                </td>
                <td className="whitespace-nowrap px-3 py-2 font-semibold">{money(booking.total_minor/100)}</td>
                <td className="px-3 py-2 font-medium text-amber-800">{paidBookingStatus(booking)}</td>
                <td className="whitespace-nowrap px-3 py-2 text-slate-500">
                  จอง {new Date(booking.created_ms).toLocaleString("th-TH")}
                  {booking.claimed_transfer_ms!=null && <span className="block">โอน {new Date(booking.claimed_transfer_ms).toLocaleString("th-TH")}</span>}
                  {booking.slip_uploaded_ms!=null && <span className="block">ส่งสลิป {new Date(booking.slip_uploaded_ms).toLocaleString("th-TH")}</span>}
                </td>
              </tr>)}
            </tbody>
          </table>
          {filteredBookings.length===0 && <p className="p-4 text-sm text-slate-500">ไม่มีรายการจองตามเงื่อนไขนี้</p>}
        </div>
        {filteredBookings.length>300&&<p className="px-3 py-2 text-xs text-slate-500">
          แสดง 300 รายการแรก · ใช้ Search หรือ Export Excel / CSV เพื่อดูรายการทั้งหมด
        </p>}
      </section>}

      <div className="customer-management-email-notice flex flex-wrap items-center gap-2 rounded-2xl border border-blue-200 bg-blue-50/70 px-3 py-2 text-xs text-blue-900">
        <Mail className="h-4 w-4 shrink-0 text-blue-600" />
        <span>Email: <strong>{data?.email.provider || "—"}</strong> · worker: <strong>{data?.email.worker || "—"}</strong> · “sent” means the provider accepted the message; it does not guarantee inbox delivery.</span>
      </div>

      {message && <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">{message}</div>}
      {loading && !data ? <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">Loading customer accounts…</div> : data && (
        <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
          <section className="min-w-0 rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 p-3">
              <div className="relative min-w-[220px] flex-1"><Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" /><input value={query} onChange={(event) => {setFocusId("");setQuery(event.target.value);}} placeholder="Search name, email, phone" className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2 pl-9 pr-3 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100" /></div>
              <select value={statusFilter} onChange={(event) => {setFocusId("");setOffset(0);setStatusFilter(event.target.value as typeof statusFilter);}} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-blue-400">
                <option value="all">All statuses</option><option value="pending">Pending</option><option value="active">Active</option><option value="disabled">Disabled</option>
                <option value="email_failed">{t("อีเมลยืนยันส่งไม่สำเร็จ", "Verification email failed")}</option>
              </select>
              <span className="text-xs text-slate-500">{offset+1}–{offset+filteredCustomers.length}</span>
              {focusId&&<button className="registration-admin-control" onClick={()=>{setFocusId("");setQuery("");setSearchTerm("");setOffset(0);}}>{t("แสดงทุกบัญชี","All accounts")}</button>}
              <button className="registration-admin-control" disabled={loading||offset===0||!!focusId} onClick={()=>setOffset(v=>Math.max(0,v-50))}>{t("ก่อนหน้า","Previous")}</button>
              <button className="registration-admin-control" disabled={loading||!data?.pagination?.has_more||!!focusId} onClick={()=>setOffset(v=>v+50)}>{t("ถัดไป","Next")}</button>
            </div>
            <div className="divide-y divide-slate-100">
              {filteredCustomers.length === 0 ? <div className="p-8 text-center text-sm text-slate-500">No customer accounts match this filter.</div> : filteredCustomers.map((customer) => {
                const selected = customer.id === selectedId;
                const delivery = customer.email_delivery;
                return <button key={customer.id} type="button" onClick={() => setSelectedId(customer.id)} className={`grid w-full grid-cols-[minmax(0,1.4fr)_auto_auto] items-center gap-3 px-3 py-3 text-left transition-colors ${selected ? "customer-management-row-selected bg-blue-50/80" : "hover:bg-slate-50"}`}>
                  <div className="min-w-0"><p className="truncate text-sm font-semibold text-slate-900">{customer.first_name} {customer.last_name}</p><p className="truncate text-xs text-slate-500">{customer.email}</p><p className="truncate text-[11px] text-slate-400">สมัคร {formatDate(customer.created_at)}</p></div>
                  <span className={`rounded-full border px-2 py-1 text-[10px] font-semibold ${badgeClass(customer.status === "active" ? "green" : customer.status === "pending" ? "amber" : "rose")}`}>{statusLabel(customer.status)}</span>
                  <div className="text-right"><p className="text-xs font-semibold text-slate-700">{customer.booking_count} bookings</p><p className={`text-[10px] ${delivery?.status === "sent" ? "text-emerald-600" : delivery?.status === "failed" ? "text-rose-600" : "text-slate-400"}`}>{delivery?.status || "no mail"}</p></div>
                </button>;
              })}
            </div>
          </section>

          <aside className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm xl:sticky xl:top-4 xl:self-start">
            {!selectedCustomer ? <div className="py-10 text-center text-sm text-slate-500">Select a customer to inspect the account.</div> : <>
              <div className="flex items-start justify-between gap-3"><div className="flex min-w-0 items-center gap-3"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600"><UserRound className="h-5 w-5" /></span><div className="min-w-0"><h2 className="truncate font-semibold text-slate-950">{selectedCustomer.first_name} {selectedCustomer.last_name}</h2><p className="truncate text-xs text-slate-500">{selectedCustomer.email}</p></div></div><span className={`rounded-full border px-2 py-1 text-[10px] font-semibold ${badgeClass(selectedCustomer.status === "active" ? "green" : selectedCustomer.status === "pending" ? "amber" : "rose")}`}>{statusLabel(selectedCustomer.status)}</span></div>
              <div className="mt-4 grid grid-cols-2 gap-2 text-xs"><div className="rounded-xl bg-slate-50 p-2.5"><p className="text-slate-500">Phone</p><p className="mt-1 font-semibold text-slate-800">{selectedCustomer.phone || "—"}</p></div><div className="rounded-xl bg-slate-50 p-2.5"><p className="text-slate-500">Last login</p><p className="mt-1 font-semibold text-slate-800">{formatDate(selectedCustomer.last_login_at)}</p></div></div>
              <div className={`mt-3 rounded-xl border p-3 text-xs ${badgeClass(deliveryTone(selectedCustomer.email_delivery))}`}><div className="flex items-center justify-between gap-2"><p className="font-semibold">Verification email</p><span className="font-bold uppercase">{selectedCustomer.email_delivery?.status || "none"}</span></div><p className="mt-1">{deliveryLabel(selectedCustomer.email_delivery)}</p>{selectedCustomer.email_delivery?.sent_at && <p className="mt-1 text-[11px] opacity-75">Provider accepted at {formatDate(selectedCustomer.email_delivery.sent_at)}</p>}{selectedCustomer.email_delivery?.last_error && <p className="mt-1 break-words text-[11px]">{selectedCustomer.email_delivery.last_error}</p>}</div>
              {selectedCustomer.can_manage_account ? <div className="mt-3 space-y-2">
                <button className="registration-admin-control w-full justify-between" aria-expanded={actionsOpen} onClick={()=>setActionsOpen(v=>!v)}><Settings2 size={16}/>{t("จัดการบัญชี","Account actions")}</button>
                {actionsOpen&&<div className="grid gap-1 rounded-lg border border-slate-200 p-2">
                  {selectedCustomer.status!=="disabled"&&<>
                    <button className="registration-admin-control justify-start" disabled={!!busyId} onClick={()=>{setProfile({first_name:selectedCustomer.first_name,last_name:selectedCustomer.last_name,phone:selectedCustomer.phone});setEditProfile(v=>!v);}}><Pencil size={15}/>{t("แก้ไขข้อมูลบัญชี","Edit profile")}</button>
                    {selectedCustomer.status==="pending"&&<button className="registration-admin-control justify-start" disabled={!!busyId} onClick={()=>void resendVerification(selectedCustomer)}><Mail size={15}/>{t("ส่งอีเมลยืนยันซ้ำ","Resend verification")}</button>}
                    <button className="registration-admin-control justify-start" disabled={!!busyId} onClick={()=>void manageAccount("reset_password")}><KeyRound size={15}/>{t("ส่งลิงก์ Reset Password","Send password reset")}</button>
                    <button className="registration-admin-control justify-start" disabled={!!busyId} onClick={()=>void manageAccount("revoke_sessions")}><LogOut size={15}/>{t("ออกจากระบบทุกอุปกรณ์","Revoke sessions")}</button>
                    <button className="registration-admin-control justify-start text-amber-700" disabled={!!busyId} onClick={()=>void manageAccount("suspend")}><ShieldOff size={15}/>{t("ระงับบัญชี","Suspend account")}</button>
                  </>}
                  {selectedCustomer.status==="disabled"&&<button className="registration-admin-control justify-start" disabled={!!busyId} onClick={()=>void manageAccount("reactivate")}><ShieldCheck size={15}/>{t("เปิดบัญชีอีกครั้ง","Reactivate account")}</button>}
                  {data?.can_delete_unverified&&selectedCustomer.status==="pending"&&!selectedCustomer.email_verified_at&&selectedCustomer.booking_count===0&&selectedCustomer.order_count===0&&<button className="registration-admin-control justify-start text-rose-700" disabled={!!busyId} onClick={()=>void deleteUnverified(selectedCustomer)}><Trash2 size={15}/>{t("ลบบัญชีที่ยังไม่ยืนยัน","Delete unverified account")}</button>}
                </div>}
                {editProfile&&<form className="grid gap-2 rounded-lg border border-slate-200 p-2" onSubmit={e=>{e.preventDefault();void manageAccount("profile",profile);}}>
                  {(["first_name","last_name","phone"] as const).map((key,i)=><label key={key} className="text-xs">{[t("ชื่อ","First name"),t("นามสกุล","Last name"),t("โทรศัพท์","Phone")][i]}<input className="block w-full rounded border border-slate-300 px-2 py-1 text-sm" required value={profile[key]} onChange={e=>setProfile(p=>({...p,[key]:e.target.value}))}/></label>)}
                  <button className="registration-admin-control registration-admin-control-primary" disabled={!!busyId} type="submit">{t("บันทึก","Save")}</button>
                </form>}
              </div>:<p className="mt-3 text-xs text-slate-500">{t("บัญชีส่วนกลางหรือบัญชี Staff: ดูข้อมูลได้เท่านั้น","Shared or staff identity: read-only")}</p>}
              <section className="mt-5 space-y-2">
                <h3 className="font-bold text-slate-900">การจองสัมมนา · Event bookings ({selectedCustomer.booking_count})</h3>
                {selectedCustomer.paid_bookings.length===0 ?
                  <p className="rounded-xl bg-slate-50 p-3 text-sm text-slate-500">ยังไม่มี Booking จากบัญชีนี้</p> :
                  selectedCustomer.paid_bookings.map((booking)=><div key={booking.booking_id}
                    className="space-y-2 rounded-xl border border-slate-200 p-3 text-xs">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <strong className="text-sm text-slate-900">{booking.event_name}</strong>
                      <span className="rounded-full bg-amber-50 px-2 py-1 font-semibold text-amber-800">
                        {paidBookingStatus(booking)}
                      </span>
                    </div>
                    <p className="text-slate-600">
                      {booking.attendee_count} คน · {money(booking.total_minor/100)} ·
                      จองเมื่อ {new Date(booking.created_ms).toLocaleString("th-TH")}
                    </p>
                    <p className="break-all text-slate-500">Booking: {booking.booking_reference}</p>
                    {onOpenBooking&&<button type="button"
                      className="rounded-lg border border-blue-300 px-3 py-2 font-semibold text-blue-700"
                      onClick={()=>onOpenBooking(booking)}>
                      เปิดรายการจองใน Event / Review booking
                    </button>}
                    {booking.claimed_transfer_ms!=null&&<p className="text-slate-600">
                      โอนเมื่อ {new Date(booking.claimed_transfer_ms).toLocaleString("th-TH")}
                    </p>}
                    {booking.slip_uploaded_ms!=null&&<p className="font-medium text-amber-700">
                      ส่งสลิปเมื่อ {new Date(booking.slip_uploaded_ms).toLocaleString("th-TH")}
                    </p>}
                  </div>)}
              </section>
              <div className="mt-5 flex items-center justify-between"><div><p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">Ticket orders (separate system)</p><p className="mt-1 text-sm font-semibold text-slate-900">{selectedCustomer.order_count} ticket orders · {money(selectedCustomer.paid_amount)} paid</p></div><ShoppingBag className="h-5 w-5 text-slate-400" /></div>
              <div className="mt-3 space-y-2">{selectedCustomer.orders.length === 0 ? <p className="rounded-xl bg-slate-50 p-3 text-xs text-slate-500">ยังไม่มี order ที่ผูกกับบัญชีนี้</p> : selectedCustomer.orders.map((order) => <div key={order.id} className="rounded-xl border border-slate-200 p-3"><div className="flex items-start justify-between gap-2"><div className="min-w-0"><p className="truncate text-sm font-semibold text-slate-900">{order.event_name}</p><p className="truncate text-xs text-slate-500">{order.performance_title} · {formatDate(order.created_at)}</p></div><span className={`rounded-full border px-2 py-1 text-[10px] font-semibold ${badgeClass(order.status === "paid" ? "green" : order.status === "payment_submitted" ? "amber" : order.status === "rejected" || order.status === "expired" ? "rose" : "slate")}`}>{order.status}</span></div><div className="mt-2 flex flex-wrap gap-1.5">{order.tickets.map((ticket) => <span key={ticket.id} className="rounded-lg bg-slate-100 px-2 py-1 text-[11px] text-slate-700">{ticket.ticket_class} · {ticket.zone ? `${ticket.zone} ` : ""}{ticket.row_label}-{ticket.seat_label} · {money(ticket.price_amount)}</span>)}</div><div className="mt-2 text-right text-xs font-semibold text-slate-700">Total {money(order.total_amount)}</div></div>)}</div>
            </>}
          </aside>
        </div>
      )}
      {!loading && !data && <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800"><div className="flex items-center gap-2 font-semibold"><XCircle className="h-4 w-4" /> {message || "Customer data is unavailable"}</div></div>}
    </div>
  );
}

import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, Clock3, Mail, RefreshCw, Search, ShoppingBag, UserRound, Users, XCircle } from "lucide-react";

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

type CustomerRecord = {
  id: string;
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
};

type CustomerResponse = {
  email: { provider: string; worker: "embedded" | "external" };
  summary: {
    total: number;
    verified: number;
    pending: number;
    disabled: number;
    with_orders: number;
    paid_orders: number;
    paid_amount: number;
  };
  customers: CustomerRecord[];
};

type Props = {
  apiFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
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

export function CustomerManagementScreen({ apiFetch }: Props) {
  const [data, setData] = useState<CustomerResponse | null>(null);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | CustomerRecord["status"]>("all");
  const [selectedId, setSelectedId] = useState("");
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setMessage("");
    try {
      const response = await apiFetch("/api/admin/customers?limit=500");
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || "Failed to load customer accounts");
      setData(payload as CustomerResponse);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to load customer accounts");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [apiFetch]);

  useEffect(() => { void load(); }, [load]);

  const filteredCustomers = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return (data?.customers || []).filter((customer) => {
      if (statusFilter !== "all" && customer.status !== statusFilter) return false;
      if (!normalizedQuery) return true;
      return [customer.first_name, customer.last_name, customer.email, customer.phone]
        .join(" ")
        .toLowerCase()
        .includes(normalizedQuery);
    });
  }, [data?.customers, query, statusFilter]);

  useEffect(() => {
    if (filteredCustomers.some((customer) => customer.id === selectedId)) return;
    setSelectedId(filteredCustomers[0]?.id || "");
  }, [filteredCustomers, selectedId]);

  const selectedCustomer = filteredCustomers.find((customer) => customer.id === selectedId) || null;

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

  const summary = data?.summary || { total: 0, verified: 0, pending: 0, disabled: 0, with_orders: 0, paid_orders: 0, paid_amount: 0 };

  return (
    <div className="customer-management-screen space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-blue-600">Customer management</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-950">Customer accounts</h1>
          <p className="mt-1 text-sm text-slate-500">ดูบัญชีลูกค้า การยืนยันอีเมล และประวัติการซื้อจาก Meetrix</p>
        </div>
        <button type="button" onClick={() => void load()} disabled={loading} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm hover:border-blue-300 hover:text-blue-700 disabled:opacity-50">
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {[
          { label: "Accounts", value: summary.total, helper: "เปิดบัญชีทั้งหมด", icon: Users, tone: "blue" as const },
          { label: "Verified", value: summary.verified, helper: "ยืนยันอีเมลแล้ว", icon: CheckCircle2, tone: "green" as const },
          { label: "Pending", value: summary.pending, helper: "รอยืนยันอีเมล", icon: Clock3, tone: "amber" as const },
          { label: "Paid orders", value: summary.paid_orders, helper: money(summary.paid_amount), icon: ShoppingBag, tone: "blue" as const },
        ].map(({ label, value, helper, icon: Icon, tone }) => (
          <div key={label} className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
            <div className="flex items-start justify-between gap-2"><div><p className="text-[11px] font-semibold text-slate-500">{label}</p><p className="mt-1 text-xl font-bold text-slate-950">{value}</p></div><span className={`flex h-8 w-8 items-center justify-center rounded-xl ${tone === "green" ? "bg-emerald-50 text-emerald-600" : "bg-blue-50 text-blue-600"}`}><Icon className="h-4 w-4" /></span></div>
            <p className="mt-1 text-[11px] text-slate-500">{helper}</p>
          </div>
        ))}
      </div>

      <div className="customer-management-email-notice flex flex-wrap items-center gap-2 rounded-2xl border border-blue-200 bg-blue-50/70 px-3 py-2 text-xs text-blue-900">
        <Mail className="h-4 w-4 shrink-0 text-blue-600" />
        <span>Email: <strong>{data?.email.provider || "—"}</strong> · worker: <strong>{data?.email.worker || "—"}</strong> · “sent” means the provider accepted the message; it does not guarantee inbox delivery.</span>
      </div>

      {message && <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">{message}</div>}
      {loading && !data ? <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">Loading customer accounts…</div> : data && (
        <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
          <section className="min-w-0 rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 p-3">
              <div className="relative min-w-[220px] flex-1"><Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search name, email, phone" className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2 pl-9 pr-3 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100" /></div>
              <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-blue-400">
                <option value="all">All statuses</option><option value="pending">Pending</option><option value="active">Active</option><option value="disabled">Disabled</option>
              </select>
              <span className="text-xs text-slate-500">{filteredCustomers.length} shown</span>
            </div>
            <div className="divide-y divide-slate-100">
              {filteredCustomers.length === 0 ? <div className="p-8 text-center text-sm text-slate-500">No customer accounts match this filter.</div> : filteredCustomers.map((customer) => {
                const selected = customer.id === selectedId;
                const delivery = customer.email_delivery;
                return <button key={customer.id} type="button" onClick={() => setSelectedId(customer.id)} className={`grid w-full grid-cols-[minmax(0,1.4fr)_auto_auto] items-center gap-3 px-3 py-3 text-left transition-colors ${selected ? "customer-management-row-selected bg-blue-50/80" : "hover:bg-slate-50"}`}>
                  <div className="min-w-0"><p className="truncate text-sm font-semibold text-slate-900">{customer.first_name} {customer.last_name}</p><p className="truncate text-xs text-slate-500">{customer.email}</p><p className="truncate text-[11px] text-slate-400">สมัคร {formatDate(customer.created_at)}</p></div>
                  <span className={`rounded-full border px-2 py-1 text-[10px] font-semibold ${badgeClass(customer.status === "active" ? "green" : customer.status === "pending" ? "amber" : "rose")}`}>{statusLabel(customer.status)}</span>
                  <div className="text-right"><p className="text-xs font-semibold text-slate-700">{customer.order_count} orders</p><p className={`text-[10px] ${delivery?.status === "sent" ? "text-emerald-600" : delivery?.status === "failed" ? "text-rose-600" : "text-slate-400"}`}>{delivery?.status || "no mail"}</p></div>
                </button>;
              })}
            </div>
          </section>

          <aside className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm xl:sticky xl:top-4 xl:self-start">
            {!selectedCustomer ? <div className="py-10 text-center text-sm text-slate-500">Select a customer to inspect the account.</div> : <>
              <div className="flex items-start justify-between gap-3"><div className="flex min-w-0 items-center gap-3"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600"><UserRound className="h-5 w-5" /></span><div className="min-w-0"><h2 className="truncate font-semibold text-slate-950">{selectedCustomer.first_name} {selectedCustomer.last_name}</h2><p className="truncate text-xs text-slate-500">{selectedCustomer.email}</p></div></div><span className={`rounded-full border px-2 py-1 text-[10px] font-semibold ${badgeClass(selectedCustomer.status === "active" ? "green" : selectedCustomer.status === "pending" ? "amber" : "rose")}`}>{statusLabel(selectedCustomer.status)}</span></div>
              <div className="mt-4 grid grid-cols-2 gap-2 text-xs"><div className="rounded-xl bg-slate-50 p-2.5"><p className="text-slate-500">Phone</p><p className="mt-1 font-semibold text-slate-800">{selectedCustomer.phone || "—"}</p></div><div className="rounded-xl bg-slate-50 p-2.5"><p className="text-slate-500">Last login</p><p className="mt-1 font-semibold text-slate-800">{formatDate(selectedCustomer.last_login_at)}</p></div></div>
              <div className={`mt-3 rounded-xl border p-3 text-xs ${badgeClass(deliveryTone(selectedCustomer.email_delivery))}`}><div className="flex items-center justify-between gap-2"><p className="font-semibold">Verification email</p><span className="font-bold uppercase">{selectedCustomer.email_delivery?.status || "none"}</span></div><p className="mt-1">{deliveryLabel(selectedCustomer.email_delivery)}</p>{selectedCustomer.email_delivery?.sent_at && <p className="mt-1 text-[11px] opacity-75">Provider accepted at {formatDate(selectedCustomer.email_delivery.sent_at)}</p>}{selectedCustomer.email_delivery?.last_error && <p className="mt-1 break-words text-[11px]">{selectedCustomer.email_delivery.last_error}</p>}</div>
              {selectedCustomer.status === "pending" && <button type="button" onClick={() => void resendVerification(selectedCustomer)} disabled={busyId === selectedCustomer.id} className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-3 py-2.5 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-50"><Mail className="h-4 w-4" />{busyId === selectedCustomer.id ? "Queueing…" : "Resend verification email"}</button>}
              <div className="mt-5 flex items-center justify-between"><div><p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">Purchase history</p><p className="mt-1 text-sm font-semibold text-slate-900">{selectedCustomer.order_count} orders · {money(selectedCustomer.paid_amount)} paid</p></div><ShoppingBag className="h-5 w-5 text-slate-400" /></div>
              <div className="mt-3 space-y-2">{selectedCustomer.orders.length === 0 ? <p className="rounded-xl bg-slate-50 p-3 text-xs text-slate-500">ยังไม่มี order ที่ผูกกับบัญชีนี้</p> : selectedCustomer.orders.map((order) => <div key={order.id} className="rounded-xl border border-slate-200 p-3"><div className="flex items-start justify-between gap-2"><div className="min-w-0"><p className="truncate text-sm font-semibold text-slate-900">{order.event_name}</p><p className="truncate text-xs text-slate-500">{order.performance_title} · {formatDate(order.created_at)}</p></div><span className={`rounded-full border px-2 py-1 text-[10px] font-semibold ${badgeClass(order.status === "paid" ? "green" : order.status === "payment_submitted" ? "amber" : order.status === "rejected" || order.status === "expired" ? "rose" : "slate")}`}>{order.status}</span></div><div className="mt-2 flex flex-wrap gap-1.5">{order.tickets.map((ticket) => <span key={ticket.id} className="rounded-lg bg-slate-100 px-2 py-1 text-[11px] text-slate-700">{ticket.ticket_class} · {ticket.zone ? `${ticket.zone} ` : ""}{ticket.row_label}-{ticket.seat_label} · {money(ticket.price_amount)}</span>)}</div><div className="mt-2 text-right text-xs font-semibold text-slate-700">Total {money(order.total_amount)}</div></div>)}</div>
            </>}
          </aside>
        </div>
      )}
      {!loading && !data && <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800"><div className="flex items-center gap-2 font-semibold"><XCircle className="h-4 w-4" /> {message || "Customer data is unavailable"}</div></div>}
    </div>
  );
}

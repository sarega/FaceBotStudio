import { useEffect, useState } from "react";
import { Bell, CalendarDays, CheckCircle2, ChevronRight, ClipboardList, FileImage, LayoutDashboard, LogOut, Menu, Shield, Ticket, UserRound, X } from "lucide-react";
import { customerApi, type CustomerAccount } from "./CustomerAccountScreen";

type CustomerAppSection = "dashboard" | "tickets" | "orders" | "profile" | "notifications" | "security";

type RegistrationRecord = {
  id: string;
  event_id: string | null;
  first_name: string;
  last_name: string;
  timestamp: string;
  status: string;
  ticket?: { png_url?: string; svg_url?: string };
};

type CustomerTicket = {
  id: string;
  order_id?: string;
  ticket_class: string;
  holder_name: string;
  price_amount: number;
  payment_status: string;
  status: string;
  performance_title?: string;
  zone?: string;
  row_label?: string;
  seat_label?: string;
  delivery?: { png_url?: string; svg_url?: string };
};

type CustomerOrder = {
  id: string;
  event_name?: string | null;
  event_slug?: string | null;
  status: string;
  currency: string;
  subtotal_amount: number;
  platform_fee_amount: number;
  payment_fee_amount: number;
  tax_amount: number;
  total_amount: number;
  payment_reference: string | null;
  payment_proof_submitted_at: string | null;
  rejection_reason: string | null;
  hold_expires_at: string | null;
  performance_title?: string;
  performance_starts_at?: string;
  tickets: CustomerTicket[];
};

type CustomerPreferences = {
  email_transactional_enabled: boolean;
  sms_transactional_enabled: boolean;
  sms_marketing_enabled: boolean;
};

function resolveSection(pathname: string): CustomerAppSection {
  const value = pathname.split("/").filter(Boolean).pop();
  if (value === "tickets" || value === "orders" || value === "profile" || value === "notifications" || value === "security") return value;
  return "dashboard";
}

const navigation: Array<{ id: CustomerAppSection; label: string; icon: typeof LayoutDashboard }> = [
  { id: "dashboard", label: "Overview", icon: LayoutDashboard },
  { id: "tickets", label: "My tickets", icon: Ticket },
  { id: "orders", label: "Orders", icon: ClipboardList },
  { id: "profile", label: "Profile", icon: UserRound },
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "security", label: "Security", icon: Shield },
];

function sectionPath(section: CustomerAppSection) {
  return section === "dashboard" ? "/app" : `/app/${section}`;
}

function money(value: number, currency = "THB") {
  return new Intl.NumberFormat("th-TH", { style: "currency", currency, maximumFractionDigits: 2 }).format(Number(value || 0));
}

function date(value?: string | null) {
  if (!value) return "";
  return new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function EmptyState({ title, body, action = true }: { title: string; body: string; action?: boolean }) {
  return (
    <div className="rounded-3xl border border-dashed border-white/10 bg-slate-900/50 p-8 text-center">
      <Ticket className="mx-auto h-8 w-8 text-slate-600" />
      <h2 className="mt-4 text-lg font-semibold text-white">{title}</h2>
      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-400">{body}</p>
      {action && <a href="/events" className="mt-5 inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-500">Browse events <ChevronRight className="h-4 w-4" /></a>}
    </div>
  );
}

function OrderCard({ order, onUpdated }: { order: CustomerOrder; onUpdated: (order: CustomerOrder) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const canPay = order.status === "pending_payment" || order.status === "payment_submitted";

  const submitProof = async () => {
    if (!file) return;
    setBusy(true);
    setErrorMessage("");
    try {
      const data = await customerApi<{ order: CustomerOrder }>(`/api/customer/orders/${encodeURIComponent(order.id)}/payment-proof`, {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream", "x-proof-mime": file.type },
        body: file,
      });
      onUpdated(data.order);
      setFile(null);
    } catch (error: unknown) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to submit payment proof");
    } finally {
      setBusy(false);
    }
  };

  return (
    <article className="rounded-3xl border border-white/10 bg-slate-900/50 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><p className="text-xs uppercase tracking-[0.16em] text-slate-500">{order.event_name || "Event"}</p><h2 className="mt-1 font-semibold text-white">{order.id}</h2><p className="mt-1 text-sm text-slate-400">{order.performance_title || "Event performance"} · {date(order.performance_starts_at)}</p></div>
        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${order.status === "paid" ? "bg-emerald-500/15 text-emerald-300" : order.status === "rejected" || order.status === "expired" ? "bg-rose-500/15 text-rose-300" : "bg-amber-500/15 text-amber-200"}`}>{order.status.replaceAll("_", " ")}</span>
      </div>
      <div className="mt-5 grid gap-3 sm:grid-cols-4"><div><p className="text-xs text-slate-500">Tickets</p><p className="mt-1 text-sm font-semibold text-slate-200">{order.tickets.length}</p></div><div><p className="text-xs text-slate-500">Subtotal</p><p className="mt-1 text-sm text-slate-200">{money(order.subtotal_amount, order.currency)}</p></div><div><p className="text-xs text-slate-500">Fees + tax</p><p className="mt-1 text-sm text-slate-200">{money(order.platform_fee_amount + order.payment_fee_amount + order.tax_amount, order.currency)}</p></div><div><p className="text-xs text-slate-500">Total</p><p className="mt-1 text-sm font-bold text-white">{money(order.total_amount, order.currency)}</p></div></div>
      {order.rejection_reason && <p className="mt-4 rounded-xl bg-rose-500/10 px-3 py-2 text-sm text-rose-200">{order.rejection_reason}</p>}
      <div className="mt-4 flex flex-wrap gap-2">
        {order.event_slug && <a href={`/events/${encodeURIComponent(order.event_slug)}`} className="inline-flex items-center rounded-xl border border-white/10 px-3 py-2 text-xs font-semibold text-slate-200 hover:border-blue-300 hover:text-white">Open event</a>}
        <a href="/events" className="inline-flex items-center rounded-xl border border-white/10 px-3 py-2 text-xs font-semibold text-slate-400 hover:border-blue-300 hover:text-white">Browse more events</a>
      </div>
      {canPay && <div className="mt-5 grid gap-4 md:grid-cols-[180px_1fr] md:items-start"><img src={`/api/customer/orders/${encodeURIComponent(order.id)}/payment-qr`} alt="PromptPay QR" className="h-44 w-44 rounded-2xl bg-white p-2" /><div className="space-y-3"><p className="text-sm leading-6 text-slate-400">สแกนจ่ายด้วย PromptPay ตามยอดรวม แล้วแนบสลิปเพื่อให้ทีมงานตรวจสอบ ออเดอร์จะหมดอายุตามเวลาที่แสดงด้านล่าง</p>{order.hold_expires_at && <p className="text-xs text-amber-200">Hold expires: {date(order.hold_expires_at)}</p>}<label className="flex cursor-pointer items-center gap-3 rounded-2xl border border-dashed border-white/15 px-4 py-3 text-sm text-slate-300 hover:border-blue-400"><FileImage className="h-4 w-4 text-blue-300" /><span className="min-w-0 flex-1 truncate">{file?.name || "Choose payment proof"}</span><input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(event) => setFile(event.target.files?.[0] || null)} /></label><button type="button" disabled={!file || busy} onClick={() => void submitProof()} className="rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">{busy ? "Submitting…" : "Submit payment proof"}</button>{errorMessage && <p className="text-sm text-rose-300">{errorMessage}</p>}{order.payment_proof_submitted_at && <p className="text-xs text-emerald-300">Payment proof submitted {date(order.payment_proof_submitted_at)}</p>}</div></div>}
      {order.status === "paid" && <div className="mt-5 flex items-center gap-2 text-sm text-emerald-300"><CheckCircle2 className="h-4 w-4" /> Payment verified. Tickets are ready in My tickets.</div>}
    </article>
  );
}

function ClaimRecordForm({ onClaimed }: { onClaimed: () => Promise<void> }) {
  const [recordType, setRecordType] = useState<"registration" | "order">("registration");
  const [recordId, setRecordId] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const submit = async () => {
    if (!recordId.trim()) return;
    setBusy(true);
    setMessage("");
    try {
      await customerApi(`/api/customer/claims`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(recordType === "registration" ? { registration_id: recordId } : { order_id: recordId }) });
      setRecordId("");
      setMessage("Record linked to this account.");
      await onClaimed();
    } catch (error: unknown) {
      setMessage(error instanceof Error ? error.message : "Could not link record");
    } finally {
      setBusy(false);
    }
  };
  return <div className="rounded-3xl border border-blue-500/20 bg-blue-500/5 p-5"><h2 className="font-semibold text-white">Link an existing record</h2><p className="mt-1 text-sm text-slate-400">Use a registration ID or order ID created with the same verified email or phone.</p><div className="mt-4 flex flex-wrap gap-2"><select value={recordType} onChange={(event) => setRecordType(event.target.value === "order" ? "order" : "registration")} className="rounded-xl border border-white/10 bg-slate-950 px-3 py-2.5 text-sm text-slate-200"><option value="registration">Registration ID</option><option value="order">Order ID</option></select><input value={recordId} onChange={(event) => setRecordId(event.target.value)} placeholder="REG_… / ORD_…" className="min-w-[12rem] flex-1 rounded-xl border border-white/10 bg-slate-950 px-3 py-2.5 text-sm text-slate-200 outline-none focus:border-blue-400" /><button type="button" disabled={busy || !recordId.trim()} onClick={() => void submit()} className="rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Linking…" : "Link record"}</button></div>{message && <p className="mt-3 text-sm text-slate-300">{message}</p>}</div>;
}

export function CustomerAppScreen() {
  const initialSection = typeof window !== "undefined" ? resolveSection(window.location.pathname) : "dashboard";
  const [section, setSection] = useState<CustomerAppSection>(initialSection);
  const [account, setAccount] = useState<CustomerAccount | null>(null);
  const [registrations, setRegistrations] = useState<RegistrationRecord[]>([]);
  const [tickets, setTickets] = useState<CustomerTicket[]>([]);
  const [orders, setOrders] = useState<CustomerOrder[]>([]);
  const [preferences, setPreferences] = useState<CustomerPreferences | null>(null);
  const [loading, setLoading] = useState(true);
  const [dataLoading, setDataLoading] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const loadCustomerData = async () => {
    setDataLoading(true);
    try {
      const [ticketData, orderData, preferenceData] = await Promise.all([
        customerApi<{ registrations: RegistrationRecord[]; tickets: CustomerTicket[] }>("/api/customer/tickets"),
        customerApi<{ orders: CustomerOrder[] }>("/api/customer/orders"),
        customerApi<{ preferences: CustomerPreferences }>("/api/customer/notification-preferences"),
      ]);
      setRegistrations(ticketData.registrations || []);
      setTickets(ticketData.tickets || []);
      setOrders(orderData.orders || []);
      setPreferences(preferenceData.preferences);
    } catch (error: unknown) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to load customer data");
    } finally {
      setDataLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    void customerApi<{ account: CustomerAccount }>("/api/customer/account/me")
      .then((data) => {
        if (cancelled) return;
        setAccount(data.account);
        void loadCustomerData();
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        if (error instanceof Error && error.message === "CUSTOMER_NOT_AUTHENTICATED") {
          window.location.assign("/account/login");
          return;
        }
        setErrorMessage(error instanceof Error && error.message === "CUSTOMER_APP_DISABLED" ? "Customer accounts are not enabled in this environment yet." : error instanceof Error ? error.message : "Failed to load customer account");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  const navigate = (nextSection: CustomerAppSection) => {
    window.history.pushState({}, "", sectionPath(nextSection));
    setSection(nextSection);
    setMobileNavOpen(false);
  };

  const logout = async () => {
    try { await customerApi("/api/customer/account/logout", { method: "POST" }); } finally { window.location.assign("/account/login"); }
  };

  const updatePreference = async (field: keyof CustomerPreferences, value: boolean) => {
    if (!preferences) return;
    const data = await customerApi<{ preferences: CustomerPreferences }>("/api/customer/notification-preferences", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ [field]: value }) });
    setPreferences(data.preferences);
  };

  if (loading) return <div className="flex min-h-screen items-center justify-center bg-[#070b14] text-sm text-slate-400">Loading customer app…</div>;
  if (!account) return <div className="flex min-h-screen items-center justify-center bg-[#070b14] px-5 text-center text-sm text-amber-200">{errorMessage || "Customer account unavailable"}</div>;

  const content = section === "tickets" ? (
    <div className="space-y-4"><ClaimRecordForm onClaimed={loadCustomerData} />{tickets.length || registrations.length ? <div className="space-y-4">{tickets.map((ticket) => <article key={ticket.id} className="flex flex-wrap items-center justify-between gap-4 rounded-3xl border border-white/10 bg-slate-900/50 p-5"><div><p className="text-xs uppercase tracking-[0.16em] text-slate-500">{ticket.performance_title || "Ticket"}</p><h2 className="mt-1 font-semibold text-white">{ticket.holder_name || "Attendee"}</h2><p className="mt-1 text-sm text-slate-400">{ticket.zone || ""} {ticket.row_label || ""} {ticket.seat_label || ""} · {ticket.status}</p></div><div className="flex gap-2">{ticket.delivery?.png_url && <a href={ticket.delivery.png_url} target="_blank" rel="noreferrer" className="rounded-xl border border-white/10 px-3 py-2 text-xs font-semibold text-slate-200">Ticket PNG</a>}{ticket.delivery?.svg_url && <a href={ticket.delivery.svg_url} target="_blank" rel="noreferrer" className="rounded-xl border border-white/10 px-3 py-2 text-xs font-semibold text-slate-200">Ticket SVG</a>}</div></article>)}{registrations.map((registration) => <article key={registration.id} className="flex flex-wrap items-center justify-between gap-4 rounded-3xl border border-white/10 bg-slate-900/50 p-5"><div><p className="text-xs uppercase tracking-[0.16em] text-slate-500">Registration</p><h2 className="mt-1 font-semibold text-white">{registration.first_name} {registration.last_name}</h2><p className="mt-1 text-sm text-slate-400">{registration.id} · {registration.status} · {date(registration.timestamp)}</p></div><div className="flex gap-2">{registration.ticket?.png_url && <a href={registration.ticket.png_url} target="_blank" rel="noreferrer" className="rounded-xl border border-white/10 px-3 py-2 text-xs font-semibold text-slate-200">Ticket PNG</a>}</div></article>)}</div> : <EmptyState title="No tickets yet" body="Free registrations and purchased tickets will appear here when they are linked to this account." />}</div>
  ) : section === "orders" ? (
    orders.length ? <div className="space-y-4">{orders.map((order) => <OrderCard key={order.id} order={order} onUpdated={(updated) => setOrders((current) => current.map((item) => item.id === updated.id ? updated : item))} />)}</div> : <EmptyState title="No orders yet" body="Browse an event with customer seat checkout enabled to place your first order." />
  ) : section === "notifications" ? (
    <div className="rounded-3xl border border-white/10 bg-slate-900/50 p-6"><h2 className="text-lg font-semibold text-white">Notification preferences</h2><p className="mt-2 text-sm leading-6 text-slate-400">Transactional email stays on by default. SMS remains opt-in and is only sent when the provider is configured.</p>{preferences && <div className="mt-6 space-y-3">{([ ["email_transactional_enabled", "Transactional email"], ["sms_transactional_enabled", "Transactional SMS"], ["sms_marketing_enabled", "Marketing SMS"] ] as Array<[keyof CustomerPreferences, string]>).map(([field, label]) => <label key={field} className="flex items-center justify-between gap-4 rounded-2xl border border-white/10 px-4 py-3 text-sm text-slate-200"><span>{label}</span><input type="checkbox" checked={preferences[field]} onChange={(event) => void updatePreference(field, event.target.checked)} className="h-4 w-4 rounded border-slate-600 bg-slate-800 text-blue-600" /></label>)}</div>}</div>
  ) : section === "security" ? (
    <div className="space-y-4"><div className="rounded-3xl border border-white/10 bg-slate-900/50 p-6"><h2 className="text-lg font-semibold text-white">Session security</h2><p className="mt-2 text-sm leading-6 text-slate-400">Use the account security controls to sign out or revoke all customer sessions.</p><a href="/account" className="mt-5 inline-flex items-center gap-2 rounded-xl border border-white/10 px-4 py-2.5 text-sm font-semibold text-slate-200 hover:border-blue-400 hover:text-white">Open account controls <ChevronRight className="h-4 w-4" /></a></div></div>
  ) : section === "profile" ? (
    <div className="space-y-4"><div className="rounded-3xl border border-white/10 bg-slate-900/50 p-6"><h2 className="text-lg font-semibold text-white">Profile</h2><div className="mt-5 grid gap-4 sm:grid-cols-2"><div><p className="text-xs uppercase tracking-[0.16em] text-slate-500">Name</p><p className="mt-1 text-sm text-slate-200">{account.first_name} {account.last_name}</p></div><div><p className="text-xs uppercase tracking-[0.16em] text-slate-500">Email</p><p className="mt-1 text-sm text-slate-200">{account.email}</p></div><div><p className="text-xs uppercase tracking-[0.16em] text-slate-500">Phone</p><p className="mt-1 text-sm text-slate-200">{account.phone}</p></div><div><p className="text-xs uppercase tracking-[0.16em] text-slate-500">Status</p><p className="mt-1 text-sm capitalize text-emerald-300">{account.status}</p></div></div><a href="/account" className="mt-6 inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-500">Edit profile <ChevronRight className="h-4 w-4" /></a></div></div>
  ) : (
    <><div className="grid gap-4 sm:grid-cols-3"><div className="rounded-3xl border border-white/10 bg-slate-900/50 p-5"><Ticket className="h-5 w-5 text-blue-300" /><p className="mt-6 text-2xl font-bold text-white">{tickets.length + registrations.length}</p><p className="mt-1 text-sm text-slate-400">Tickets & registrations</p></div><div className="rounded-3xl border border-white/10 bg-slate-900/50 p-5"><ClipboardList className="h-5 w-5 text-violet-300" /><p className="mt-6 text-2xl font-bold text-white">{orders.length}</p><p className="mt-1 text-sm text-slate-400">Orders</p></div><div className="rounded-3xl border border-white/10 bg-slate-900/50 p-5"><CalendarDays className="h-5 w-5 text-emerald-300" /><p className="mt-6 text-2xl font-bold text-white">Ready</p><p className="mt-1 text-sm text-slate-400">Account status</p></div></div><div className="mt-6 flex items-center justify-between rounded-3xl border border-white/10 bg-slate-900/50 p-5"><div><h2 className="font-semibold text-white">Find another event</h2><p className="mt-1 text-sm text-slate-400">Customer checkout is available only on events explicitly enabled by the organizer.</p></div><a href="/events" className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white">Browse <ChevronRight className="h-4 w-4" /></a></div></>
  );

  return <div className="min-h-screen bg-[#070b14] text-slate-100"><header className="border-b border-white/10 bg-[#0b1120]/90 backdrop-blur"><div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-5 py-4 sm:px-8"><a href="/app" className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-blue-600"><Ticket className="h-5 w-5" /></span><span><span className="block text-sm font-bold tracking-wide text-white">Meetrix</span><span className="block text-xs text-slate-500">Customer app</span></span></a><div className="flex items-center gap-3"><span className="hidden text-sm text-slate-400 sm:block">{account.first_name} {account.last_name}</span><button type="button" onClick={() => void logout()} className="hidden items-center gap-2 rounded-xl border border-white/10 px-3 py-2 text-sm font-semibold text-slate-300 hover:text-white sm:inline-flex"><LogOut className="h-4 w-4" /> Sign out</button><button type="button" onClick={() => setMobileNavOpen((value) => !value)} className="rounded-xl border border-white/10 p-2 text-slate-300 sm:hidden" aria-label="Toggle navigation">{mobileNavOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}</button></div></div></header><div className="mx-auto flex max-w-7xl gap-6 px-5 py-6 sm:px-8"><aside className={`${mobileNavOpen ? "block" : "hidden"} fixed inset-x-5 top-20 z-20 rounded-2xl border border-white/10 bg-[#0b1120] p-3 shadow-2xl sm:static sm:block sm:w-56 sm:shrink-0 sm:border-0 sm:bg-transparent sm:p-0 sm:shadow-none`}><nav className="space-y-1" aria-label="Customer navigation">{navigation.map(({ id, label, icon: Icon }) => <a key={id} href={sectionPath(id)} onClick={(event) => { event.preventDefault(); navigate(id); }} className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition-colors ${section === id ? "bg-blue-600/15 text-blue-200" : "text-slate-400 hover:bg-white/5 hover:text-white"}`}><Icon className="h-4 w-4" /> {label}</a>)}<button type="button" onClick={() => void logout()} className="mt-4 flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-slate-500 hover:bg-white/5 hover:text-white sm:hidden"><LogOut className="h-4 w-4" /> Sign out</button></nav></aside><main className="min-w-0 flex-1"><div className="mb-6"><p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-300">Customer area</p><h1 className="mt-2 text-3xl font-bold tracking-tight text-white">{navigation.find((item) => item.id === section)?.label || "Overview"}</h1><p className="mt-2 text-sm text-slate-400">Welcome back, {account.first_name}.{dataLoading ? " Updating…" : ""}</p>{errorMessage && <p className="mt-2 text-sm text-rose-300">{errorMessage}</p>}</div>{content}</main></div></div>;
}

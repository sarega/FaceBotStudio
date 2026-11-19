import { CustomerVerificationNotice } from "./CustomerVerificationNotice";
import { CustomerPaidBookings } from "./CustomerPaidBookings";
import { useEffect, useState } from "react";
import { ArrowLeft, Bell, CalendarDays, CheckCircle2, ChevronRight, ClipboardList, FileImage, LayoutDashboard, LogOut, Menu, Shield, Ticket, UserRound, X } from "lucide-react";
import { CustomerAccountScreen, customerApi, type CustomerAccount } from "./CustomerAccountScreen";

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

const navigationItems: Array<{ id: CustomerAppSection; label: string; icon: typeof LayoutDashboard }> = [
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
    <div className="rounded-3xl border border-dashed border-slate-200 bg-white p-8 text-center">
      <Ticket className="mx-auto h-8 w-8 text-slate-600" />
      <h2 className="mt-4 text-lg font-semibold text-slate-900">{title}</h2>
      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-600">{body}</p>
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
    <article className="rounded-3xl border border-slate-200 bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><p className="text-xs uppercase tracking-[0.16em] text-slate-500">{order.event_name || "Event"}</p><h2 className="mt-1 font-semibold text-slate-900">{order.id}</h2><p className="mt-1 text-sm text-slate-600">{order.performance_title || "Event performance"} · {date(order.performance_starts_at)}</p></div>
        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${order.status === "paid" ? "bg-emerald-500/15 text-emerald-700" : order.status === "rejected" || order.status === "expired" ? "bg-rose-500/15 text-rose-700" : "bg-amber-500/15 text-amber-800"}`}>{order.status.replaceAll("_", " ")}</span>
      </div>
      <div className="mt-5 grid gap-3 sm:grid-cols-4"><div><p className="text-xs text-slate-500">Tickets</p><p className="mt-1 text-sm font-semibold text-slate-700">{order.tickets.length}</p></div><div><p className="text-xs text-slate-500">Subtotal</p><p className="mt-1 text-sm text-slate-700">{money(order.subtotal_amount, order.currency)}</p></div><div><p className="text-xs text-slate-500">Fees + tax</p><p className="mt-1 text-sm text-slate-700">{money(order.platform_fee_amount + order.payment_fee_amount + order.tax_amount, order.currency)}</p></div><div><p className="text-xs text-slate-500">Total</p><p className="mt-1 text-sm font-bold text-slate-900">{money(order.total_amount, order.currency)}</p></div></div>
      {order.rejection_reason && <p className="mt-4 rounded-xl bg-rose-500/10 px-3 py-2 text-sm text-rose-700">{order.rejection_reason}</p>}
      <div className="mt-4 flex flex-wrap gap-2">
        {order.event_slug && <a href={`/events/${encodeURIComponent(order.event_slug)}`} className="inline-flex items-center rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:border-blue-300 hover:underline">Open event</a>}
        <a href="/events" className="inline-flex items-center rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 hover:border-blue-300 hover:underline">Browse more events</a>
      </div>
      {canPay && <div className="mt-5 grid gap-4 md:grid-cols-[180px_1fr] md:items-start"><img src={`/api/customer/orders/${encodeURIComponent(order.id)}/payment-qr`} alt="PromptPay QR" className="h-44 w-44 rounded-2xl bg-white p-2" /><div className="space-y-3"><p className="text-sm leading-6 text-slate-600">สแกนจ่ายด้วย PromptPay ตามยอดรวม แล้วแนบสลิปเพื่อให้ทีมงานตรวจสอบ ออเดอร์จะหมดอายุตามเวลาที่แสดงด้านล่าง</p>{order.hold_expires_at && <p className="text-xs text-amber-800">Hold expires: {date(order.hold_expires_at)}</p>}<label className="flex cursor-pointer items-center gap-3 rounded-2xl border border-dashed border-slate-200 px-4 py-3 text-sm text-slate-700 hover:border-blue-400"><FileImage className="h-4 w-4 text-blue-700" /><span className="min-w-0 flex-1 truncate">{file?.name || "Choose payment proof"}</span><input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(event) => setFile(event.target.files?.[0] || null)} /></label><button type="button" disabled={!file || busy} onClick={() => void submitProof()} className="rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">{busy ? "Submitting…" : "Submit payment proof"}</button>{errorMessage && <p className="text-sm text-rose-700">{errorMessage}</p>}{order.payment_proof_submitted_at && <p className="text-xs text-emerald-700">Payment proof submitted {date(order.payment_proof_submitted_at)}</p>}</div></div>}
      {order.status === "paid" && <div className="mt-5 flex items-center gap-2 text-sm text-emerald-700"><CheckCircle2 className="h-4 w-4" /> Payment verified. Tickets are ready in My tickets.</div>}
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
  return <div className="rounded-3xl border border-blue-500/20 bg-blue-500/5 p-5"><h2 className="font-semibold text-slate-900">Link an existing record</h2><p className="mt-1 text-sm text-slate-600">Use a registration ID or order ID created with the same verified email or phone.</p><div className="mt-4 flex flex-wrap gap-2"><select value={recordType} onChange={(event) => setRecordType(event.target.value === "order" ? "order" : "registration")} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-700"><option value="registration">Registration ID</option><option value="order">Order ID</option></select><input value={recordId} onChange={(event) => setRecordId(event.target.value)} placeholder="REG_… / ORD_…" className="min-w-[12rem] flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-700 outline-none focus:border-blue-400" /><button type="button" disabled={busy || !recordId.trim()} onClick={() => void submit()} className="rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Linking…" : "Link record"}</button></div>{message && <p className="mt-3 text-sm text-slate-700">{message}</p>}</div>;
}

export function CustomerAppScreen({ locale, languageControl, themeControl }: { locale: "th" | "en"; languageControl: React.ReactNode; themeControl: React.ReactNode }) {
  const t = (th: string, en: string) => locale === "th" ? th : en;
  const thaiNav = { dashboard: "ภาพรวม", tickets: "บัตรของฉัน", orders: "การจอง", profile: "โปรไฟล์", notifications: "การแจ้งเตือน", security: "ความปลอดภัย" };
  const navigation = navigationItems.map((item) => ({ ...item, label: t(thaiNav[item.id], item.label) }));
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
          const reference = new URLSearchParams(window.location.search).get("paid_booking") || "";
          const query = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(reference) ? `?paid_booking=${encodeURIComponent(reference)}` : "";
          window.location.assign(`/account/login${query}`);
          return;
        }
        setErrorMessage(error instanceof Error && error.message === "CUSTOMER_APP_DISABLED" ? "Customer accounts are not enabled in this environment yet." : error instanceof Error ? error.message : "Failed to load customer account");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const syncSection = () => {
      setSection(resolveSection(window.location.pathname));
      setMobileNavOpen(false);
    };
    window.addEventListener("popstate", syncSection);
    return () => window.removeEventListener("popstate", syncSection);
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

  if (loading) return <div className="flex min-h-screen items-center justify-center bg-slate-50 text-sm text-slate-600">Loading customer app…</div>;
  if (!account) return <div className="flex min-h-screen items-center justify-center bg-slate-50 px-5 text-center text-sm text-amber-800">{errorMessage || "Customer account unavailable"}</div>;

  const content = section === "tickets" ? (
    <div className="space-y-4"><a href="/app/orders" className="inline-flex min-h-11 items-center font-semibold text-blue-700 underline">ดูสถานะการจองและบัตรสัมมนา / View bookings and seminar passes</a>{account.email_verified_at && <CustomerPaidBookings key={section} locale={locale} tickets />}<ClaimRecordForm onClaimed={loadCustomerData} />{tickets.length || registrations.length ? <div className="space-y-4">{tickets.map((ticket) => <article key={ticket.id} className="flex flex-wrap items-center justify-between gap-4 rounded-3xl border border-slate-200 bg-white p-5"><div><p className="text-xs uppercase tracking-[0.16em] text-slate-500">{ticket.performance_title || "Ticket"}</p><h2 className="mt-1 font-semibold text-slate-900">{ticket.holder_name || "Attendee"}</h2><p className="mt-1 text-sm text-slate-600">{ticket.zone || ""} {ticket.row_label || ""} {ticket.seat_label || ""} · {ticket.status}</p></div><div className="flex gap-2">{ticket.delivery?.png_url && <a href={ticket.delivery.png_url} target="_blank" rel="noreferrer" className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700">Ticket PNG</a>}{ticket.delivery?.svg_url && <a href={ticket.delivery.svg_url} target="_blank" rel="noreferrer" className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700">Ticket SVG</a>}</div></article>)}{registrations.map((registration) => <article key={registration.id} className="flex flex-wrap items-center justify-between gap-4 rounded-3xl border border-slate-200 bg-white p-5"><div><p className="text-xs uppercase tracking-[0.16em] text-slate-500">Registration</p><h2 className="mt-1 font-semibold text-slate-900">{registration.first_name} {registration.last_name}</h2><p className="mt-1 text-sm text-slate-600">{registration.id} · {registration.status} · {date(registration.timestamp)}</p></div><div className="flex gap-2">{registration.ticket?.png_url && <a href={registration.ticket.png_url} target="_blank" rel="noreferrer" className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700">Ticket PNG</a>}</div></article>)}</div> : <EmptyState title="No other tickets yet" body="Linked registrations and issued seat tickets appear here." />}</div>
  ) : section === "orders" ? (
    <div className="space-y-4">{account.email_verified_at && <CustomerPaidBookings key={section} locale={locale} />}{orders.length ? <div className="space-y-4">{orders.map((order) => <OrderCard key={order.id} order={order} onUpdated={(updated) => setOrders((current) => current.map((item) => item.id === updated.id ? updated : item))} />)}</div> : !account.email_verified_at ? <EmptyState title="Verify your email" body="Verify your email to view paid registrations." /> : null}</div>
  ) : section === "notifications" ? (
    <div className="rounded-3xl border border-slate-200 bg-white p-6"><h2 className="text-lg font-semibold text-slate-900">Notification preferences</h2><p className="mt-2 text-sm leading-6 text-slate-600">Transactional email stays on by default. SMS remains opt-in and is only sent when the provider is configured.</p>{preferences && <div className="mt-6 space-y-3">{([ ["email_transactional_enabled", "Transactional email"], ["sms_transactional_enabled", "Transactional SMS"], ["sms_marketing_enabled", "Marketing SMS"] ] as Array<[keyof CustomerPreferences, string]>).map(([field, label]) => <label key={field} className="flex items-center justify-between gap-4 rounded-2xl border border-slate-200 px-4 py-3 text-sm text-slate-700"><span>{label}</span><input type="checkbox" checked={preferences[field]} onChange={(event) => void updatePreference(field, event.target.checked)} className="h-4 w-4 rounded border-slate-600 bg-white text-blue-600" /></label>)}</div>}</div>
  ) : section === "security" || section === "profile" ? (
    <CustomerAccountScreen key={section} embedded={section} locale={locale} />
  ) : (
    <>
      <dl className="grid grid-cols-3 gap-2">
        {[
          { label: t("บัตรและการลงทะเบียน", "Tickets & registrations"), value: tickets.length + registrations.length },
          { label: t("คำสั่งซื้อตั๋ว", "Ticket orders"), value: dataLoading ? "…" : orders.length },
          { label: t("สถานะบัญชี", "Account status"), value: ({
            active: t("ใช้งานได้", "Active"),
            pending: t("รอยืนยัน", "Pending"),
            disabled: t("ปิดใช้งาน", "Disabled"),
          } as Record<string, string>)[account.status] || account.status },
        ].map(({ label, value }) => (
          <div key={label} className="min-w-0 rounded-xl border border-slate-200 bg-white p-2.5 sm:p-4">
            <dt className="text-xs leading-snug text-slate-600 sm:text-sm">{label}</dt>
            <dd className="mt-1 break-words text-base font-bold tabular-nums text-slate-900 sm:text-xl">{value}</dd>
          </div>
        ))}
      </dl>
      {account.email_verified_at && <div className="mt-3"><CustomerPaidBookings key={section} locale={locale} overview /></div>}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="font-semibold text-slate-900">{t("ค้นหางานอื่น", "Find another event")}</h2>
        <a href="/events" className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white">
          {t("ดูงานทั้งหมด", "Browse events")} <ChevronRight className="h-4 w-4" />
        </a>
      </div>
    </>
  );

  return <div className="min-h-screen bg-slate-50 text-slate-900"><header className="border-b border-slate-200 bg-white backdrop-blur"><div className="mx-auto flex max-w-7xl items-center justify-between gap-2 px-3 py-2 sm:px-8"><a href="/app" className="flex min-w-0 items-center gap-2"><span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-blue-600 text-white"><Ticket className="h-5 w-5" /></span><span><span className="block text-sm font-bold tracking-wide text-slate-900">Meetrix</span><span className="hidden text-xs text-slate-500 sm:block">{t("บัญชีผู้เข้าร่วม", "Customer app")}</span></span></a><div className="flex shrink-0 items-center gap-1.5 sm:gap-2">{languageControl}{themeControl}<a href="/events" aria-label={t("งานทั้งหมด", "All events")} className="inline-flex min-h-9 items-center gap-1 rounded-lg px-2 text-xs font-semibold text-blue-700 hover:bg-slate-200/40 sm:text-sm"><CalendarDays className="h-4 w-4" /> <span className="hidden sm:inline">{t("งาน", "Events")}</span></a><span className="hidden text-sm text-slate-600 sm:block">{account.first_name} {account.last_name}</span><button type="button" onClick={() => void logout()} className="hidden items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:underline sm:inline-flex"><LogOut className="h-4 w-4" /> {t("ออกจากระบบ", "Sign out")}</button><button type="button" onClick={() => setMobileNavOpen((value) => !value)} className="rounded-xl border border-slate-200 p-2 text-slate-700 sm:hidden" aria-label="Toggle navigation">{mobileNavOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}</button></div></div></header><div className="mx-auto flex max-w-7xl gap-6 px-5 py-6 sm:px-8"><aside className={`${mobileNavOpen ? "block" : "hidden"} fixed inset-x-5 top-20 z-20 rounded-2xl border border-slate-200 bg-white p-3 shadow-2xl sm:static sm:block sm:w-56 sm:shrink-0 sm:border-0 sm:bg-transparent sm:p-0 sm:shadow-none`}><nav className="space-y-1" aria-label="Customer navigation"><a href="/events" className="mb-3 flex min-h-11 items-center gap-2 rounded-xl border border-blue-400/30 px-3 py-2.5 text-sm font-semibold text-blue-700 hover:bg-blue-600/15"><ArrowLeft className="h-4 w-4" /> {t("งานทั้งหมด", "All events")}</a>{navigation.map(({ id, label, icon: Icon }) => <a key={id} href={sectionPath(id)} onClick={(event) => { event.preventDefault(); navigate(id); }} className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition-colors ${section === id ? "bg-blue-600/15 text-blue-700" : "text-slate-600 hover:bg-slate-200/40 hover:underline"}`}><Icon className="h-4 w-4" /> {label}</a>)}<button type="button" onClick={() => void logout()} className="mt-4 flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-slate-500 hover:bg-slate-200/40 hover:underline sm:hidden"><LogOut className="h-4 w-4" /> {t("ออกจากระบบ", "Sign out")}</button></nav></aside><main className="min-w-0 flex-1"><div className="mb-6"><nav aria-label="Breadcrumb" className="mb-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm"><a href="/events" className="text-blue-700 hover:underline">{t("งานทั้งหมด", "All Events")}</a><ChevronRight className="h-3.5 w-3.5 text-slate-600" /><a href="/app" onClick={(event) => { event.preventDefault(); navigate("dashboard"); }} className="text-blue-700 hover:underline">{t("บัญชีของฉัน", "My Account")}</a>{section !== "dashboard" && <><ChevronRight className="h-3.5 w-3.5 text-slate-600" /><span className="text-slate-700">{navigation.find(item => item.id === section)?.label}</span></>}</nav><p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-700">{t("บัญชีผู้เข้าร่วม", "Customer area")}</p><h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-900">{navigation.find((item) => item.id === section)?.label || "Overview"}</h1><p className="mt-2 text-sm text-slate-600">{t("ยินดีต้อนรับ", "Welcome back,")} {account.first_name}{dataLoading && t(" กำลังอัปเดต…", " Updating…")}</p>{errorMessage && <p className="mt-2 text-sm text-rose-700">{errorMessage}</p>}</div>
    {!account.email_verified_at && <div className="mb-6">
      <CustomerVerificationNotice locale={locale} email={account.email}/>
      <a href="/account" className="mt-3 inline-flex min-h-11 items-center rounded-xl border border-amber-400 px-4 py-2 text-sm font-bold text-blue-700 hover:underline">
        ส่งอีเมลยืนยันอีกครั้ง / Resend verification
      </a>
    </div>}{content}</main></div></div>;
}

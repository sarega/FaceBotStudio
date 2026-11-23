import { WorkspaceSwitchLink } from "../../../components/shared/WorkspaceSwitchLink";
import { customerErrorCopy, formatCustomerDate, type CustomerCopy, type CustomerLocale } from "../customerLocale";
import { CustomerVerificationNotice } from "./CustomerVerificationNotice";
import { CustomerPaidBookings } from "./CustomerPaidBookings";
import { useEffect, useRef, useState } from "react";
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
  updated_at?: string;
  rejection_reason: string | null;
  hold_expires_at: string | null;
  performance_title?: string;
  performance_starts_at?: string;
  tickets: CustomerTicket[];
};

type PaidNotificationBooking = {
  reference: string;
  event_name: string;
  status: string;
  due_at: string;
  updated_at: string;
  balance_due_minor?: number;
  pending_proofs?: number;
  refunded_minor?: number;
  credit_issued_minor?: number;
  credit_used_minor?: number;
};
type CustomerNotification = { id: string; title: string; event: string; at?: string; href: string; needsPayment: boolean };

function CustomerNotificationList({ entries, locale, onSelect }: {
  entries: CustomerNotification[]; locale: CustomerLocale; onSelect?: () => void;
}) {
  const th = locale === "th";
  if (entries.length === 0) return <p className="px-3 py-5 text-sm text-slate-600">{th ? "ยังไม่มีการแจ้งเตือน" : "No notifications yet"}</p>;
  return <ul className="divide-y divide-slate-200">
    {entries.map(entry => <li key={entry.id}>
      <a href={entry.href} onClick={onSelect} className="flex items-center gap-2 px-3 py-2.5 text-sm hover:bg-slate-100/60">
        <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${entry.needsPayment ? "bg-rose-600" : "bg-blue-600"}`} />
        <span className="min-w-0 flex-1">
          <span className="block font-semibold text-slate-900">{entry.title}</span>
          {entry.event && <span className="block break-words text-xs text-slate-600">{entry.event}</span>}
          {entry.at && <time dateTime={entry.at} className="text-xs text-slate-500">{formatCustomerDate(entry.at, locale)}</time>}
        </span>
        <ChevronRight className="h-4 w-4 shrink-0 text-slate-500" aria-hidden="true" />
      </a>
    </li>)}
  </ul>;
}

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

function money(locale: CustomerLocale, value: number, currency: string) {
  return new Intl.NumberFormat(locale === "th" ? "th-TH" : "en-GB", { style: "currency", currency, maximumFractionDigits: 2 }).format(Number(value || 0));
}

function statusLabel(status: string, locale: CustomerLocale) {
  const labels: Record<string, CustomerCopy> = {
    pending_payment: ["รอชำระเงิน", "Awaiting payment"],
    payment_submitted: ["รอตรวจสลิป", "Payment submitted"],
    paid: ["ชำระแล้ว", "Paid"],
    rejected: ["ไม่ผ่านการตรวจสอบ", "Rejected"],
    expired: ["หมดอายุ", "Expired"],
    refunded: ["คืนเงินแล้ว", "Refunded"],
    cancelled: ["ยกเลิกแล้ว", "Cancelled"],
    registered: ["ลงทะเบียนแล้ว", "Registered"],
    held: ["สำรองที่นั่งแล้ว", "Held"],
    issued: ["ออกบัตรแล้ว", "Issued"],
    "checked-in": ["เช็กอินแล้ว", "Checked in"],
    checked_in: ["เช็กอินแล้ว", "Checked in"],
    voided: ["ยกเลิกบัตรแล้ว", "Voided"],
  };
  return labels[status]?.[locale === "th" ? 0 : 1] ?? status;
}

function EmptyState({ locale, title, body, action = true }: { locale: CustomerLocale; title: string; body: string; action?: boolean }) {
  const t = (th: string, en: string) => locale === "th" ? th : en;
  return (
    <div className="rounded-3xl border border-dashed border-slate-200 bg-white p-8 text-center">
      <Ticket className="mx-auto h-8 w-8 text-slate-600" />
      <h2 className="mt-4 text-lg font-semibold text-slate-900">{title}</h2>
      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-600">{body}</p>
      {action && <a href="/events" className="mt-5 inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-500">{t("ดูงานทั้งหมด", "Browse events")} <ChevronRight className="h-4 w-4" /></a>}
    </div>
  );
}

function OrderCard({ locale, order, onUpdated }: { locale: CustomerLocale; order: CustomerOrder; onUpdated: (order: CustomerOrder) => void }) {
  const t = (th: string, en: string) => locale === "th" ? th : en;
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState<CustomerCopy>();
  const canPay = order.status === "pending_payment" || order.status === "payment_submitted";

  const submitProof = async () => {
    if (!file) return;
    setBusy(true);
    setErrorMessage(undefined);
    try {
      const data = await customerApi<{ order: CustomerOrder }>(`/api/customer/orders/${encodeURIComponent(order.id)}/payment-proof`, {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream", "x-proof-mime": file.type },
        body: file,
      });
      onUpdated(data.order);
      setFile(null);
    } catch (error: unknown) {
      setErrorMessage(customerErrorCopy(error, ["ส่งหลักฐานการชำระเงินไม่สำเร็จ", "Failed to submit payment proof"]));
    } finally {
      setBusy(false);
    }
  };

  return (
    <article className="rounded-3xl border border-slate-200 bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><p className="text-xs uppercase tracking-[0.16em] text-slate-500">{order.event_name || t("งาน", "Event")}</p><h2 className="mt-1 font-semibold text-slate-900">{order.id}</h2><p className="mt-1 text-sm text-slate-600">{order.performance_title || t("รอบการแสดง", "Event performance")} · {formatCustomerDate(order.performance_starts_at, locale)}</p></div>
        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${order.status === "paid" ? "bg-emerald-500/15 text-emerald-700" : order.status === "rejected" || order.status === "expired" ? "bg-rose-500/15 text-rose-700" : "bg-amber-500/15 text-amber-800"}`}>{statusLabel(order.status, locale)}</span>
      </div>
      <div className="mt-5 grid gap-3 sm:grid-cols-4"><div><p className="text-xs text-slate-500">{t("บัตร", "Tickets")}</p><p className="mt-1 text-sm font-semibold text-slate-700">{order.tickets.length}</p></div><div><p className="text-xs text-slate-500">{t("ยอดก่อนค่าธรรมเนียม", "Subtotal")}</p><p className="mt-1 text-sm text-slate-700">{money(locale, order.subtotal_amount, order.currency)}</p></div><div><p className="text-xs text-slate-500">{t("ค่าธรรมเนียมและภาษี", "Fees + tax")}</p><p className="mt-1 text-sm text-slate-700">{money(locale, order.platform_fee_amount + order.payment_fee_amount + order.tax_amount, order.currency)}</p></div><div><p className="text-xs text-slate-500">{t("ยอดรวม", "Total")}</p><p className="mt-1 text-sm font-bold text-slate-900">{money(locale, order.total_amount, order.currency)}</p></div></div>
      {order.rejection_reason && <p className="mt-4 rounded-xl bg-rose-500/10 px-3 py-2 text-sm text-rose-700">{order.rejection_reason}</p>}
      <div className="mt-4 flex flex-wrap gap-2">
        {order.event_slug && <a href={`/events/${encodeURIComponent(order.event_slug)}`} className="inline-flex items-center rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:border-blue-300 hover:underline">{t("เปิดหน้างาน", "Open event")}</a>}
        <a href="/events" className="inline-flex items-center rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 hover:border-blue-300 hover:underline">{t("ดูงานอื่น ๆ", "Browse more events")}</a>
      </div>
      {canPay && <div id={`order-proof-${order.id}`} className="mt-5 grid scroll-mt-24 gap-4 md:grid-cols-[180px_1fr] md:items-start"><img src={`/api/customer/orders/${encodeURIComponent(order.id)}/payment-qr`} alt={t("QR พร้อมเพย์", "PromptPay QR")} className="h-44 w-44 rounded-2xl bg-white p-2" /><div className="space-y-3"><p className="text-sm leading-6 text-slate-600">{t("สแกนจ่ายด้วยพร้อมเพย์ตามยอดรวม แล้วแนบสลิปให้ทีมงานตรวจสอบ คำสั่งซื้อจะหมดอายุตามเวลาที่แสดงด้านล่าง", "Scan the PromptPay QR code to pay the total, then upload your slip for review. The order expires at the time shown below.")}</p>{order.hold_expires_at && <p className="text-xs text-amber-800">{t("สำรองที่นั่งถึง", "Hold expires:")} {formatCustomerDate(order.hold_expires_at, locale)}</p>}<label className="flex cursor-pointer items-center gap-3 rounded-2xl border border-dashed border-slate-200 px-4 py-3 text-sm text-slate-700 hover:border-blue-400"><FileImage className="h-4 w-4 text-blue-700" /><span className="min-w-0 flex-1 truncate">{file?.name || t("เลือกหลักฐานการชำระเงิน", "Choose payment proof")}</span><input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(event) => setFile(event.target.files?.[0] || null)} /></label><button type="button" disabled={!file || busy} onClick={() => void submitProof()} className="rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">{busy ? t("กำลังส่ง…", "Submitting…") : t("ส่งหลักฐานการชำระเงิน", "Submit payment proof")}</button>{errorMessage && <p className="text-sm text-rose-700">{t(...errorMessage)}</p>}{order.payment_proof_submitted_at && <p className="text-xs text-emerald-700">{t("ส่งหลักฐานการชำระเงินแล้ว", "Payment proof submitted")} {formatCustomerDate(order.payment_proof_submitted_at, locale)}</p>}</div></div>}
      {order.status === "paid" && <div className="mt-5 flex items-center gap-2 text-sm text-emerald-700"><CheckCircle2 className="h-4 w-4" /> {t("ยืนยันการชำระเงินแล้ว ดูบัตรได้ที่บัตรของฉัน", "Payment verified. Tickets are ready in My tickets.")}</div>}
    </article>
  );
}

function ClaimRecordForm({ locale, onClaimed }: { locale: CustomerLocale; onClaimed: () => Promise<void> }) {
  const t = (th: string, en: string) => locale === "th" ? th : en;
  const [recordType, setRecordType] = useState<"registration" | "order">("registration");
  const [recordId, setRecordId] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<CustomerCopy>();
  const submit = async () => {
    if (!recordId.trim()) return;
    setBusy(true);
    setMessage(undefined);
    try {
      await customerApi(`/api/customer/claims`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(recordType === "registration" ? { registration_id: recordId } : { order_id: recordId }) });
      setRecordId("");
      setMessage(["เชื่อมรายการกับบัญชีนี้แล้ว", "Record linked to this account."]);
      await onClaimed();
    } catch (error: unknown) {
      setMessage(customerErrorCopy(error, ["เชื่อมรายการไม่สำเร็จ", "Could not link record"]));
    } finally {
      setBusy(false);
    }
  };
  return <div className="rounded-3xl border border-blue-500/20 bg-blue-500/5 p-5"><h2 className="font-semibold text-slate-900">{t("เชื่อมรายการที่มีอยู่", "Link an existing record")}</h2><p className="mt-1 text-sm text-slate-600">{t("ใช้รหัสลงทะเบียนหรือรหัสคำสั่งซื้อที่ใช้อีเมลหรือเบอร์โทรศัพท์เดียวกับบัญชีที่ยืนยันแล้ว", "Use a registration ID or order ID created with the same verified email or phone.")}</p><div className="mt-4 flex flex-wrap gap-2"><select value={recordType} onChange={(event) => setRecordType(event.target.value === "order" ? "order" : "registration")} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-700"><option value="registration">{t("รหัสลงทะเบียน", "Registration ID")}</option><option value="order">{t("รหัสคำสั่งซื้อ", "Order ID")}</option></select><input value={recordId} onChange={(event) => setRecordId(event.target.value)} placeholder="REG_… / ORD_…" className="min-w-[12rem] flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-700 outline-none focus:border-blue-400" /><button type="button" disabled={busy || !recordId.trim()} onClick={() => void submit()} className="rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{busy ? t("กำลังเชื่อม…", "Linking…") : t("เชื่อมรายการ", "Link record")}</button></div>{message && <p className="mt-3 text-sm text-slate-700">{t(...message)}</p>}</div>;
}

export function CustomerAppScreen({ locale, languageControl, themeControl }: { locale: CustomerLocale; languageControl: React.ReactNode; themeControl: React.ReactNode }) {
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
  const [errorMessage, setErrorMessage] = useState<CustomerCopy>();
  const [pendingBookings, setPendingBookings] = useState<PaidNotificationBooking[]>([]);
  const [recentBookings, setRecentBookings] = useState<PaidNotificationBooking[]>([]);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const notificationMenu = useRef<HTMLDivElement>(null);
  const bell = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!notificationsOpen) return;
    const clickOutside = (event: PointerEvent) => {
      if (!notificationMenu.current?.contains(event.target as Node)) setNotificationsOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setNotificationsOpen(false);
      bell.current?.focus();
    };
    document.addEventListener("pointerdown", clickOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", clickOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [notificationsOpen]);
  const [paymentRevision, setPaymentRevision] = useState(0);

  useEffect(() => {
    if (!account?.email_verified_at) return;
    let request: AbortController | undefined;
    const refreshPayment = () => {
      request?.abort();
      const controller = new AbortController();
      request = controller;
      const load = (query: string, save: (bookings: PaidNotificationBooking[]) => void) =>
        customerApi<{ bookings: PaidNotificationBooking[] }>(`/api/customer/paid-bookings${query}`, { signal: controller.signal })
          .then(({ bookings }) => { if (!controller.signal.aborted) save(bookings); }).catch(() => {});
      void load("?awaiting_payment=1", setPendingBookings);
      void load("", setRecentBookings);
    };
    refreshPayment();
    window.addEventListener("focus", refreshPayment);
    return () => {
      request?.abort();
      window.removeEventListener("focus", refreshPayment);
    };
  }, [account?.email_verified_at, paymentRevision]);

  useEffect(() => {
    const holds = pendingBookings.filter(booking => booking.status === "awaiting_payment");
    if (!holds.length) return;
    const nextDue = Math.min(...holds.map(booking => Date.parse(booking.due_at)));
    const delay = Math.max(0, nextDue - Date.now());
    if (!Number.isFinite(delay) || delay > 2_147_483_647) return;
    const timer = window.setTimeout(() => {
      setPendingBookings(current => current.filter(booking => booking.status !== "awaiting_payment" || Date.parse(booking.due_at) > Date.now()));
      setPaymentRevision(value => value + 1);
    }, delay + 100);
    return () => window.clearTimeout(timer);
  }, [pendingBookings]);

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
      setErrorMessage(customerErrorCopy(error, ["โหลดข้อมูลผู้เข้าร่วมไม่สำเร็จ", "Failed to load customer data"]));
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
        setErrorMessage(customerErrorCopy(error, ["โหลดบัญชีผู้เข้าร่วมไม่สำเร็จ", "Failed to load customer account"]));
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

  useEffect(() => {
    const hash = window.location.hash;
    if (section !== "orders" || !hash.startsWith("#order-proof-")) return;
    const target = orders.find((order) => hash === `#order-proof-${encodeURIComponent(order.id)}`);
    if (target) document.getElementById(`order-proof-${target.id}`)?.scrollIntoView({ block: "start" });
  }, [orders, section]);

  const navigate = (nextSection: CustomerAppSection) => {
    window.history.pushState({}, "", sectionPath(nextSection));
    setSection(nextSection);
    setNotificationsOpen(false);
    setMobileNavOpen(false);
  };

  const logout = async () => {
    try { await customerApi("/api/customer/account/logout", { method: "POST" }); } finally { window.location.assign("/account/login"); }
  };

  const updatePreference = async (field: keyof CustomerPreferences, value: boolean) => {
    if (!preferences) return;
    setErrorMessage(undefined);
    try {
      const data = await customerApi<{ preferences: CustomerPreferences }>("/api/customer/notification-preferences", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ [field]: value }) });
      setPreferences(data.preferences);
    } catch (error) {
      setErrorMessage(customerErrorCopy(error, ["บันทึกการตั้งค่าการแจ้งเตือนไม่สำเร็จ", "Could not save notification preferences."]));
    }
  };

  if (loading) return <div className="flex min-h-screen items-center justify-center bg-slate-50 text-sm text-slate-600">{t("กำลังโหลดบัญชีผู้เข้าร่วม…", "Loading customer app…")}</div>;
  if (!account) return <div className="flex min-h-screen items-center justify-center bg-slate-50 px-5 text-center text-sm text-amber-800">{errorMessage ? t(...errorMessage) : t("เปิดบัญชีผู้เข้าร่วมไม่ได้", "Customer account unavailable")}</div>;

  const validPending = (dueAt?: string | null) => !dueAt || Date.parse(dueAt) > Date.now();
  const bookingItems = new Map([...recentBookings, ...pendingBookings].map(booking => [booking.reference, booking]));
  const paidItems: CustomerNotification[] = [...bookingItems.values()].map(booking => {
    const topUp = booking.status === "confirmed" && (booking.balance_due_minor ?? 0) > 0;
    const needsPayment = (booking.status === "awaiting_payment" && validPending(booking.due_at)) ||
      (topUp && !booking.pending_proofs);
    const expired = booking.status === "expired" || (booking.status === "awaiting_payment" && !needsPayment);
    const title = booking.refunded_minor ? t("บันทึกคืนเงินแล้ว", "Refund recorded")
      : booking.credit_issued_minor ? t("ออกเครดิตสำหรับงานนี้", "Credit issued for this event")
        : (expired || booking.status === "cancelled") && booking.credit_used_minor
          ? t("คืนเครดิตที่ใช้กับใบจอง", "Booking credit returned")
        : topUp ? booking.pending_proofs ? t("สลิปยอดเพิ่มรอตรวจสอบ", "Additional payment awaiting review")
          : t("มียอดที่ต้องชำระเพิ่ม", "Additional payment due")
        : needsPayment ? t("รอชำระเงินหรือส่งสลิป", "Payment or slip upload needed")
          : expired ? t("หมดเวลาชำระเงิน", "Payment deadline passed")
          : booking.status === "verification_pending" ? t("ส่งสลิปแล้ว รอตรวจสอบ", "Slip submitted for review")
          : booking.status === "confirmed" ? t("ยืนยันใบจองแล้ว", "Booking confirmed")
          : booking.status === "cancelled" ? t("ยกเลิกใบจองแล้ว", "Booking cancelled")
          : t("อัปเดตสถานะใบจอง", "Booking status updated");
    return { id: booking.reference, title, event: booking.event_name, at: expired ? booking.due_at : booking.updated_at,
      href: `/app/orders?paid_booking=${encodeURIComponent(booking.reference)}${needsPayment ? "&upload_slip=1" : ""}`, needsPayment };
  });
  const orderItems: CustomerNotification[] = account.email_verified_at ? orders
    .filter(order => order.status === "pending_payment" && validPending(order.hold_expires_at))
    .map(order => ({ id: order.id, title: t("รอชำระเงินหรือส่งสลิป", "Payment or slip upload needed"),
      event: order.event_name ?? "", at: order.updated_at, href: `/app/orders#order-proof-${encodeURIComponent(order.id)}`, needsPayment: true })) : [];
  const notifications = [...paidItems, ...orderItems].sort((left, right) =>
    (Date.parse(right.at ?? "") || 0) - (Date.parse(left.at ?? "") || 0));
  const paymentLink = notifications.find(entry => entry.needsPayment)?.href ?? "";
  const paymentLabel = t("มีรายการรอชำระเงินหรือส่งสลิป", "Payment or slip upload needed");

  const content = section === "tickets" ? (
    <div className="space-y-4"><a href="/app/orders" className="inline-flex min-h-11 items-center font-semibold text-blue-700 underline">{t("ดูสถานะการจองและบัตรสัมมนา", "View bookings and seminar passes")}</a>{account.email_verified_at && <CustomerPaidBookings key={section} locale={locale} tickets />}<ClaimRecordForm locale={locale} onClaimed={loadCustomerData} />{tickets.length || registrations.length ? <div className="space-y-4">{tickets.map((ticket) => <article key={ticket.id} className="flex flex-wrap items-center justify-between gap-4 rounded-3xl border border-slate-200 bg-white p-5"><div><p className="text-xs uppercase tracking-[0.16em] text-slate-500">{ticket.performance_title || t("บัตร", "Ticket")}</p><h2 className="mt-1 font-semibold text-slate-900">{ticket.holder_name || t("ผู้เข้าร่วม", "Attendee")}</h2><p className="mt-1 text-sm text-slate-600">{ticket.zone || ""} {ticket.row_label || ""} {ticket.seat_label || ""} · {statusLabel(ticket.status, locale)}</p></div><div className="flex gap-2">{ticket.delivery?.png_url && <a href={ticket.delivery.png_url} target="_blank" rel="noreferrer" className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700">{t("บัตร PNG", "Ticket PNG")}</a>}{ticket.delivery?.svg_url && <a href={ticket.delivery.svg_url} target="_blank" rel="noreferrer" className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700">{t("บัตร SVG", "Ticket SVG")}</a>}</div></article>)}{registrations.map((registration) => <article key={registration.id} className="flex flex-wrap items-center justify-between gap-4 rounded-3xl border border-slate-200 bg-white p-5"><div><p className="text-xs uppercase tracking-[0.16em] text-slate-500">{t("การลงทะเบียน", "Registration")}</p><h2 className="mt-1 font-semibold text-slate-900">{registration.first_name} {registration.last_name}</h2><p className="mt-1 text-sm text-slate-600">{registration.id} · {statusLabel(registration.status, locale)} · {formatCustomerDate(registration.timestamp, locale)}</p></div><div className="flex gap-2">{registration.ticket?.png_url && <a href={registration.ticket.png_url} target="_blank" rel="noreferrer" className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700">{t("บัตร PNG", "Ticket PNG")}</a>}</div></article>)}</div> : <EmptyState locale={locale} title={t("ยังไม่มีบัตรอื่น", "No other tickets yet")} body={t("รายการลงทะเบียนที่เชื่อมแล้วและบัตรที่ออกแล้วจะแสดงที่นี่", "Linked registrations and issued seat tickets appear here.")} />}</div>
  ) : section === "orders" ? (
    <div className="space-y-4">
      {paymentLink && !window.location.search.includes("paid_booking=") && !window.location.hash.startsWith("#order-proof-") && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
          <p className="font-semibold">{paymentLabel}</p>
          <a className="font-bold underline underline-offset-2" href={paymentLink}>{t("ไปที่รายการและอัปโหลดสลิป", "Open booking and upload slip")}</a>
        </div>
      )}
      {account.email_verified_at && <CustomerPaidBookings key={section} locale={locale} onPaymentChanged={() => setPaymentRevision((value) => value + 1)} />}{orders.length ? <div className="space-y-4">{orders.map((order) => <OrderCard key={order.id} locale={locale} order={order} onUpdated={(updated) => setOrders((current) => current.map((item) => item.id === updated.id ? updated : item))} />)}</div> : !account.email_verified_at ? <EmptyState locale={locale} title={t("ยืนยันอีเมลของคุณ", "Verify your email")} body={t("ยืนยันอีเมลเพื่อดูรายการจองแบบชำระเงิน", "Verify your email to view paid registrations.")} /> : null}</div>
  ) : section === "notifications" ? (
    <div className="space-y-4">
      <section className="rounded-2xl border border-slate-200 bg-white">
        <h2 className="border-b border-slate-200 px-3 py-3 font-semibold">{t("รายการแจ้งเตือนล่าสุด", "Recent notifications")}</h2>
        <CustomerNotificationList entries={notifications} locale={locale} />
      </section>
      <div className="rounded-3xl border border-slate-200 bg-white p-6"><h2 className="text-lg font-semibold text-slate-900">{t("การตั้งค่าการแจ้งเตือน", "Notification preferences")}</h2><p className="mt-2 text-sm leading-6 text-slate-600">{t("ระบบเปิดอีเมลแจ้งสถานะไว้ตามค่าเริ่มต้น ส่วน SMS ส่งเมื่อคุณเลือกเปิดและระบบตั้งค่าผู้ให้บริการแล้ว", "Transactional email stays on by default. SMS remains opt-in and is only sent when the provider is configured.")}</p>{preferences && <div className="mt-6 space-y-3">{([ ["email_transactional_enabled", t("อีเมลแจ้งสถานะ", "Transactional email")], ["sms_transactional_enabled", t("SMS แจ้งสถานะ", "Transactional SMS")], ["sms_marketing_enabled", t("SMS ข่าวสารและโปรโมชัน", "Marketing SMS")] ] as Array<[keyof CustomerPreferences, string]>).map(([field, label]) => <label key={field} className="flex items-center justify-between gap-4 rounded-2xl border border-slate-200 px-4 py-3 text-sm text-slate-700"><span>{label}</span><input type="checkbox" checked={preferences[field]} onChange={(event) => void updatePreference(field, event.target.checked)} className="h-4 w-4 rounded border-slate-600 bg-white text-blue-600" /></label>)}</div>}</div>
    </div>
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

  return <div className="min-h-screen bg-slate-50 text-slate-900"><header className="sticky top-0 z-30 border-b border-slate-200 bg-white shadow-sm"><div className="mx-auto flex max-w-7xl items-center justify-between gap-2 px-3 py-2 sm:px-8"><a href="/app" className="flex min-w-0 items-center gap-2"><span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-blue-600 text-white"><Ticket className="h-5 w-5" /></span><span><span className="block text-sm font-bold tracking-wide text-slate-900">Meetrix</span><span className="hidden text-xs text-slate-500 sm:block">{t("บัญชีผู้เข้าร่วม", "Customer app")}</span></span></a><div className="flex shrink-0 items-center gap-1.5 sm:gap-2">{languageControl}{themeControl}
    <div ref={notificationMenu} className="relative">
      <button ref={bell} type="button" onClick={() => setNotificationsOpen(value => !value)}
        aria-expanded={notificationsOpen} aria-controls="customer-notifications-list"
        aria-label={t("การแจ้งเตือน", "Notifications")}
        className={`relative inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg hover:bg-slate-200/40 ${paymentLink ? "bg-rose-50 text-rose-700" : "text-slate-700"}`}>
        <Bell className="h-5 w-5" aria-hidden="true" />
        {paymentLink && <span aria-hidden="true" className="absolute right-1.5 top-1 h-2.5 w-2.5 rounded-full border border-white bg-rose-600" />}
      </button>
      {notificationsOpen && <section id="customer-notifications-list" aria-label={t("รายการแจ้งเตือน", "Notifications list")}
        className="fixed inset-x-3 top-14 z-40 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:mt-2 sm:w-96">
        <h2 className="border-b border-slate-200 px-3 py-2.5 text-sm font-semibold">{t("การแจ้งเตือน", "Notifications")}</h2>
        <div className="max-h-[min(24rem,60vh)] overflow-auto">
          <CustomerNotificationList entries={notifications.slice(0, 8)} locale={locale} onSelect={() => setNotificationsOpen(false)} />
        </div>
        <a href="/app/notifications" onClick={event => { event.preventDefault(); navigate("notifications"); }}
          className="block border-t border-slate-200 px-3 py-2.5 text-center text-sm font-semibold text-blue-700 hover:underline">
          {t("ดูรายการทั้งหมด", "View all")}
        </a>
      </section>}
    </div><a href="/events" aria-label={t("งานทั้งหมด", "All events")} className="inline-flex min-h-9 items-center gap-1 rounded-lg px-2 text-xs font-semibold text-blue-700 hover:bg-slate-200/40 sm:text-sm"><CalendarDays className="h-4 w-4" /> <span className="hidden sm:inline">{t("งาน", "Events")}</span></a><span className="hidden text-sm text-slate-600 sm:block">{account.first_name} {account.last_name}</span><button type="button" onClick={() => void logout()} className="hidden items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:underline sm:inline-flex"><LogOut className="h-4 w-4" /> {t("ออกจากระบบ", "Sign out")}</button><button type="button" onClick={() => setMobileNavOpen((value) => !value)} className="rounded-xl border border-slate-200 p-2 text-slate-700 sm:hidden" aria-label={t("เปิดหรือปิดเมนู", "Toggle navigation")}>{mobileNavOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}</button></div></div></header><div className="mx-auto flex max-w-7xl gap-6 px-5 py-6 sm:px-8"><aside className={`${mobileNavOpen ? "block" : "hidden"} fixed inset-x-5 top-16 z-40 rounded-2xl border border-slate-200 bg-white p-3 shadow-2xl sm:static sm:block sm:w-56 sm:shrink-0 sm:border-0 sm:bg-transparent sm:p-0 sm:shadow-none`}><nav className="space-y-1" aria-label={t("เมนูบัญชีผู้เข้าร่วม", "Customer navigation")}>
      {account.has_staff_access && (
        <div className="mb-3"><WorkspaceSwitchLink language={locale} destination="staff" /></div>
      )}
      <a href="/events" className="mb-3 flex min-h-11 items-center gap-2 rounded-xl border border-blue-400/30 px-3 py-2.5 text-sm font-semibold text-blue-700 hover:bg-blue-600/15"><ArrowLeft className="h-4 w-4" /> {t("งานทั้งหมด", "All events")}</a>{navigation.map(({ id, label, icon: Icon }) => <a key={id} href={sectionPath(id)} onClick={(event) => { event.preventDefault(); navigate(id); }} className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition-colors ${section === id ? "bg-blue-600/15 text-blue-700" : "text-slate-600 hover:bg-slate-200/40 hover:underline"}`}><Icon className="h-4 w-4" /> {label}</a>)}<button type="button" onClick={() => void logout()} className="mt-4 flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-slate-500 hover:bg-slate-200/40 hover:underline sm:hidden"><LogOut className="h-4 w-4" /> {t("ออกจากระบบ", "Sign out")}</button></nav></aside><main className="min-w-0 flex-1"><div className="mb-6"><nav aria-label={t("เส้นทางหน้า", "Breadcrumb")} className="mb-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm"><a href="/events" className="text-blue-700 hover:underline">{t("งานทั้งหมด", "All Events")}</a><ChevronRight className="h-3.5 w-3.5 text-slate-600" /><a href="/app" onClick={(event) => { event.preventDefault(); navigate("dashboard"); }} className="text-blue-700 hover:underline">{t("บัญชีของฉัน", "My Account")}</a>{section !== "dashboard" && <><ChevronRight className="h-3.5 w-3.5 text-slate-600" /><span className="text-slate-700">{navigation.find(item => item.id === section)?.label}</span></>}</nav><p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-700">{t("บัญชีผู้เข้าร่วม", "Customer area")}</p><h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-900">{navigation.find((item) => item.id === section)?.label || t("ภาพรวม", "Overview")}</h1><p className="mt-2 text-sm text-slate-600">{t("ยินดีต้อนรับ", "Welcome back,")} {account.first_name}{dataLoading && t(" กำลังอัปเดต…", " Updating…")}</p>{errorMessage && <p className="mt-2 text-sm text-rose-700">{t(...errorMessage)}</p>}</div>
    {!account.email_verified_at && <div className="mb-6">
      <CustomerVerificationNotice locale={locale} email={account.email}/>
      <a href="/account" className="mt-3 inline-flex min-h-11 items-center rounded-xl border border-amber-400 px-4 py-2 text-sm font-bold text-blue-700 hover:underline">
        {t("ส่งอีเมลยืนยันอีกครั้ง", "Resend verification")}
      </a>
    </div>}{content}</main></div></div>;
}

import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowLeft, CalendarDays, CheckCircle2, ChevronRight, LockKeyhole, LogOut, Mail, RefreshCw, Save, ShieldCheck, ShoppingBag, UserRound } from "lucide-react";

export type CustomerAccount = {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  phone: string;
  email_verified_at: string | null;
  address_line1: string | null;
  address_line2: string | null;
  district: string | null;
  subdistrict: string | null;
  province: string | null;
  postal_code: string | null;
  country: string | null;
  status: "pending" | "active" | "disabled";
};

type CustomerOrderSummary = {
  id: string;
  event_name: string | null;
  event_slug: string | null;
  performance_title?: string;
  total_amount: number;
  currency: string;
  status: string;
  tickets?: Array<{ id: string }>;
};

type CustomerScreenMode = "login" | "register" | "forgot" | "reset" | "verify" | "profile" | "unavailable";

type CustomerForm = {
  email: string;
  password: string;
  first_name: string;
  last_name: string;
  phone: string;
  address_line1: string;
  address_line2: string;
  district: string;
  subdistrict: string;
  province: string;
  postal_code: string;
  country: string;
  token: string;
  accept_terms: boolean;
  accept_privacy: boolean;
};

const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function resolveCustomerMode(pathname: string): CustomerScreenMode {
  if (pathname.endsWith("/register")) return "register";
  if (pathname.endsWith("/forgot-password")) return "forgot";
  if (pathname.endsWith("/reset-password")) return "reset";
  if (pathname.endsWith("/verify-email")) return "verify";
  if (pathname.endsWith("/login")) return "login";
  return "profile";
}

function readCookie(name: string) {
  if (typeof document === "undefined") return "";
  const prefix = `${name}=`;
  for (const segment of document.cookie.split(";")) {
    const value = segment.trim();
    if (!value.startsWith(prefix)) continue;
    try {
      return decodeURIComponent(value.slice(prefix.length));
    } catch {
      return value.slice(prefix.length);
    }
  }
  return "";
}

export async function customerApi<T>(path: string, init: RequestInit = {}) {
  const method = String(init.method || "GET").toUpperCase();
  const headers = new Headers(init.headers || undefined);
  if (UNSAFE_METHODS.has(method)) {
    const csrfToken = readCookie("fbs_customer_csrf");
    if (csrfToken) headers.set("x-csrf-token", csrfToken);
  }
  const response = await fetch(path, { ...init, headers, credentials: "same-origin" });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401) throw new Error("CUSTOMER_NOT_AUTHENTICATED");
    if (response.status === 404) throw new Error("CUSTOMER_APP_DISABLED");
    const issues = Array.isArray(data?.issues) ? data.issues.map((issue: { message?: string }) => issue.message).filter(Boolean).join(", ") : "";
    throw new Error(issues || data?.error || "Request failed");
  }
  return data as T;
}

function inputClass() {
  return "w-full rounded-2xl border border-white/10 bg-slate-900/80 px-4 py-3 text-slate-100 outline-none placeholder:text-slate-500 focus:border-blue-400 focus:ring-2 focus:ring-blue-500/30 disabled:cursor-not-allowed disabled:opacity-60";
}

function CustomerField({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
  autoComplete,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
  autoComplete?: string;
  disabled?: boolean;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">{label}</span>
      <input
        className={inputClass()}
        type={type}
        value={value}
        placeholder={placeholder}
        autoComplete={autoComplete}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function customerFormDefaults(token = ""): CustomerForm {
  return {
    email: "",
    password: "",
    first_name: "",
    last_name: "",
    phone: "",
    address_line1: "",
    address_line2: "",
    district: "",
    subdistrict: "",
    province: "",
    postal_code: "",
    country: "Thailand",
    token,
    accept_terms: false,
    accept_privacy: false,
  };
}

export function CustomerAccountScreen() {
  const pathname = typeof window !== "undefined" ? window.location.pathname : "/account";
  const queryToken = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("token") || "" : "";
  const [mode, setMode] = useState<CustomerScreenMode>(() => resolveCustomerMode(pathname));
  const [account, setAccount] = useState<CustomerAccount | null>(null);
  const [form, setForm] = useState<CustomerForm>(() => customerFormDefaults(queryToken));
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [notice, setNotice] = useState("");
  const [orders, setOrders] = useState<CustomerOrderSummary[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const handledTokenRef = useRef("");

  const setField = (field: keyof CustomerForm, value: string | boolean) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const navigate = (nextMode: CustomerScreenMode) => {
    const nextPath = nextMode === "profile" ? "/account" : `/account/${nextMode === "reset" ? "reset-password" : nextMode === "verify" ? "verify-email" : nextMode === "forgot" ? "forgot-password" : nextMode}`;
    window.history.pushState({}, "", nextPath);
    setMode(nextMode);
    setErrorMessage("");
  };

  useEffect(() => {
    if (mode !== "profile" || account) return;
    let cancelled = false;
    setBusy(true);
    void customerApi<{ account: CustomerAccount }>("/api/customer/account/me")
      .then((data) => {
        if (cancelled) return;
        setAccount(data.account);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        if (error instanceof Error && error.message === "CUSTOMER_NOT_AUTHENTICATED") {
          navigate("login");
          return;
        }
        setMode("unavailable");
        setErrorMessage(error instanceof Error ? error.message : "Customer account is unavailable");
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [account, mode]);

  useEffect(() => {
    if (mode !== "profile" || !account) return;
    let cancelled = false;
    setOrdersLoading(true);
    void customerApi<{ orders: CustomerOrderSummary[] }>("/api/customer/orders")
      .then((data) => {
        if (!cancelled) setOrders(Array.isArray(data.orders) ? data.orders : []);
      })
      .catch(() => {
        if (!cancelled) setOrders([]);
      })
      .finally(() => {
        if (!cancelled) setOrdersLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [account?.id, mode]);

  useEffect(() => {
    if (mode !== "verify" || !form.token || handledTokenRef.current === form.token) return;
    handledTokenRef.current = form.token;
    setBusy(true);
    void customerApi<{ account: CustomerAccount }>("/api/customer/account/verify-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: form.token }),
    })
      .then(() => {
        navigate("login");
        setNotice("Email verified. You can now sign in.");
      })
      .catch((error: unknown) => setErrorMessage(error instanceof Error ? error.message : "Failed to verify email"))
      .finally(() => setBusy(false));
  }, [form.token, mode]);

  useEffect(() => {
    if (!account) return;
    setForm((current) => ({
      ...current,
      first_name: account.first_name,
      last_name: account.last_name,
      email: account.email,
      phone: account.phone,
      address_line1: account.address_line1 || "",
      address_line2: account.address_line2 || "",
      district: account.district || "",
      subdistrict: account.subdistrict || "",
      province: account.province || "",
      postal_code: account.postal_code || "",
      country: account.country || "Thailand",
    }));
  }, [account]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setErrorMessage("");
    setNotice("");
    try {
      if (mode === "login") {
        const data = await customerApi<{ account: CustomerAccount }>("/api/customer/account/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: form.email, password: form.password }),
        });
        setAccount(data.account);
        setField("password", "");
        navigate("profile");
        return;
      }
      if (mode === "register") {
        const data = await customerApi<{ verification_delivery_queued?: boolean }>("/api/customer/account/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: form.email,
            password: form.password,
            first_name: form.first_name,
            last_name: form.last_name,
            phone: form.phone,
            accept_terms: form.accept_terms,
            accept_privacy: form.accept_privacy,
          }),
        });
        navigate("login");
        setNotice(data.verification_delivery_queued === false
          ? "Account created. Please verify your email before signing in."
          : "Account created. Check your email to verify the account.");
        return;
      }
      if (mode === "forgot") {
        await customerApi("/api/customer/account/forgot-password", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: form.email }),
        });
        setNotice("If that email exists, a reset link has been sent.");
        return;
      }
      if (mode === "reset") {
        await customerApi("/api/customer/account/reset-password", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: form.token, password: form.password }),
        });
        navigate("login");
        setNotice("Password reset. You can now sign in.");
        return;
      }
      if (mode === "profile" && account) {
        const data = await customerApi<{ account: CustomerAccount }>("/api/customer/account/profile", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            first_name: form.first_name,
            last_name: form.last_name,
            phone: form.phone,
            address_line1: form.address_line1,
            address_line2: form.address_line2,
            district: form.district,
            subdistrict: form.subdistrict,
            province: form.province,
            postal_code: form.postal_code,
            country: form.country,
          }),
        });
        setAccount(data.account);
        setNotice("Profile saved.");
      }
    } catch (error: unknown) {
      setErrorMessage(error instanceof Error ? error.message : "Request failed");
    } finally {
      setBusy(false);
    }
  };

  const logout = async () => {
    setBusy(true);
    try {
      await customerApi("/api/customer/account/logout", { method: "POST" });
    } catch {
      // Clear the local view even if the server session has already expired.
    } finally {
      setAccount(null);
      setBusy(false);
      navigate("login");
    }
  };

  const resendVerification = async () => {
    if (!form.email.trim()) {
      setErrorMessage("Enter your account email first.");
      return;
    }
    setBusy(true);
    setErrorMessage("");
    setNotice("");
    try {
      const data = await customerApi<{ verification_delivery_queued?: boolean }>("/api/customer/account/resend-verification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: form.email }),
      });
      setNotice(data.verification_delivery_queued === false
        ? "We could not queue the email yet. Please try again shortly or contact support."
        : "A new verification email has been queued. Check your inbox and spam folder.");
    } catch (error: unknown) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to resend verification email");
    } finally {
      setBusy(false);
    }
  };

  const revokeSessions = async () => {
    setBusy(true);
    setErrorMessage("");
    try {
      await customerApi("/api/customer/account/sessions/revoke", { method: "POST" });
      setAccount(null);
      navigate("login");
      setNotice("All customer sessions were revoked.");
    } catch (error: unknown) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to revoke sessions");
    } finally {
      setBusy(false);
    }
  };

  const disableAccount = async () => {
    if (!window.confirm("Disable this customer account and sign out all sessions?")) return;
    setBusy(true);
    setErrorMessage("");
    try {
      await customerApi("/api/customer/account/disable", { method: "POST" });
      setAccount(null);
      navigate("login");
      setNotice("Your customer account has been disabled.");
    } catch (error: unknown) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to disable account");
    } finally {
      setBusy(false);
    }
  };

  const showBack = mode !== "profile" && mode !== "unavailable";
  const title = mode === "register" ? "Create your account"
    : mode === "forgot" ? "Reset your password"
      : mode === "reset" ? "Choose a new password"
        : mode === "verify" ? "Verify your email"
          : mode === "profile" ? "Your account" : "Welcome back";
  const subtitle = mode === "profile" ? "Manage your customer details securely."
    : "Ticketing access for attendees and buyers.";

  return (
    <div className="min-h-screen bg-[#070b14] px-4 py-10 text-slate-100 selection:bg-blue-500/30">
      <div className="mx-auto w-full max-w-2xl">
        <div className="mb-8 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-blue-600 shadow-lg shadow-blue-950/40">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm font-bold tracking-wide text-white">Meetrix Account</p>
              <p className="text-xs text-slate-500">Customer access</p>
            </div>
          </div>
          {showBack && (
            <button type="button" onClick={() => navigate("login")} className="inline-flex items-center gap-2 text-sm text-slate-400 hover:text-white">
              <ArrowLeft className="h-4 w-4" /> Back to sign in
            </button>
          )}
        </div>

        <div className="rounded-[2rem] border border-white/10 bg-white/[0.045] p-6 shadow-2xl shadow-black/30 sm:p-9">
          <div className="mb-7">
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-blue-300">Customer account</p>
            <h1 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">{title}</h1>
            <p className="mt-2 text-sm leading-6 text-slate-400">{subtitle}</p>
          </div>

          {busy && mode === "profile" && !account ? (
            <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-slate-900/60 p-5 text-sm text-slate-300">
              <RefreshCw className="h-4 w-4 animate-spin text-blue-300" /> Loading account…
            </div>
          ) : mode === "unavailable" ? (
            <div className="space-y-4 rounded-2xl border border-amber-400/20 bg-amber-400/10 p-5 text-sm text-amber-100">
              <p>Customer accounts are not enabled in this environment yet.</p>
              {errorMessage && <p className="text-xs text-amber-200/70">{errorMessage}</p>}
            </div>
          ) : mode === "verify" ? (
            <div className="space-y-4 rounded-2xl border border-white/10 bg-slate-900/60 p-5 text-sm text-slate-300">
              <CheckCircle2 className={`h-7 w-7 ${errorMessage ? "text-rose-300" : "text-blue-300"}`} />
              <p>{busy ? "Verifying your email…" : errorMessage || "This verification link is ready."}</p>
              {!busy && <button type="button" onClick={() => navigate("login")} className="rounded-xl bg-blue-600 px-4 py-2.5 font-semibold text-white hover:bg-blue-500">Continue to sign in</button>}
            </div>
          ) : mode === "profile" && account ? (
            <form className="space-y-6" onSubmit={(event) => void submit(event)}>
              <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-slate-900/60 p-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-500/15 text-blue-200"><UserRound className="h-5 w-5" /></div>
                  <div><p className="font-semibold text-white">{account.first_name} {account.last_name}</p><p className="text-xs text-slate-400">{account.email}</p></div>
                </div>
                <span className="rounded-full bg-emerald-400/10 px-3 py-1 text-xs font-semibold text-emerald-300">{account.status}</span>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <a href="/events" className="group flex items-center justify-between rounded-2xl border border-blue-400/20 bg-blue-500/10 p-4 transition-colors hover:border-blue-300/50 hover:bg-blue-500/15">
                  <span className="flex items-center gap-3"><CalendarDays className="h-5 w-5 text-blue-300" /><span><span className="block text-sm font-semibold text-white">Browse events</span><span className="mt-1 block text-xs text-slate-400">Find another event to attend</span></span></span>
                  <ChevronRight className="h-4 w-4 text-blue-300 transition-transform group-hover:translate-x-0.5" />
                </a>
                <a href="/app/orders" className="group flex items-center justify-between rounded-2xl border border-violet-400/20 bg-violet-500/10 p-4 transition-colors hover:border-violet-300/50 hover:bg-violet-500/15">
                  <span className="flex items-center gap-3"><ShoppingBag className="h-5 w-5 text-violet-300" /><span><span className="block text-sm font-semibold text-white">My tickets &amp; orders</span><span className="mt-1 block text-xs text-slate-400">Review purchases and payment status</span></span></span>
                  <ChevronRight className="h-4 w-4 text-violet-300 transition-transform group-hover:translate-x-0.5" />
                </a>
              </div>
              <section className="rounded-2xl border border-white/10 bg-slate-900/50 p-4" aria-labelledby="customer-purchases-heading">
                <div className="flex items-center justify-between gap-3">
                  <div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-blue-300">Purchase history</p><h2 id="customer-purchases-heading" className="mt-1 text-base font-semibold text-white">Events you selected</h2></div>
                  {orders.length > 0 && <a href="/app/orders" className="text-xs font-semibold text-blue-300 hover:text-blue-200">View all</a>}
                </div>
                {ordersLoading ? (
                  <p className="mt-4 flex items-center gap-2 text-sm text-slate-400"><RefreshCw className="h-4 w-4 animate-spin text-blue-300" /> Loading purchases…</p>
                ) : orders.length > 0 ? (
                  <div className="mt-4 space-y-2">
                    {orders.slice(0, 3).map((order) => (
                      <div key={order.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 bg-slate-950/40 px-3 py-3">
                        <div className="min-w-0"><p className="truncate text-sm font-semibold text-slate-100">{order.event_name || order.performance_title || "Purchased event"}</p><p className="mt-1 text-xs text-slate-500">{order.performance_title || "Order"} · {order.tickets?.length || 0} ticket{order.tickets?.length === 1 ? "" : "s"} · {order.status.replaceAll("_", " ")}</p></div>
                        {order.event_slug ? <a href={`/events/${encodeURIComponent(order.event_slug)}`} className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-white/10 px-3 py-2 text-xs font-semibold text-slate-200 hover:border-blue-300 hover:text-white">Open event <ChevronRight className="h-3.5 w-3.5" /></a> : <a href="/app/orders" className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-white/10 px-3 py-2 text-xs font-semibold text-slate-200 hover:border-blue-300 hover:text-white">Open order <ChevronRight className="h-3.5 w-3.5" /></a>}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="mt-3 text-sm leading-6 text-slate-400">ยังไม่มีรายการซื้อในบัญชีนี้ ลองดู event ที่เปิดขายได้จากปุ่ม Browse events</p>
                )}
              </section>
              <div className="grid gap-4 sm:grid-cols-2">
                <CustomerField label="First name" value={form.first_name} onChange={(value) => setField("first_name", value)} autoComplete="given-name" />
                <CustomerField label="Last name" value={form.last_name} onChange={(value) => setField("last_name", value)} autoComplete="family-name" />
                <CustomerField label="Phone" value={form.phone} onChange={(value) => setField("phone", value)} autoComplete="tel" />
                <CustomerField label="Email" value={form.email} onChange={() => undefined} type="email" autoComplete="email" disabled />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <CustomerField label="Address line 1" value={form.address_line1} onChange={(value) => setField("address_line1", value)} autoComplete="address-line1" />
                <CustomerField label="Address line 2" value={form.address_line2} onChange={(value) => setField("address_line2", value)} autoComplete="address-line2" />
                <CustomerField label="District" value={form.district} onChange={(value) => setField("district", value)} />
                <CustomerField label="Subdistrict" value={form.subdistrict} onChange={(value) => setField("subdistrict", value)} />
                <CustomerField label="Province" value={form.province} onChange={(value) => setField("province", value)} autoComplete="address-level1" />
                <CustomerField label="Postal code" value={form.postal_code} onChange={(value) => setField("postal_code", value)} autoComplete="postal-code" />
              </div>
              <div className="flex flex-wrap gap-3">
                <button disabled={busy} className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 font-semibold text-white hover:bg-blue-500 disabled:opacity-50"><Save className="h-4 w-4" /> Save profile</button>
                <button type="button" disabled={busy} onClick={() => void logout()} className="inline-flex items-center gap-2 rounded-xl border border-white/10 px-4 py-2.5 font-semibold text-slate-300 hover:border-white/20 hover:text-white disabled:opacity-50"><LogOut className="h-4 w-4" /> Sign out</button>
                <button type="button" disabled={busy} onClick={() => void revokeSessions()} className="rounded-xl px-3 py-2.5 text-sm text-rose-300 hover:bg-rose-400/10 disabled:opacity-50">Revoke all sessions</button>
                <button type="button" disabled={busy} onClick={() => void disableAccount()} className="rounded-xl px-3 py-2.5 text-sm text-rose-400 hover:bg-rose-400/10 disabled:opacity-50">Disable account</button>
              </div>
            </form>
          ) : (
            <form className="space-y-5" onSubmit={(event) => void submit(event)}>
              {(mode === "register" || mode === "profile") && <div className="grid gap-4 sm:grid-cols-2"><CustomerField label="First name" value={form.first_name} onChange={(value) => setField("first_name", value)} autoComplete="given-name" /><CustomerField label="Last name" value={form.last_name} onChange={(value) => setField("last_name", value)} autoComplete="family-name" /></div>}
              {mode !== "reset" && <CustomerField label="Email" value={form.email} onChange={(value) => setField("email", value)} type="email" autoComplete="email" />}
              {(mode === "register" || mode === "login") && <CustomerField label="Password" value={form.password} onChange={(value) => setField("password", value)} type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} />}
              {mode === "register" && <CustomerField label="Phone" value={form.phone} onChange={(value) => setField("phone", value)} autoComplete="tel" />}
              {(mode === "reset") && <CustomerField label="New password" value={form.password} onChange={(value) => setField("password", value)} type="password" autoComplete="new-password" />}
              {mode === "register" && <div className="space-y-3 rounded-2xl border border-white/10 bg-slate-900/50 p-4 text-sm text-slate-300"><label className="flex gap-3"><input type="checkbox" checked={form.accept_terms} onChange={(event) => setField("accept_terms", event.target.checked)} className="mt-1 accent-blue-500" /> I accept the terms of service.</label><label className="flex gap-3"><input type="checkbox" checked={form.accept_privacy} onChange={(event) => setField("accept_privacy", event.target.checked)} className="mt-1 accent-blue-500" /> I accept the privacy notice.</label></div>}
              {errorMessage && <p className="text-sm text-rose-300">{errorMessage}</p>}
              {notice && <p className="flex items-start gap-2 text-sm text-emerald-300"><Mail className="mt-0.5 h-4 w-4 shrink-0" /> {notice}</p>}
              <button disabled={busy} className="flex w-full items-center justify-center gap-2 rounded-2xl bg-blue-600 px-4 py-3 font-semibold text-white transition-colors hover:bg-blue-500 disabled:opacity-50">{busy && <RefreshCw className="h-4 w-4 animate-spin" />}{mode === "register" ? "Create account" : mode === "forgot" ? "Send reset link" : mode === "reset" ? "Reset password" : "Sign in"}</button>
              <div className="flex flex-wrap justify-between gap-3 text-sm text-slate-400">
                {mode === "login" && <><button type="button" onClick={() => navigate("register")} className="hover:text-white">Create account</button><button type="button" onClick={() => void resendVerification()} disabled={busy} className="hover:text-white disabled:opacity-50">Resend verification</button><button type="button" onClick={() => navigate("forgot")} className="hover:text-white">Forgot password?</button></>}
                {mode === "register" && <button type="button" onClick={() => navigate("login")} className="hover:text-white">Already have an account? Sign in</button>}
                {(mode === "forgot" || mode === "reset") && <button type="button" onClick={() => navigate("login")} className="hover:text-white">Back to sign in</button>}
              </div>
            </form>
          )}

          {errorMessage && mode === "profile" && <p className="mt-5 text-sm text-rose-300">{errorMessage}</p>}
          {notice && mode === "profile" && <p className="mt-5 text-sm text-emerald-300">{notice}</p>}
        </div>
        <p className="mt-6 flex items-center justify-center gap-2 text-center text-xs text-slate-600"><LockKeyhole className="h-3.5 w-3.5" /> Customer credentials are stored separately from organizer accounts.</p>
      </div>
    </div>
  );
}

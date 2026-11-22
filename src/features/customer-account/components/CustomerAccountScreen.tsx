import { customerErrorCopy, type CustomerCopy } from "../customerLocale";
import { CustomerVerificationNotice } from "./CustomerVerificationNotice";
import type { ReactNode } from "react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowLeft, CalendarDays, CheckCircle2, LockKeyhole, LogOut, Mail, RefreshCw, Save, ShieldCheck, ShoppingBag, UserRound } from "lucide-react";

export type CustomerAccount = {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  phone: string;
  email_verified_at: string | null;
  has_staff_access?: boolean;
  address_line1: string | null;
  address_line2: string | null;
  district: string | null;
  subdistrict: string | null;
  province: string | null;
  postal_code: string | null;
  country: string | null;
  status: "pending" | "active" | "disabled";
};


type CustomerScreenMode = "login" | "register" | "check-email" | "forgot" | "reset" | "verify" | "profile" | "unavailable";

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
  if (pathname.endsWith("/check-email")) return "check-email";
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
    if (response.status === 401) throw new Error("CUSTOMER_NOT_AUTHENTICATED", { cause: data?.error });
    if (response.status === 404) throw new Error("CUSTOMER_APP_DISABLED", { cause: data?.error });
    const issues = Array.isArray(data?.issues) ? data.issues.map((issue: { message?: string }) => issue.message).filter(Boolean).join(", ") : "";
    throw new Error(issues || data?.error || "Request failed");
  }
  return data as T;
}

function inputClass() {
  return "w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 outline-none placeholder:text-slate-500 focus:border-blue-400 focus:ring-2 focus:ring-blue-500/30 disabled:cursor-not-allowed disabled:opacity-60";
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
      <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-600">{label}</span>
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

export function CustomerAccountScreen({ locale = "th", languageControl, themeControl, embedded }: { locale?: "th" | "en"; languageControl?: ReactNode; themeControl?: ReactNode; embedded?: "profile" | "security" }) {
  const t = (th: string, en: string) => locale === "th" ? th : en;
  const pathname = typeof window !== "undefined" ? window.location.pathname : "/account";
  const queryToken = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("token") || "" : "";
  const [mode, setMode] = useState<CustomerScreenMode>(() => embedded ? "profile" : resolveCustomerMode(pathname));
  const [account, setAccount] = useState<CustomerAccount | null>(null);
  const [form, setForm] = useState<CustomerForm>(() => customerFormDefaults(queryToken));
  const [busy, setBusy] = useState(false);
  const [errorCopy, setErrorMessage] = useState<CustomerCopy>();
  const errorMessage = errorCopy ? t(...errorCopy) : "";
  const [noticeCopy, setNotice] = useState<CustomerCopy>();
  const notice = noticeCopy ? t(...noticeCopy) : "";
  const [verificationDeliveryFailed,setVerificationDeliveryFailed]=useState(false);
  const handledTokenRef = useRef("");

  const setField = (field: keyof CustomerForm, value: string | boolean) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const navigate = (nextMode: CustomerScreenMode) => {
    const nextPath = nextMode === "profile" ? "/account" : `/account/${nextMode === "reset" ? "reset-password" : nextMode === "verify" ? "verify-email" : nextMode === "forgot" ? "forgot-password" : nextMode}`;
    if (embedded && nextMode !== "profile") { window.location.assign(nextPath); return; }
    window.history.pushState({}, "", nextPath);
    setMode(nextMode);
    setErrorMessage(undefined);
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
        setErrorMessage(customerErrorCopy(error, ["ระบบบัญชีผู้เข้าร่วมยังไม่พร้อมใช้งาน", "Customer account is unavailable"]));
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [account, mode]);

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
        setNotice(["ยืนยันอีเมลแล้ว คุณเข้าสู่ระบบได้เลย", "Email verified. You can now sign in."]);
      })
      .catch((error: unknown) => setErrorMessage(customerErrorCopy(error, ["ยืนยันอีเมลไม่สำเร็จ", "Failed to verify email"])))
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
    setErrorMessage(undefined);
    setNotice(undefined);
    try {
      if (mode === "login") {
        const data = await customerApi<{ account: CustomerAccount }>("/api/customer/account/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: form.email, password: form.password }),
        });
        const reference = new URLSearchParams(window.location.search).get("paid_booking") || "";
        if (data.account.email_verified_at && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(reference)) {
          window.location.assign(`/app/orders?paid_booking=${encodeURIComponent(reference)}`);
          return;
        }
        if (data.account.has_staff_access) {
          window.location.assign("/");
          return;
        }
        setAccount(data.account);
        setField("password", "");
        setNotice(undefined);
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
        setVerificationDeliveryFailed(data.verification_delivery_queued === false);
        setField("password","");
        setNotice(undefined);
        navigate("check-email");
        return;
      }
      if (mode === "forgot") {
        await customerApi("/api/customer/account/forgot-password", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: form.email }),
        });
        setNotice(["หากอีเมลนี้มีบัญชีอยู่ ระบบจะส่งลิงก์ตั้งรหัสผ่านใหม่ให้", "If that email exists, a reset link has been sent."]);
        return;
      }
      if (mode === "reset") {
        await customerApi("/api/customer/account/reset-password", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: form.token, password: form.password }),
        });
        navigate("login");
        setNotice(["ตั้งรหัสผ่านใหม่แล้ว คุณเข้าสู่ระบบได้เลย", "Password reset. You can now sign in."]);
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
        setNotice(["บันทึกโปรไฟล์แล้ว", "Profile saved."]);
      }
    } catch (error: unknown) {
      setErrorMessage(customerErrorCopy(error, ["ทำรายการไม่สำเร็จ กรุณาตรวจข้อมูลแล้วลองอีกครั้ง", "Request failed"]));
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
      setErrorMessage(["กรอกอีเมลบัญชีของคุณก่อน", "Enter your account email first."]);
      return;
    }
    setBusy(true);
    setErrorMessage(undefined);
    setNotice(undefined);
    try {
      const data = await customerApi<{ verification_delivery_queued?: boolean }>("/api/customer/account/resend-verification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: form.email }),
      });
      setVerificationDeliveryFailed(data.verification_delivery_queued === false);
      setNotice(data.verification_delivery_queued === false
        ? ["ยังส่งอีเมลไม่ได้ กรุณาลองใหม่หรือติดต่อผู้จัดงาน", "Email delivery is unavailable. Try again or contact the organizer."]
        : ["ส่งคำขออีเมลยืนยันแล้ว กรุณาตรวจกล่องจดหมายเข้าและสแปม", "Check your inbox and spam folder for the verification email."]);
    } catch (error: unknown) {
      setErrorMessage(customerErrorCopy(error, ["ส่งอีเมลยืนยันซ้ำไม่สำเร็จ", "Failed to resend verification email"]));
    } finally {
      setBusy(false);
    }
  };

  const revokeSessions = async () => {
    setBusy(true);
    setErrorMessage(undefined);
    try {
      await customerApi("/api/customer/account/sessions/revoke", { method: "POST" });
      setAccount(null);
      navigate("login");
      setNotice(["ออกจากระบบทุกอุปกรณ์แล้ว", "All customer sessions were revoked."]);
    } catch (error: unknown) {
      setErrorMessage(customerErrorCopy(error, ["ออกจากระบบทุกอุปกรณ์ไม่สำเร็จ", "Failed to revoke sessions"]));
    } finally {
      setBusy(false);
    }
  };

  const disableAccount = async () => {
    if (!window.confirm(t("ปิดใช้งานบัญชีนี้และออกจากระบบทุกอุปกรณ์หรือไม่?", "Disable this customer account and sign out all sessions?"))) return;
    setBusy(true);
    setErrorMessage(undefined);
    try {
      await customerApi("/api/customer/account/disable", { method: "POST" });
      setAccount(null);
      navigate("login");
      setNotice(["ปิดใช้งานบัญชีผู้เข้าร่วมแล้ว", "Your customer account has been disabled."]);
    } catch (error: unknown) {
      setErrorMessage(customerErrorCopy(error, ["ปิดใช้งานบัญชีไม่สำเร็จ", "Failed to disable account"]));
    } finally {
      setBusy(false);
    }
  };

  // Only internal customer destinations may be used for the return link.
  const requestedReturn = new URLSearchParams(window.location.search).get("return_to");
  const returnTo = requestedReturn === "/app/security" ? requestedReturn : "/app/profile";
  const showBack = mode !== "profile" && mode !== "unavailable";
  const title = mode === "check-email" ? t("ตรวจสอบอีเมลของคุณ", "Check your email")
    : mode === "register" ? t("สร้างบัญชี", "Create your account")
    : mode === "forgot" ? t("รีเซ็ตรหัสผ่าน", "Reset your password")
      : mode === "reset" ? t("ตั้งรหัสผ่านใหม่", "Choose a new password")
        : mode === "verify" ? t("ยืนยันอีเมล", "Verify your email")
          : mode === "profile" ? t("บัญชีของคุณ", "Your account") : t("เข้าสู่ระบบ", "Welcome back");
  const subtitle = mode === "profile" ? t("จัดการข้อมูลบัญชีของคุณ", "Manage your customer details securely.")
    : t("บัญชีสำหรับลงทะเบียนและซื้อตั๋ว", "Ticketing access for attendees and buyers.");

  const accountContent = <>
          {busy && mode === "profile" && !account ? (
            <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-5 text-sm text-slate-700">
              <RefreshCw className="h-4 w-4 animate-spin text-blue-700" /> {t("กำลังโหลดบัญชี…", "Loading account…")}
            </div>
          ) : mode === "unavailable" ? (
            <div className="space-y-4 rounded-2xl border border-amber-400/20 bg-amber-400/10 p-5 text-sm text-amber-800">
              <p>{t("ระบบบัญชีผู้เข้าร่วมยังไม่พร้อมใช้งาน", "Customer accounts are not enabled in this environment yet.")}</p>
              {errorMessage && <p className="text-xs text-amber-800">{errorMessage}</p>}
            </div>
          ) : mode === "check-email" ? (
            <div className="space-y-4">
              {!form.email.trim() && <CustomerField label={t("อีเมลที่ใช้สมัคร", "Account email")}
                type="email" autoComplete="email" value={form.email}
                onChange={value=>setField("email",value)}/>}
              <CustomerVerificationNotice locale={locale} email={form.email} busy={busy}
                onResend={()=>void resendVerification()}
                status={notice} error={errorMessage} deliveryFailed={verificationDeliveryFailed}/>
              <button type="button" onClick={()=>navigate("login")}
                className="inline-flex min-h-11 items-center rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-blue-700">
                {t("ยืนยันอีเมลแล้ว? เข้าสู่ระบบ", "Already verified? Sign in")}
              </button>
            </div>
          ) : mode === "verify" ? (
            <div className="space-y-4 rounded-2xl border border-slate-200 bg-slate-50 p-5 text-sm text-slate-700">
              <CheckCircle2 className={`h-7 w-7 ${errorMessage ? "text-rose-700" : "text-blue-700"}`} />
              <p>{busy ? t("กำลังยืนยันอีเมล…", "Verifying your email…") : errorMessage || t("ลิงก์ยืนยันพร้อมใช้งาน", "This verification link is ready.")}</p>
              {!busy && <button type="button" onClick={() => navigate("login")} className="rounded-xl bg-blue-600 px-4 py-2.5 font-semibold text-white hover:bg-blue-500">{t("ไปหน้าเข้าสู่ระบบ", "Continue to sign in")}</button>}
            </div>
          ) : mode === "profile" && account ? (
            <div className="space-y-5">
            {!account.email_verified_at && <CustomerVerificationNotice locale={locale} email={account.email}
              busy={busy} onResend={()=>void resendVerification()}
              status={notice} error={errorMessage}
              deliveryFailed={verificationDeliveryFailed}/>}
            <form className="space-y-6" onSubmit={(event) => void submit(event)}>
              <div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-500/15 text-blue-700"><UserRound className="h-5 w-5" /></div>
                  <div><p className="font-semibold text-slate-900">{account.first_name} {account.last_name}</p><p className="text-xs text-slate-600">{account.email}</p></div>
                </div>
                <span className="rounded-full bg-emerald-400/10 px-3 py-1 text-xs font-semibold text-emerald-700">{account.status}</span>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <CustomerField label={t("ชื่อ", "First name")} value={form.first_name} onChange={(value) => setField("first_name", value)} autoComplete="given-name" />
                <CustomerField label={t("นามสกุล", "Last name")} value={form.last_name} onChange={(value) => setField("last_name", value)} autoComplete="family-name" />
                <CustomerField label={t("เบอร์โทรศัพท์", "Phone")} value={form.phone} onChange={(value) => setField("phone", value)} autoComplete="tel" />
                <CustomerField label={t("อีเมล", "Email")} value={form.email} onChange={() => undefined} type="email" autoComplete="email" disabled />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <CustomerField label={t("ที่อยู่บรรทัดที่ 1", "Address line 1")} value={form.address_line1} onChange={(value) => setField("address_line1", value)} autoComplete="address-line1" />
                <CustomerField label={t("ที่อยู่บรรทัดที่ 2", "Address line 2")} value={form.address_line2} onChange={(value) => setField("address_line2", value)} autoComplete="address-line2" />
                <CustomerField label={t("เขต / อำเภอ", "District")} value={form.district} onChange={(value) => setField("district", value)} />
                <CustomerField label={t("แขวง / ตำบล", "Subdistrict")} value={form.subdistrict} onChange={(value) => setField("subdistrict", value)} />
                <CustomerField label={t("จังหวัด", "Province")} value={form.province} onChange={(value) => setField("province", value)} autoComplete="address-level1" />
                <CustomerField label={t("รหัสไปรษณีย์", "Postal code")} value={form.postal_code} onChange={(value) => setField("postal_code", value)} autoComplete="postal-code" />
              </div>
              <div className="flex flex-wrap gap-3">
                <button disabled={busy} className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 font-semibold text-white hover:bg-blue-500 disabled:opacity-50"><Save className="h-4 w-4" /> {t("บันทึกโปรไฟล์", "Save profile")}</button>
                {!embedded && <a href="/app/security" className="inline-flex items-center text-blue-700 underline">{t("ความปลอดภัยของบัญชี", "Account security")}</a>}
              </div>
            </form>
            </div>
          ) : (
            <form className="space-y-5" onSubmit={(event) => void submit(event)}>
              {(mode === "register" || mode === "profile") && <div className="grid gap-4 sm:grid-cols-2"><CustomerField label={t("ชื่อ", "First name")} value={form.first_name} onChange={(value) => setField("first_name", value)} autoComplete="given-name" /><CustomerField label={t("นามสกุล", "Last name")} value={form.last_name} onChange={(value) => setField("last_name", value)} autoComplete="family-name" /></div>}
              {mode !== "reset" && <CustomerField label={t("อีเมล", "Email")} value={form.email} onChange={(value) => setField("email", value)} type="email" autoComplete="email" />}
              {(mode === "register" || mode === "login") && <CustomerField label={t("รหัสผ่าน", "Password")} value={form.password} onChange={(value) => setField("password", value)} type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} />}
              {mode === "register" && <CustomerField label={t("เบอร์โทรศัพท์", "Phone")} value={form.phone} onChange={(value) => setField("phone", value)} autoComplete="tel" />}
              {(mode === "reset") && <CustomerField label={t("รหัสผ่านใหม่", "New password")} value={form.password} onChange={(value) => setField("password", value)} type="password" autoComplete="new-password" />}
              {mode === "register" && <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700"><label className="flex gap-3"><input type="checkbox" checked={form.accept_terms} onChange={(event) => setField("accept_terms", event.target.checked)} className="mt-1 accent-blue-500" /> {t("ฉันยอมรับข้อกำหนดการใช้บริการ", "I accept the terms of service.")}</label><label className="flex gap-3"><input type="checkbox" checked={form.accept_privacy} onChange={(event) => setField("accept_privacy", event.target.checked)} className="mt-1 accent-blue-500" /> {t("ฉันยอมรับประกาศความเป็นส่วนตัว", "I accept the privacy notice.")}</label></div>}
              {mode === "login" && <div className="mb-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
                {t("กรุณายืนยันอีเมลก่อนจองที่นั่ง", "Verify your email before booking a spot.")}
              </div>}
              {errorMessage && <p className="text-sm text-rose-700">{errorMessage}</p>}
              {notice && <p className="flex items-start gap-2 text-sm text-emerald-700"><Mail className="mt-0.5 h-4 w-4 shrink-0" /> {notice}</p>}
              <button disabled={busy} className="flex w-full items-center justify-center gap-2 rounded-2xl bg-blue-600 px-4 py-3 font-semibold text-white transition-colors hover:bg-blue-500 disabled:opacity-50">{busy && <RefreshCw className="h-4 w-4 animate-spin" />}{mode === "register" ? t("สร้างบัญชี", "Create account") : mode === "forgot" ? t("ส่งลิงก์รีเซ็ต", "Send reset link") : mode === "reset" ? t("รีเซ็ตรหัสผ่าน", "Reset password") : t("เข้าสู่ระบบ", "Sign in")}</button>
              <div className="flex flex-wrap justify-between gap-3 text-sm text-slate-600">
                {mode === "login" && <><button type="button" onClick={() => navigate("register")} className="hover:underline">{t("สร้างบัญชี", "Create account")}</button><button type="button" onClick={() => void resendVerification()} disabled={busy} className="hover:underline disabled:opacity-50">{t("ส่งอีเมลยืนยันอีกครั้ง", "Resend verification")}</button><button type="button" onClick={() => navigate("forgot")} className="hover:underline">{t("ลืมรหัสผ่าน?", "Forgot password?")}</button></>}
                {mode === "register" && <button type="button" onClick={() => navigate("login")} className="hover:underline">{t("มีบัญชีแล้ว? เข้าสู่ระบบ", "Already have an account? Sign in")}</button>}
                {(mode === "forgot" || mode === "reset") && <button type="button" onClick={() => navigate("login")} className="hover:underline">{t("กลับไปเข้าสู่ระบบ", "Back to sign in")}</button>}
              </div>
            </form>
          )}

          {errorMessage && mode === "profile" && <p className="mt-5 text-sm text-rose-700">{errorMessage}</p>}
          {notice && mode === "profile" && <p className="mt-5 text-sm text-emerald-700">{notice}</p>}
  </>;
  if (embedded === "profile") return <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-6">{accountContent}</section>;

  if (embedded === "security") return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-6">
      <h2 className="mb-3 font-semibold text-slate-900">{t("ความปลอดภัยในการเข้าสู่ระบบ", "Session security")}</h2>
      <div className="flex flex-wrap gap-2">
                <button type="button" disabled={busy} onClick={() => void logout()} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-4 py-2.5 font-semibold text-slate-700 hover:border-slate-300 hover:underline disabled:opacity-50"><LogOut className="h-4 w-4" /> {t("ออกจากระบบ", "Sign out")}</button>
                <button type="button" disabled={busy} onClick={() => void revokeSessions()} className="rounded-xl px-3 py-2.5 text-sm text-rose-700 hover:bg-rose-400/10 disabled:opacity-50">{t("ออกจากระบบทุกอุปกรณ์", "Revoke all sessions")}</button>
                <button type="button" disabled={busy} onClick={() => void disableAccount()} className="rounded-xl px-3 py-2.5 text-sm text-rose-700 hover:bg-rose-400/10 disabled:opacity-50">{t("ปิดใช้งานบัญชี", "Disable account")}</button>
      </div>
      {errorMessage && <p role="alert" className="mt-3 text-rose-700">{errorMessage}</p>}
    </section>
  );

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-10 text-slate-900 selection:bg-blue-500/30">
      <div className="mx-auto w-full max-w-2xl">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-blue-600 text-white shadow-lg shadow-blue-950/40">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm font-bold tracking-wide text-slate-900">{t("บัญชี Meetrix", "Meetrix Account")}</p>
              <p className="text-xs text-slate-500">{t("สำหรับผู้เข้าร่วม", "Customer access")}</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">{languageControl}{themeControl}</div>
          {showBack && (
            <button type="button" onClick={() => navigate("login")} className="inline-flex items-center gap-2 text-sm text-slate-600 hover:underline">
              <ArrowLeft className="h-4 w-4" /> {t("กลับไปเข้าสู่ระบบ", "Back to sign in")}
            </button>
          )}
        </div>

        <nav aria-label={t("เมนูบัญชี", "Account navigation")} className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm font-semibold">
          <a href="/events" className="inline-flex min-h-10 items-center gap-1 text-blue-700 hover:underline"><CalendarDays className="h-4 w-4" /> {t("งานทั้งหมด", "All events")}</a>
          <a href={returnTo} className="inline-flex min-h-10 items-center gap-1 text-blue-700 hover:underline"><ArrowLeft className="h-4 w-4" /> {t("กลับบัญชีของฉัน", "Back to my account")}</a>
          <a href="/staff/login" className="inline-flex min-h-10 items-center gap-1 text-blue-700 hover:underline">
            <ShieldCheck className="h-4 w-4" /> {t("เข้าสู่ระบบทีมงาน", "Staff sign-in")}
          </a>
          <a href="/app/orders" className="inline-flex min-h-10 items-center gap-1 text-blue-700 hover:underline"><ShoppingBag className="h-4 w-4" /> {t("การจองของฉัน", "My bookings")}</a>
        </nav>
        <div className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-2xl shadow-slate-900/10 sm:p-9">
          <div className="mb-7">
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-blue-700">{t("บัญชีผู้เข้าร่วม", "Customer account")}</p>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">{title}</h1>
            <p className="mt-2 text-sm leading-6 text-slate-600">{subtitle}</p>
          </div>

          {accountContent}
        </div>
        <p className="mt-6 flex items-center justify-center gap-2 text-center text-xs text-slate-600"><LockKeyhole className="h-3.5 w-3.5" /> {t("ข้อมูลเข้าสู่ระบบของผู้เข้าร่วมแยกจากบัญชีผู้จัดงาน", "Customer credentials are stored separately from organizer accounts.")}</p>
      </div>
    </div>
  );
}

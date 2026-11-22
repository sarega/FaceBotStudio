import { useState, type FormEvent } from "react";
import type { AppLanguage } from "../../../lib/i18n";
import { ActionButton } from "../../../components/shared/AppUi";

type ApiFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export function StaffEmailScreen({ apiFetch, language }: { apiFetch: ApiFetch; language: AppLanguage }) {
  const t = (th: string, en: string) => language === "th" ? th : en;
  const [link] = useState(() => new URLSearchParams(window.location.hash.slice(1)));
  const token = link.get("token");
  const purpose = link.get("purpose");
  const invite = purpose === "invite";
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [message, setMessage] = useState("");
  const errorText: Record<string, string> = {
    "Use the password for your existing attendee account.": t("กรุณาใช้รหัสผ่านเดิมของบัญชีผู้เข้าร่วมอีเมลนี้", "Use the password for your existing attendee account."),
    "Your attendee account is disabled. Contact the organizer.": t("บัญชีผู้เข้าร่วมถูกปิดใช้งาน กรุณาติดต่อผู้จัดงาน", "Your attendee account is disabled. Contact the organizer."),
    "Verify your attendee email before activating staff access.": t("กรุณายืนยันอีเมลในบัญชีผู้เข้าร่วม แล้วเปิดลิงก์คำเชิญนี้อีกครั้ง", "Verify your attendee email, then reopen this invitation."),
    "Use at least 12 characters for a new staff password.": t("รหัสผ่านสำหรับบัญชีทีมงานใหม่ต้องมีอย่างน้อย 12 ตัวอักษร", "Use at least 12 characters for a new staff password."),
    "This link is invalid, expired, or belongs to another account.": t("ลิงก์ใช้ไม่ได้ หมดอายุ หรือเป็นของบัญชีอื่น", "This link is invalid, expired, or belongs to another account."),
  };

  async function confirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const password = invite ? new FormData(event.currentTarget).get("password") : undefined;
    setBusy(true);
    setMessage("");
    try {
      const response = await apiFetch("/api/auth/staff-email/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: invite ? "omit" : "same-origin",
        body: JSON.stringify({ token, purpose, password }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Failed to verify staff email");
      window.history.replaceState(null, "", window.location.pathname);
      setDone(true);
    } catch (error) {
      const detail = error instanceof Error ? error.message : "";
      setMessage(errorText[detail] || detail || t("เปิดใช้สิทธิ์ทีมงานไม่สำเร็จ", "Could not activate staff access."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-100 px-4 py-16 text-slate-900">
      <section className="mx-auto max-w-md space-y-5 rounded-2xl bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-semibold">{done ? t("เปิดใช้งานเรียบร้อย", "Activation complete") : invite
          ? t("เปิดใช้สิทธิ์ทีมงาน Meetrix", "Activate Meetrix staff access")
          : t("ยืนยันอีเมลทีมงาน", "Verify your staff email")}</h1>
        {done ? (
          <p>{invite ? t("เข้าสู่ระบบด้วยอีเมลที่ได้รับคำเชิญ แล้วใช้รหัสผ่านเดียวกับที่ใช้เปิดสิทธิ์",
            "Sign in with the invited email and the password you used to activate access.")
            : t("ใช้ชื่อผู้ใช้หรืออีเมลนี้ในการเข้าสู่ระบบทีมงานได้แล้ว", "You can now sign in with your username or this email.")}</p>
        ) : token && (invite || purpose === "verify") ? (
          <form onSubmit={confirm} className="space-y-4">
            {invite && <>
              <p className="text-sm text-slate-600">
                {t("มีบัญชีผู้เข้าร่วมแล้ว ให้ใช้รหัสผ่านเดิมของอีเมลนี้ ถ้ายังไม่มี ให้ตั้งรหัสผ่านทีมงานอย่างน้อย 12 ตัวอักษร",
                  "Use your existing password if you already have an attendee account with this email. Otherwise, choose a staff password of at least 12 characters.")}
              </p>
              <label className="block space-y-2">
                <span>{t("รหัสผ่าน", "Password")}</span>
                <input className="w-full rounded-lg border p-3" name="password" type="password" required maxLength={512} autoComplete="current-password" />
              </label>
              <a href="/account/forgot-password" target="_blank" rel="noopener" className="inline-block text-sm font-semibold text-blue-700 underline">
                {t("ลืมรหัสผ่านบัญชีผู้เข้าร่วม", "Reset attendee password")}
              </a>
            </>}
            <ActionButton type="submit" tone="blue" disabled={busy}>{invite ? t("เปิดใช้สิทธิ์ทีมงาน", "Activate staff access") : t("ยืนยันอีเมล", "Verify email")}</ActionButton>
          </form>
        ) : <p>{t("กรุณาเปิดลิงก์ล่าสุดจากอีเมลทีมงาน", "Open the latest link from your staff email.")}</p>}
        {message && <p role="alert" className="text-rose-700">{message}</p>}
        <a href="/staff/login" className="inline-block font-semibold text-blue-700">{t("ไปหน้าเข้าสู่ระบบทีมงาน", "Go to staff sign-in")}</a>
      </section>
    </main>
  );
}

export function StaffEmailSettings({ email, apiFetch }: { email?: string | null; apiFetch: ApiFetch }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function request(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    setBusy(true);
    setMessage("");
    try {
      const response = await apiFetch("/api/auth/staff-email/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: values.get("email"), password: values.get("password") }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Failed to send verification email");
      form.reset();
      setMessage("Verification link sent. Keep this staff account signed in when you open it.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to send verification email");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-5 space-y-3 border-t border-slate-200 pt-4">
      <h3 className="font-semibold">Staff email</h3>
      {email ? <p className="break-all text-sm">{email} · Verified</p> : (
        <form onSubmit={request} className="space-y-3">
          <label className="block text-sm">Email
            <input className="mt-1 w-full rounded-lg border p-2" name="email" type="email" autoComplete="email" required maxLength={254} />
          </label>
          <label className="block text-sm">Current password
            <input className="mt-1 w-full rounded-lg border p-2" name="password" type="password" autoComplete="current-password" required maxLength={512} />
          </label>
          <ActionButton type="submit" tone="blue" disabled={busy}>Send verification link</ActionButton>
        </form>
      )}
      {message && <p role="status" className="text-sm">{message}</p>}
    </section>
  );
}

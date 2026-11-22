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
  const [inviteMode, setInviteMode] = useState<"new_password" | "link_attendee">("new_password");
  const newPassword = inviteMode === "new_password";
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [message, setMessage] = useState("");
  const errorText: Record<string, string> = {
    "No attendee account is available to link. Set a new staff password.": t("ยังไม่มีบัญชีผู้เข้าร่วมสำหรับเชื่อม กรุณาตั้งรหัสผ่านทีมงานใหม่", "No attendee account is available to link. Set a new staff password."),
    "Use the password for your existing attendee account.": t("กรุณาใช้รหัสผ่านเดิมของบัญชีผู้เข้าร่วมอีเมลนี้", "Use the password for your existing attendee account."),
    "Your attendee account is disabled. Contact the organizer.": t("บัญชีผู้เข้าร่วมถูกปิดใช้งาน กรุณาติดต่อผู้จัดงาน", "Your attendee account is disabled. Contact the organizer."),
    "Verify your attendee email before activating staff access.": t("กรุณายืนยันอีเมลในบัญชีผู้เข้าร่วม แล้วเปิดลิงก์คำเชิญนี้อีกครั้ง", "Verify your attendee email, then reopen this invitation."),
    "Use at least 12 characters for a new staff password.": t("รหัสผ่านสำหรับบัญชีทีมงานใหม่ต้องมีอย่างน้อย 12 ตัวอักษร", "Use at least 12 characters for a new staff password."),
    "This link is invalid, expired, or belongs to another account.": t("ลิงก์ใช้ไม่ได้ หมดอายุ หรือเป็นของบัญชีอื่น", "This link is invalid, expired, or belongs to another account."),
  };

  async function confirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const values = new FormData(event.currentTarget);
    const password = invite ? values.get("password") : undefined;
    if (invite && newPassword && password !== values.get("confirm_password")) {
      setMessage(t("รหัสผ่านทั้งสองช่องไม่ตรงกัน", "The passwords do not match."));
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const response = await apiFetch("/api/auth/staff-email/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: invite ? "omit" : "same-origin",
        body: JSON.stringify({ token, purpose, password, invite_mode: invite ? inviteMode : undefined }),
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
          <form key={inviteMode} onSubmit={confirm} className="space-y-4">
            {invite && <>
              <p className="text-sm text-slate-600">
                {newPassword
                  ? t("ตั้งรหัสผ่านทีมงานอย่างน้อย 12 ตัวอักษร รหัสผ่านบัญชีผู้เข้าร่วมจะยังใช้ได้ตามเดิม",
                    "Choose a staff password of at least 12 characters. Your attendee password will stay the same.")
                  : t("ใช้รหัสผ่านปัจจุบันของบัญชีผู้เข้าร่วมที่ยืนยันอีเมลเดียวกับคำเชิญ",
                    "Use the current password for the verified attendee account with this invitation’s email.")}
              </p>
              <label className="block space-y-2">
                <span>{newPassword ? t("รหัสผ่านทีมงานใหม่", "New staff password") : t("รหัสผ่านบัญชีผู้เข้าร่วม", "Attendee password")}</span>
                <input className="w-full rounded-lg border p-3" name="password" type="password" required minLength={newPassword ? 12 : undefined}
                  maxLength={512} autoComplete={newPassword ? "new-password" : "current-password"} />
              </label>
              {newPassword && <label className="block space-y-2">
                <span>{t("ยืนยันรหัสผ่านใหม่", "Confirm new password")}</span>
                <input className="w-full rounded-lg border p-3" name="confirm_password" type="password" required maxLength={512} autoComplete="new-password" />
              </label>}
              <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm font-semibold text-blue-700">
                <button type="button" disabled={busy} className="underline underline-offset-2" onClick={() => {
                  setInviteMode(newPassword ? "link_attendee" : "new_password");
                  setMessage("");
                }}>
                  {newPassword ? t("ใช้รหัสผ่านบัญชีผู้เข้าร่วมแทน", "Use my attendee password instead") : t("ตั้งรหัสผ่านทีมงานใหม่แทน", "Set a new staff password instead")}
                </button>
                {!newPassword && <a href="/account/forgot-password" target="_blank" rel="noopener" className="underline underline-offset-2">
                  {t("ลืมรหัสผ่านบัญชีผู้เข้าร่วม", "Reset attendee password")}
                </a>}
              </div>
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

export function StaffEmailSettings({ email, apiFetch, language }: { email?: string | null; apiFetch: ApiFetch; language: AppLanguage }) {
  const t = (th: string, en: string) => language === "th" ? th : en;
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<"sent" | "password" | "error" | null>(null);

  async function request(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget;
    const values = new FormData(form);
    setBusy(true);
    setMessage(null);
    try {
      const response = await apiFetch("/api/auth/staff-email/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: values.get("email"), password: values.get("password") }),
      });
      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        setMessage(result.error === "Incorrect password" ? "password" : "error");
        return;
      }
      form.reset();
      setMessage("sent");
    } catch {
      setMessage("error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-5 space-y-3 border-t border-slate-200 pt-4">
      <h3 className="font-semibold">{t("อีเมลทีมงาน", "Staff email")}</h3>
      {email ? <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        <span className="break-all">{email}</span>
        <span className="font-medium text-emerald-600">{t("ยืนยันแล้ว", "Verified")}</span>
      </div> : (
        <form onSubmit={request} className="space-y-3">
          <p className="text-sm text-slate-500">{t("ยืนยันอีเมลเพื่อใช้เข้าสู่ระบบและขอลิงก์ตั้งรหัสผ่านใหม่", "Verify your email to sign in with it and reset your password.")}</p>
          <label className="block text-sm">{t("อีเมล", "Email")}
            <input className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2" name="email" type="email" autoComplete="email" required maxLength={254} />
          </label>
          <label className="block text-sm">{t("รหัสผ่านปัจจุบัน", "Current password")}
            <input className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2" name="password" type="password" autoComplete="current-password" required maxLength={512} />
          </label>
          <ActionButton type="submit" tone="blue" disabled={busy}>
            {busy ? t("กำลังส่ง…", "Sending…") : t("ส่งลิงก์ยืนยัน", "Send verification link")}
          </ActionButton>
        </form>
      )}
      {message && <p role={message === "sent" ? "status" : "alert"}
        className={`text-sm ${message === "sent" ? "text-emerald-600" : "text-rose-600"}`}>
        {message === "sent" ? t("ส่งลิงก์แล้ว กรุณาเปิดจากอีเมลขณะที่ยังเข้าสู่ระบบด้วยบัญชีนี้", "Verification link sent. Open it while signed in to this account.")
          : message === "password" ? t("รหัสผ่านปัจจุบันไม่ถูกต้อง", "Incorrect current password.")
            : t("ส่งลิงก์ยืนยันไม่ได้ กรุณาลองอีกครั้ง", "Could not send the verification link. Please try again.")}
      </p>}
    </section>
  );
}

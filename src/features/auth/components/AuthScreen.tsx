import { RefreshCw, Shield } from "lucide-react";
import type { AppLanguage } from "../../../lib/i18n";

type AuthScreenProps = {
  language: AppLanguage;
  errorMessage: string;
  username: string;
  password: string;
  submitting: boolean;
  onUsernameChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onSubmit: () => void | Promise<void>;
};

export function AuthScreen({
  language,
  errorMessage,
  username,
  password,
  submitting,
  onUsernameChange,
  onPasswordChange,
  onSubmit,
}: AuthScreenProps) {
  const t = (th: string, en: string) => language === "th" ? th : en;
  const inputClass = "w-full rounded-xl border border-white/15 bg-slate-900 px-4 py-3 outline-none focus:ring-2 focus:ring-blue-500";
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 px-4 text-white">
      <section className="w-full max-w-md rounded-3xl border border-white/10 bg-white/5 p-6 shadow-2xl sm:p-8">
        <div className="mb-5 flex items-center gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-blue-600">
            <Shield className="h-5 w-5" aria-hidden="true" />
          </span>
          <h1 className="text-xl font-bold">{t("เข้าสู่ระบบทีมงาน Meetrix", "Meetrix staff sign-in")}</h1>
        </div>
        <p className="mb-4 text-sm text-slate-300">
          {t("ใช้รหัสผ่านที่ตั้งตอนเปิดใช้สิทธิ์ทีมงาน หากเลือกเชื่อมบัญชีผู้เข้าร่วม ให้ใช้รหัสผ่านของบัญชีนั้น",
            "Use the password you set when activating staff access. If you linked your attendee account, use that account’s password.")}
        </p>
        <form className="space-y-4" onSubmit={(event) => {
          event.preventDefault();
          if (!submitting && username.trim() && password) void onSubmit();
        }}>
          <label className="block space-y-1.5 text-sm font-semibold">
            <span>{t("อีเมลหรือชื่อผู้ใช้ทีมงาน", "Staff email or username")}</span>
            <input value={username} onChange={(event) => onUsernameChange(event.target.value)}
              className={inputClass} autoComplete="username" autoCapitalize="none" spellCheck={false} maxLength={254} required />
          </label>
          <label className="block space-y-1.5 text-sm font-semibold">
            <span>{t("รหัสผ่าน", "Password")}</span>
            <input type="password" value={password} onChange={(event) => onPasswordChange(event.target.value)}
              className={inputClass} autoComplete="current-password" maxLength={512} required />
          </label>
          {errorMessage && <p role="alert" className="text-sm text-rose-300">
            {errorMessage === "Invalid staff credentials" || errorMessage === "Invalid username or password"
              ? t("อีเมล ชื่อผู้ใช้ หรือรหัสผ่านไม่ถูกต้อง หากเพิ่งได้รับเชิญ ให้เปิดใช้สิทธิ์จากอีเมลก่อน",
                "The email, username, or password was not accepted. Activate your invitation before signing in.")
              : errorMessage}
          </p>}
          <button type="submit" disabled={!username.trim() || !password || submitting}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-3 font-semibold hover:bg-blue-700 disabled:opacity-50">
            {submitting && <RefreshCw className="h-4 w-4 animate-spin" aria-hidden="true" />}
            {t("เข้าสู่ระบบทีมงาน", "Sign in as staff")}
          </button>
        </form>
        <div className="mt-5 flex flex-wrap gap-x-4 gap-y-2 border-t border-white/15 pt-4 text-sm text-blue-200">
          <a href="/account/login" className="underline underline-offset-2">{t("เข้าบัญชีผู้เข้าร่วม", "Attendee sign-in")}</a>
          <a href="/account/forgot-password?staff=1" className="underline underline-offset-2">{t("ลืมรหัสผ่านทีมงาน", "Forgot staff password?")}</a>
        </div>
      </section>
    </main>
  );
}

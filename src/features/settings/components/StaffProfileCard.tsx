import { useState, type FormEvent } from "react";
import { KeyRound, Save, UserRound } from "lucide-react";
import { ActionButton } from "../../../components/shared/AppUi";
import { WorkspaceSwitchLink } from "../../../components/shared/WorkspaceSwitchLink";
import type { AppLanguage } from "../../../lib/i18n";
import type { AuthUser } from "../../../types";
import { StaffEmailSettings } from "../../auth/components/StaffEmailScreen";

type Props = {
  user: AuthUser;
  language: AppLanguage;
  timezone: string;
  apiFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  onSaved: (user: AuthUser) => void;
};

const roleNames: Record<AuthUser["role"], [string, string]> = {
  owner: ["เจ้าของ", "Owner"],
  admin: ["แอดมิน", "Admin"],
  operator: ["เจ้าหน้าที่ปฏิบัติการ", "Operator"],
  cashier: ["เจ้าหน้าที่ขายตั๋ว", "Cashier"],
  checker: ["เจ้าหน้าที่เช็กอิน", "Checker"],
  viewer: ["ผู้ดูข้อมูล", "Viewer"],
  logistics: ["ผู้จัดห้องและรถ", "Room & Transport Coordinator"],
};

export function StaffProfileCard({ user, language, timezone, apiFetch, onSaved }: Props) {
  const t = (th: string, en: string) => language === "th" ? th : en;
  const [name, setName] = useState(user.display_name);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<"saved" | "error" | null>(null);
  const trimmedName = name.trim();
  const lastLogin = user.last_login_at
    ? new Date(user.last_login_at).toLocaleString(language === "th" ? "th-TH" : "en-US", { timeZone: timezone, dateStyle: "medium", timeStyle: "short" })
    : "—";

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || !trimmedName || trimmedName === user.display_name) return;
    setSaving(true);
    setResult(null);
    try {
      const response = await apiFetch("/api/auth/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ display_name: trimmedName }),
      });
      if (!response.ok) throw new Error("Could not update profile");
      const data: { user: AuthUser } = await response.json();
      setName(data.user.display_name);
      onSaved(data.user);
      setResult("saved");
    } catch {
      setResult("error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="surface-panel rounded-2xl p-4 sm:p-5">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-500/15 text-blue-600">
          <UserRound className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h2 className="text-lg font-semibold">{t("โปรไฟล์ของฉัน", "My profile")}</h2>
          <p className="break-words text-sm text-slate-500">{t(...roleNames[user.role])} · {user.organization_name}</p>
        </div>
      </div>
      <form className="mt-4" onSubmit={save}>
        <label className="block text-sm font-medium" htmlFor="staff-display-name">{t("ชื่อที่แสดง", "Display name")}</label>
        <div className="mt-1.5 flex flex-wrap gap-2">
          <input id="staff-display-name" autoComplete="name" required maxLength={120} value={name}
            className="min-w-0 flex-1 basis-40 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
            disabled={saving} onChange={(event) => { setName(event.target.value); setResult(null); }} />
          <ActionButton type="submit" tone="blue" disabled={saving || !trimmedName || trimmedName === user.display_name}>
            <Save className="h-4 w-4" aria-hidden="true" />{saving ? t("กำลังบันทึก…", "Saving…") : t("บันทึกชื่อ", "Save name")}
          </ActionButton>
        </div>
        {result && <p role={result === "error" ? "alert" : "status"} className={`mt-2 text-sm ${result === "error" ? "text-rose-600" : "text-emerald-600"}`}>
          {result === "saved" ? t("บันทึกชื่อเรียบร้อยแล้ว", "Display name saved.") : t("บันทึกชื่อไม่สำเร็จ กรุณาลองอีกครั้ง", "Could not save your display name. Please try again.")}
        </p>}
      </form>
      <dl className="mt-4 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
        <dt className="text-slate-500">{t("ชื่อผู้ใช้", "Username")}</dt>
        <dd className="break-all font-medium">{user.username}</dd>
        <dt className="text-slate-500">{t("เข้าสู่ระบบล่าสุด", "Last sign-in")}</dt>
        <dd>{lastLogin}</dd>
      </dl>
      <StaffEmailSettings email={user.staff_email} apiFetch={apiFetch} language={language} />
      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-3">
        {user.staff_email && <a href="/account/forgot-password?staff=1" className="inline-flex items-center gap-2 text-sm font-semibold text-blue-600 underline underline-offset-2">
          <KeyRound className="h-4 w-4" aria-hidden="true" />{t("ตั้งรหัสผ่านใหม่", "Reset password")}
        </a>}
        <WorkspaceSwitchLink language={language} destination="attendee" />
      </div>
    </section>
  );
}

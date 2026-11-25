import { Eye } from "lucide-react";
import type { AppLanguage } from "../../lib/i18n";
import { STAFF_PREVIEW_ROLES, type PreviewRole } from "../../lib/rolePreview";

const labels: Record<PreviewRole | "owner", [string, string]> = {
  owner: ["เจ้าของ", "Owner"],
  admin: ["แอดมิน", "Admin"],
  operator: ["ฝ่ายปฏิบัติการ", "Operator"],
  cashier: ["แคชเชียร์", "Cashier"],
  checker: ["ผู้เช็กอิน", "Checker"],
  viewer: ["ผู้ดูข้อมูล", "Viewer"],
  logistics: ["ผู้จัดห้องและรถ", "Room & Transport Coordinator"],
  user: ["ผู้เข้าร่วม", "User"],
};

export function RolePreviewControl({ language, role, onChange }: {
  language: AppLanguage;
  role: PreviewRole | null;
  onChange: (role: PreviewRole | null) => void;
}) {
  const th = language === "th";
  const caption = role ? (th ? "ดูอย่างเดียว" : "Read-only") : (th ? "ดูในบทบาท" : "View as");
  return <label className={`inline-flex items-center gap-1.5 rounded-xl border px-2 py-1.5 text-xs font-semibold ${role ? "border-amber-300 bg-amber-50 text-amber-900" : "border-slate-200 bg-white text-slate-700"}`}>
    <Eye className="h-4 w-4 shrink-0" aria-hidden="true" />
    <span className="hidden sm:inline">{caption}</span>
    <select aria-label={th ? "สลับมุมมองบทบาท" : "View as role"} title={caption}
      className="max-w-28 rounded bg-transparent outline-offset-2"
      value={role ?? "owner"} onChange={event => {
        const value = event.target.value as PreviewRole | "owner";
        onChange(value === "owner" ? null : value);
      }}>
      {(["owner", ...STAFF_PREVIEW_ROLES, "user"] as const).map(value =>
        <option key={value} value={value}>{th ? `${labels[value][0]} (${labels[value][1]})` : labels[value][1]}</option>
      )}
    </select>
  </label>;
}

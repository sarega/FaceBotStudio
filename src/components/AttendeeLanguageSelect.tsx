import type { AppLanguage } from "../lib/i18n";

export function AttendeeLanguageSelect({ locale, onChange }: {
  locale: AppLanguage;
  onChange: (locale: AppLanguage) => void;
}) {
  return (
    <select aria-label="ภาษา / Language" value={locale}
      className="min-h-11 shrink-0 rounded-lg border border-slate-200 bg-white px-2 text-sm font-semibold text-slate-900"
      onChange={(event) => onChange(event.target.value === "en" ? "en" : "th")}>
      <option value="th">ไทย</option>
      <option value="en">English</option>
    </select>
  );
}

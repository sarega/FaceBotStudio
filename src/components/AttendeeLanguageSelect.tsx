import { Globe2 } from "lucide-react";
import type { AppLanguage } from "../lib/i18n";

export function AttendeeLanguageSelect({ locale, onChange }: {
  locale: AppLanguage;
  onChange: (locale: AppLanguage) => void;
}) {
  const label = locale === "th" ? "ภาษา" : "Language";
  return (
    <span title={label} className="relative inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-700 focus-within:ring-2 focus-within:ring-blue-500">
      <Globe2 className="h-4 w-4" aria-hidden="true" />
      <select aria-label={label} value={locale}
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        onChange={(event) => onChange(event.target.value === "en" ? "en" : "th")}>
        <option value="th">ไทย</option>
        <option value="en">English</option>
      </select>
    </span>
  );
}

import { Sun, Moon, Monitor } from "lucide-react";
export type ThemeMode = "light" | "dark" | "system";

export function AttendeeThemeSelect({ mode, onChange, locale = "en" }: {
  mode: ThemeMode;
  locale?: "th" | "en";
  onChange: (mode: ThemeMode) => void;
}) {
  const Icon = mode === "light" ? Sun : mode === "dark" ? Moon : Monitor;
  return (
    <span title="ธีมการแสดงผล / Appearance" className="relative inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-700 focus-within:ring-2 focus-within:ring-blue-500">
      <Icon className="h-4 w-4" aria-hidden="true" />
      <select
        aria-label="ธีมการแสดงผล / Appearance"
        value={mode}
        onChange={(event) => onChange(event.target.value as ThemeMode)}
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
      >
        <option value="system">{locale === "th" ? "ธีมระบบ" : "System theme"}</option>
        <option value="light">{locale === "th" ? "ธีมสว่าง" : "Light theme"}</option>
        <option value="dark">{locale === "th" ? "ธีมมืด" : "Dark theme"}</option>
      </select>
    </span>
  );
}

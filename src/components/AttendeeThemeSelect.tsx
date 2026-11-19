export type ThemeMode = "light" | "dark" | "system";

export function AttendeeThemeSelect({ mode, onChange, locale = "en" }: {
  mode: ThemeMode;
  locale?: "th" | "en";
  onChange: (mode: ThemeMode) => void;
}) {
  return (
    <select
      aria-label="ธีมการแสดงผล / Appearance"
      value={mode}
      onChange={(event) => onChange(event.target.value as ThemeMode)}
      className="min-h-10 shrink-0 rounded-lg border border-slate-200 bg-white px-1.5 text-xs font-semibold text-slate-700"
    >
      <option value="system">{locale === "th" ? "ธีมระบบ" : "System theme"}</option>
      <option value="light">{locale === "th" ? "ธีมสว่าง" : "Light theme"}</option>
      <option value="dark">{locale === "th" ? "ธีมมืด" : "Dark theme"}</option>
    </select>
  );
}

export type ThemeMode = "light" | "dark" | "system";

export function AttendeeThemeSelect({ mode, onChange }: {
  mode: ThemeMode;
  onChange: (mode: ThemeMode) => void;
}) {
  return (
    <select
      aria-label="ธีมการแสดงผล / Appearance"
      value={mode}
      onChange={(event) => onChange(event.target.value as ThemeMode)}
      className="min-h-10 shrink-0 rounded-lg border border-slate-200 bg-white px-1.5 text-xs font-semibold text-slate-700"
    >
      <option value="system">System</option>
      <option value="light">Light</option>
      <option value="dark">Dark</option>
    </select>
  );
}

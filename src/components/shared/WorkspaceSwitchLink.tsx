import { ArrowLeftRight } from "lucide-react";
import type { AppLanguage } from "../../lib/i18n";

type WorkspaceSwitchLinkProps = {
  language: AppLanguage;
  destination: "staff" | "attendee";
  menuItem?: boolean;
};

export function WorkspaceSwitchLink({ language, destination, menuItem }: WorkspaceSwitchLinkProps) {
  const staff = destination === "staff";
  const title = language === "th"
    ? staff ? "กลับหน้าทำงาน" : "สลับไปหน้าผู้เข้าร่วม"
    : staff ? "Back to staff workspace" : "Switch to attendee account";

  return (
    <a href={staff ? "/" : "/app/profile"} role={menuItem ? "menuitem" : undefined}
      className={`flex min-h-11 items-center justify-center gap-2.5 rounded-xl border px-3 py-2 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 ${staff ? "border-blue-600 bg-blue-600 text-white hover:bg-blue-700" : "border-blue-200 bg-blue-50 text-blue-800 hover:bg-blue-100"}`}>
      <ArrowLeftRight className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span>{title}</span>
    </a>
  );
}

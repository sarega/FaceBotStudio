import { ArrowLeftRight } from "lucide-react";
import type { AppLanguage } from "../../lib/i18n";

type WorkspaceSwitchLinkProps = {
  language: AppLanguage;
  destination: "staff" | "attendee";
};

export function WorkspaceSwitchLink({ language, destination }: WorkspaceSwitchLinkProps) {
  const staff = destination === "staff";
  const title = language === "th"
    ? staff ? "สลับไปหน้าทีมงาน" : "สลับไปหน้าผู้เข้าร่วม"
    : staff ? "Switch to staff workspace" : "Switch to attendee account";

  return (
    <a href={staff ? "/staff/login" : "/app/profile"}
      className="flex min-h-11 items-center gap-2.5 rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-semibold text-blue-800 transition-colors hover:bg-blue-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600">
      <ArrowLeftRight className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span>{title}</span>
    </a>
  );
}

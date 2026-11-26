import { ChevronDown } from "lucide-react";
import type { AppLanguage } from "../lib/i18n";
export function AttendeeLanguageSelect({locale,onChange}:{locale:AppLanguage;onChange:(locale:AppLanguage)=>void}) {
  const label=locale==="th"?"ภาษา":"Language";
  return <span title={label} className="relative inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2 text-slate-700 focus-within:ring-2 focus-within:ring-blue-500">
    <svg aria-hidden="true" viewBox="0 0 60 36" className="h-4 w-6 shrink-0 rounded-sm shadow-sm">
      {locale==="th"?<><rect width="60" height="36" fill="#a51931"/><rect y="6" width="60" height="24" fill="#fff"/><rect y="12" width="60" height="12" fill="#2d2a4a"/></>:<><rect width="60" height="36" fill="#012169"/><path d="M0 0L60 36M60 0L0 36" stroke="white" strokeWidth="8"/><path d="M0 0L60 36M60 0L0 36" stroke="#c8102e" strokeWidth="3"/><path d="M30 0V36M0 18H60" stroke="white" strokeWidth="12"/><path d="M30 0V36M0 18H60" stroke="#c8102e" strokeWidth="7"/></>}
    </svg><span className="text-xs font-semibold">{locale==="th"?"ไทย":"English"}</span><ChevronDown className="h-3 w-3"/>
    <select aria-label={label} value={locale} className="absolute inset-0 h-full w-full cursor-pointer opacity-0" onChange={e=>onChange(e.target.value==="en"?"en":"th")}><option value="th">🇹🇭 ไทย</option><option value="en">🇬🇧 English</option></select>
  </span>;
}

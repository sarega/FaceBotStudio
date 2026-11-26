import { BedDouble, CarFront, ChevronDown, ClipboardCheck, Settings2, Tags } from "lucide-react";
import type { ReactNode } from "react";

export type RegistrationSectionTone = "settings" | "coupons" | "review" | "rooming" | "carpool";
type Props = {
  tone: RegistrationSectionTone;
  title: string;
  subtitle?: string;
  open: boolean;
  onToggle: () => void;
  actions?: ReactNode;
  indicators?: ReactNode;
};

const icons = {
  settings: Settings2,
  coupons: Tags,
  review: ClipboardCheck,
  rooming: BedDouble,
  carpool: CarFront,
} as const;

/** A single keyboard-accessible section header for paid-registration administration. */
export function RegistrationSectionHeader({
  tone, title, subtitle, open, onToggle, actions, indicators,
}: Props) {
  const Icon = icons[tone];
  return (
    <div className="registration-section-heading">
      <button type="button" aria-expanded={open} onClick={onToggle}
        className="registration-section-toggle">
        <span className="registration-section-icon" aria-hidden="true"><Icon size={16} strokeWidth={2}/></span>
        <span className="registration-section-heading-label">
          <span className="registration-section-heading-title">{title}</span>
          {subtitle && <span className="registration-section-heading-subtitle">{subtitle}</span>}
        </span>
        {indicators&&<span className="registration-section-indicators">{indicators}</span>}
        <ChevronDown size={16} strokeWidth={2}
          className={`registration-section-chevron${open ? " is-open" : ""}`} aria-hidden="true"/>
      </button>
      {actions && open && <div className="registration-section-actions">{actions}</div>}
    </div>
  );
}

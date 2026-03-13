import { useEffect, useRef, useState, type AnchorHTMLAttributes, type ButtonHTMLAttributes, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  CircleHelp,
  Copy,
  MoreHorizontal,
  Phone,
} from "lucide-react";

import type { ChannelPlatform } from "../../types";

export type BadgeTone = "neutral" | "blue" | "emerald" | "amber" | "rose" | "violet";
export type ActionTone = BadgeTone;
export type BannerTone = "neutral" | "blue" | "emerald" | "amber" | "rose";

const BADGE_BASE_CLASS =
  "inline-flex max-w-full items-center justify-center rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.18em] leading-tight text-center select-none";

const BADGE_TONE_CLASSES: Record<BadgeTone, string> = {
  neutral: "border-slate-200 bg-slate-100 text-slate-700",
  blue: "border-blue-200 bg-blue-50 text-blue-700",
  emerald: "border-emerald-200 bg-emerald-50 text-emerald-700",
  amber: "border-amber-200 bg-amber-50 text-amber-700",
  rose: "border-rose-200 bg-rose-50 text-rose-700",
  violet: "border-violet-200 bg-violet-50 text-violet-700",
};

const BANNER_TONE_CLASSES: Record<BannerTone, string> = {
  neutral: "border-slate-200 bg-slate-50 text-slate-700",
  blue: "border-blue-200 bg-blue-50 text-blue-800",
  emerald: "border-emerald-200 bg-emerald-50 text-emerald-800",
  amber: "border-amber-200 bg-amber-50 text-amber-800",
  rose: "border-rose-200 bg-rose-50 text-rose-800",
};

const ACTION_BUTTON_BASE_CLASS =
  "inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border px-3.5 py-2 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50";

const ACTION_BUTTON_TONE_CLASSES: Record<ActionTone, { idle: string; active: string }> = {
  neutral: {
    idle: "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50",
    active: "border-slate-900 bg-slate-900 text-white",
  },
  blue: {
    idle: "border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100",
    active: "border-blue-600 bg-blue-600 text-white shadow-[0_10px_24px_rgba(37,99,235,0.18)]",
  },
  emerald: {
    idle: "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100",
    active: "border-emerald-600 bg-emerald-600 text-white",
  },
  amber: {
    idle: "border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100",
    active: "border-amber-600 bg-amber-600 text-white",
  },
  rose: {
    idle: "border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100",
    active: "border-rose-600 bg-rose-600 text-white",
  },
  violet: {
    idle: "border-violet-200 bg-violet-50 text-violet-700 hover:bg-violet-100",
    active: "border-violet-600 bg-violet-600 text-white",
  },
};

export function ChannelPlatformLogo({
  platform,
  className = "h-10 w-10 rounded-2xl",
}: {
  platform: ChannelPlatform;
  className?: string;
}) {
  const baseClass = `inline-flex shrink-0 items-center justify-center border border-white/35 text-white shadow-sm ${className}`.trim();
  const iconClass = "h-6 w-6";

  if (platform === "facebook") {
    return (
      <span
        className={baseClass}
        style={{ background: "linear-gradient(135deg, #0099FF 0%, #2563EB 100%)" }}
        aria-hidden="true"
      >
        <svg viewBox="0 0 24 24" className={iconClass}>
          <path
            fill="rgba(255,255,255,0.98)"
            d="M12 4.9c-4.35 0-7.9 3.18-7.9 7.1 0 2.2 1.1 4.14 2.84 5.45V20l2.62-1.45c.76.2 1.58.3 2.44.3 4.35 0 7.9-3.18 7.9-7.1S16.35 4.9 12 4.9Z"
          />
          <path
            fill="#1D4ED8"
            d="M7.5 13.9 10.84 10.33a.45.45 0 0 1 .58-.05l2.31 1.73 2.7-2.66c.2-.19.5.06.34.28l-3.34 3.57a.45.45 0 0 1-.58.05l-2.31-1.73-2.7 2.66c-.2.19-.5-.06-.34-.28Z"
          />
        </svg>
      </span>
    );
  }

  if (platform === "line_oa") {
    return (
      <span className={baseClass} style={{ backgroundColor: "#06C755" }} aria-hidden="true">
        <svg viewBox="0 0 24 24" className={iconClass}>
          <rect x="4" y="5" width="16" height="11" rx="5" fill="currentColor" />
          <path d="M10 16h4l-2 2.6z" fill="currentColor" />
          <text x="12" y="12.6" textAnchor="middle" fontSize="5.2" fontWeight="700" fill="#06C755" fontFamily="Arial, sans-serif">
            LINE
          </text>
        </svg>
      </span>
    );
  }

  if (platform === "instagram") {
    return (
      <span
        className={baseClass}
        style={{ background: "linear-gradient(135deg, #F58529 0%, #DD2A7B 55%, #8134AF 100%)" }}
        aria-hidden="true"
      >
        <svg viewBox="0 0 24 24" className={`${iconClass} fill-none stroke-current`}>
          <rect x="5.25" y="5.25" width="13.5" height="13.5" rx="4" strokeWidth="1.8" />
          <circle cx="12" cy="12" r="3.25" strokeWidth="1.8" />
          <circle cx="16.55" cy="7.45" r="1" fill="currentColor" stroke="none" />
        </svg>
      </span>
    );
  }

  if (platform === "whatsapp") {
    return (
      <span className={baseClass} style={{ backgroundColor: "#25D366" }} aria-hidden="true">
        <svg viewBox="0 0 24 24" className={`${iconClass} fill-none stroke-current`}>
          <path d="M12 5.2a6.8 6.8 0 0 0-5.9 10.2L5.2 19l3.8-1a6.8 6.8 0 1 0 3-12.8Z" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M9.3 9.4c.2-.3.4-.4.6-.4h.5c.2 0 .4.1.5.4l.6 1.5c.1.3 0 .6-.2.8l-.5.5c.7 1.2 1.7 2.1 3 2.8l.5-.4c.2-.2.5-.2.8-.1l1.4.6c.3.1.4.3.4.5v.5c0 .3-.1.5-.4.6-.4.2-.9.4-1.4.3-3.3-.5-6.2-3.2-7-6.5-.1-.5 0-1 .2-1.5Z" fill="currentColor" stroke="none" />
        </svg>
      </span>
    );
  }

  if (platform === "telegram") {
    return (
      <span className={baseClass} style={{ backgroundColor: "#229ED9" }} aria-hidden="true">
        <svg viewBox="0 0 24 24" className={iconClass}>
          <path d="M18.8 6.2 5.9 11.2c-.9.4-.9 1.1-.2 1.3l3.3 1 1.3 4c.2.6.3.8.8.8.4 0 .6-.2.8-.4l1.8-1.7 3.7 2.8c.7.4 1.2.2 1.4-.7l2.2-10.3c.3-1-.3-1.5-1.2-1.1Z" />
        </svg>
      </span>
    );
  }

  if (platform === "web_chat") {
    return (
      <span className={baseClass} style={{ backgroundColor: "#475569" }} aria-hidden="true">
        <svg viewBox="0 0 24 24" className={`${iconClass} fill-none stroke-current`}>
          <path d="M5 7.5A2.5 2.5 0 0 1 7.5 5h5A2.5 2.5 0 0 1 15 7.5v3A2.5 2.5 0 0 1 12.5 13H10l-3 2v-2.3A2.5 2.5 0 0 1 5 10.5Z" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M12.5 10A2.5 2.5 0 0 1 15 7.5h1.5A2.5 2.5 0 0 1 19 10v2A2.5 2.5 0 0 1 16.5 14H15l-2 1.5V13.8" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    );
  }

  return null;
}

export function PublicContactActionLink({
  href,
  label,
  kind,
  compact = false,
}: {
  href: string;
  label: string;
  kind: "messenger" | "line" | "phone";
  compact?: boolean;
}) {
  const iconClass = compact ? "h-3.5 w-3.5" : "h-4 w-4";
  const baseClass = compact
    ? "public-page-control inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition-colors hover:border-blue-200 hover:text-blue-600"
    : "public-page-control inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition-colors hover:border-blue-200 hover:text-blue-600";

  return (
    <a href={href} target={kind === "phone" ? undefined : "_blank"} rel={kind === "phone" ? undefined : "noopener noreferrer"} className={baseClass}>
      {kind === "messenger" ? (
        <ChannelPlatformLogo platform="facebook" className="h-6 w-6 rounded-xl" />
      ) : kind === "line" ? (
        <ChannelPlatformLogo platform="line_oa" className="h-6 w-6 rounded-xl" />
      ) : (
        <span className="inline-flex h-6 w-6 items-center justify-center rounded-xl bg-slate-100 text-slate-600">
          <Phone className={iconClass} />
        </span>
      )}
      {label}
    </a>
  );
}

export function StatusBadge({
  tone = "neutral",
  className = "",
  children,
}: {
  tone?: BadgeTone;
  className?: string;
  children: ReactNode;
}) {
  return <span className={`${BADGE_BASE_CLASS} ${BADGE_TONE_CLASSES[tone]} ${className}`.trim()}>{children}</span>;
}

export function SelectionMarker({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-blue-700 ${className}`.trim()}>
      <CheckCircle2 className="h-3.5 w-3.5" />
      selected
    </span>
  );
}

export function PageBanner({
  tone = "neutral",
  icon,
  children,
  className = "",
}: {
  tone?: BannerTone;
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded-xl border px-3 py-2 text-xs ${BANNER_TONE_CLASSES[tone]} ${className}`.trim()}>
      <div className="flex items-start gap-2">
        {icon ? <span className="mt-0.5 shrink-0">{icon}</span> : null}
        <p className="leading-relaxed">{children}</p>
      </div>
    </div>
  );
}

export function StatusLine({
  items,
  className = "",
}: {
  items: Array<ReactNode | null | undefined | false>;
  className?: string;
}) {
  const filtered = items.filter(Boolean) as ReactNode[];
  if (filtered.length === 0) return null;
  return (
    <p className={`flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-slate-600 ${className}`.trim()}>
      {filtered.map((item, index) => (
        <span key={index} className="inline-flex items-center gap-1">
          {index > 0 && <span className="text-slate-300">·</span>}
          {item}
        </span>
      ))}
    </p>
  );
}

export function CompactStatRow({
  stats,
  className = "",
}: {
  stats: Array<{ label: string; value: string | number; tone?: BannerTone }>;
  className?: string;
}) {
  return (
    <div className={`flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 ${className}`.trim()}>
      {stats.map((stat) => {
        const toneClasses =
          stat.tone === "emerald"
            ? "text-emerald-700"
            : stat.tone === "amber"
            ? "text-amber-700"
            : stat.tone === "blue"
            ? "text-blue-700"
            : "text-slate-700";
        return (
          <div key={stat.label} className="inline-flex items-center gap-1.5">
            <span className={`text-sm font-semibold ${toneClasses}`}>{stat.value}</span>
            <span className="text-[11px] text-slate-500">{stat.label}</span>
          </div>
        );
      })}
    </div>
  );
}

export function AdminAgentDashboardMiniStat({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string | number;
  tone?: BadgeTone;
}) {
  const toneClasses =
    tone === "emerald"
      ? "border-emerald-200 bg-emerald-50 text-emerald-900"
      : tone === "amber"
      ? "border-amber-200 bg-amber-50 text-amber-900"
      : tone === "blue"
      ? "border-blue-200 bg-blue-50 text-blue-900"
      : tone === "violet"
      ? "border-violet-200 bg-violet-50 text-violet-900"
      : "border-slate-300 bg-white text-slate-900";

  return (
    <div className={`rounded-2xl border px-3 py-2 ${toneClasses}`.trim()}>
      <div className="text-base font-semibold leading-none">{value}</div>
      <div className="mt-1 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-600">{label}</div>
    </div>
  );
}

export function AdminAgentDashboardMeter({
  label,
  totalLabel,
  segments,
  className = "",
}: {
  label: string;
  totalLabel: string;
  segments: Array<{ label: string; value: number; tone: "emerald" | "amber" | "blue" | "violet" | "slate" }>;
  className?: string;
}) {
  const total = segments.reduce((sum, segment) => sum + Math.max(0, segment.value), 0);
  const toneClassMap: Record<"emerald" | "amber" | "blue" | "violet" | "slate", { bar: string; dot: string; text: string }> = {
    emerald: {
      bar: "bg-emerald-500",
      dot: "bg-emerald-500",
      text: "text-emerald-800",
    },
    amber: {
      bar: "bg-amber-400",
      dot: "bg-amber-400",
      text: "text-amber-800",
    },
    blue: {
      bar: "bg-blue-500",
      dot: "bg-blue-500",
      text: "text-blue-800",
    },
    violet: {
      bar: "bg-violet-500",
      dot: "bg-violet-500",
      text: "text-violet-800",
    },
    slate: {
      bar: "bg-slate-500",
      dot: "bg-slate-500",
      text: "text-slate-800",
    },
  };

  return (
    <div className={`rounded-2xl border border-slate-300 bg-white px-3 py-2.5 ${className}`.trim()}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-700">{label}</p>
        <p className="text-xs font-semibold text-slate-900">{totalLabel}</p>
      </div>
      <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-slate-200">
        <div className="flex h-full w-full overflow-hidden rounded-full">
          {total > 0 ? (
            segments.filter((segment) => segment.value > 0).map((segment) => (
              <div
                key={segment.label}
                className={toneClassMap[segment.tone].bar}
                style={{ width: `${(segment.value / total) * 100}%` }}
                title={`${segment.label}: ${segment.value}`}
              />
            ))
          ) : (
            <div className="h-full w-full bg-slate-300" />
          )}
        </div>
      </div>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
        {segments.map((segment) => (
          <div key={segment.label} className="inline-flex items-center gap-1.5 text-[11px] text-slate-700">
            <span className={`h-2 w-2 rounded-full ${toneClassMap[segment.tone].dot}`} />
            <span className={`font-semibold ${toneClassMap[segment.tone].text}`}>{segment.value}</span>
            <span>{segment.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function InlineWarning({
  tone = "amber",
  children,
  className = "",
}: {
  tone?: BannerTone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <PageBanner
      tone={tone}
      icon={tone === "rose" ? <AlertCircle className="h-4 w-4" /> : <CircleHelp className="h-4 w-4" />}
      className={className}
    >
      {children}
    </PageBanner>
  );
}

export function InspectorSection({
  title,
  subtitle,
  actions,
  children,
  className = "",
}: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-2xl border border-slate-200 bg-slate-50 p-4 ${className}`.trim()}>
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h4 className="text-sm font-semibold text-slate-900">{title}</h4>
          {subtitle ? <p className="mt-1 text-xs text-slate-500">{subtitle}</p> : null}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

export function ActionButton({
  tone = "neutral",
  active = false,
  className = "",
  children,
  type,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  tone?: ActionTone;
  active?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const toneClasses = active ? ACTION_BUTTON_TONE_CLASSES[tone].active : ACTION_BUTTON_TONE_CLASSES[tone].idle;
  return (
    <button
      {...props}
      type={type || "button"}
      className={`${ACTION_BUTTON_BASE_CLASS} ${toneClasses} ${className}`.trim()}
    >
      {children}
    </button>
  );
}

export function CollapseIconButton({
  collapsed,
  onClick,
  label = "section",
  tone = "neutral",
  className = "",
}: {
  collapsed: boolean;
  onClick: () => void;
  label?: string;
  tone?: ActionTone;
  className?: string;
}) {
  const action = collapsed ? "Expand" : "Collapse";
  return (
    <ActionButton
      onClick={onClick}
      aria-label={`${action} ${label}`}
      title={`${action} ${label}`}
      tone={tone}
      className={`h-8 w-8 min-h-0 rounded-lg p-0 text-lg font-black leading-none ${className}`.trim()}
    >
      <span aria-hidden="true" className="font-mono">{collapsed ? "+" : "-"}</span>
    </ActionButton>
  );
}

export function HelpPopover({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [panelStyle, setPanelStyle] = useState<CSSProperties | null>(null);

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!popoverRef.current?.contains(target) && !panelRef.current?.contains(target)) {
        setOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  useEffect(() => {
    if (!open) {
      setPanelStyle(null);
      return;
    }

    const updatePosition = () => {
      const trigger = popoverRef.current;
      const panel = panelRef.current;
      if (!trigger || !panel) return;

      const margin = 16;
      const gap = 10;
      const triggerRect = trigger.getBoundingClientRect();
      const panelRect = panel.getBoundingClientRect();
      const panelWidth = Math.min(panelRect.width || 288, window.innerWidth - margin * 2);
      const panelHeight = panelRect.height || 0;

      let left = triggerRect.left + triggerRect.width / 2 - panelWidth / 2;
      left = Math.min(Math.max(margin, left), window.innerWidth - panelWidth - margin);

      let top = triggerRect.bottom + gap;
      if (top + panelHeight > window.innerHeight - margin && triggerRect.top - gap - panelHeight >= margin) {
        top = triggerRect.top - gap - panelHeight;
      }

      setPanelStyle({
        position: "fixed",
        top: `${Math.round(Math.max(margin, top))}px`,
        left: `${Math.round(left)}px`,
        width: `${Math.round(panelWidth)}px`,
        maxHeight: `${Math.max(160, window.innerHeight - margin * 2)}px`,
      });
    };

    updatePosition();
    const rafId = window.requestAnimationFrame(updatePosition);
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.cancelAnimationFrame(rafId);
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open]);

  return (
    <div className="relative shrink-0" ref={popoverRef}>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 transition-colors hover:bg-slate-50"
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={label}
      >
        <CircleHelp className="h-3.5 w-3.5" />
      </button>
      {open && typeof document !== "undefined" && createPortal(
        <div
          ref={panelRef}
          className="app-overlay-surface z-[120] w-[min(20rem,calc(100vw-2rem))] max-w-[20rem] overflow-y-auto rounded-2xl border border-slate-200 bg-white p-3 text-xs leading-relaxed text-slate-600 shadow-xl whitespace-normal break-words"
          style={panelStyle ?? { position: "fixed", left: "-9999px", top: "-9999px", visibility: "hidden" }}
        >
          {children}
        </div>,
        document.body,
      )}
    </div>
  );
}

export function InlineActionsMenu({
  label,
  tone = "neutral",
  children,
  className = "",
  iconOnly = false,
}: {
  label: string;
  tone?: ActionTone;
  children: ReactNode;
  className?: string;
  iconOnly?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <div className={`relative shrink-0 ${className}`.trim()} ref={menuRef}>
      <ActionButton
        onClick={() => setOpen((current) => !current)}
        tone={tone}
        className={
          iconOnly
            ? "h-9 w-9 min-h-0 rounded-lg p-0"
            : `min-w-[3.75rem] px-3 text-sm ${className.includes("w-full") ? "w-full justify-center" : ""}`.trim()
        }
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={label}
        title={label}
      >
        {iconOnly ? (
          <>
            <MoreHorizontal className="h-4 w-4" />
            <span className="sr-only">{label}</span>
          </>
        ) : (
          <>
            <span className="truncate">{label}</span>
            <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
          </>
        )}
      </ActionButton>
      {open && (
        <div
          className="app-overlay-surface absolute right-0 top-full z-20 mt-2 w-[min(16rem,calc(100vw-2rem))] rounded-2xl border border-slate-200 bg-white p-2 shadow-xl"
          onClick={(event) => {
            const target = event.target as HTMLElement | null;
            if (target?.closest('[role="menuitem"]')) {
              setOpen(false);
            }
          }}
        >
          {children}
        </div>
      )}
    </div>
  );
}

export function MenuActionItem({
  tone = "neutral",
  className = "",
  children,
  type,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  tone?: ActionTone;
  className?: string;
  children: ReactNode;
}) {
  const textClasses: Record<ActionTone, string> = {
    neutral: "text-slate-600 hover:bg-slate-50",
    blue: "text-blue-700 hover:bg-blue-50",
    emerald: "text-emerald-700 hover:bg-emerald-50",
    amber: "text-amber-700 hover:bg-amber-50",
    rose: "text-rose-700 hover:bg-rose-50",
    violet: "text-violet-700 hover:bg-violet-50",
  };

  return (
    <button
      {...props}
      type={type || "button"}
      role="menuitem"
      className={`flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${textClasses[tone]} ${className}`.trim()}
    >
      {children}
    </button>
  );
}

export function MenuActionLink({
  tone = "neutral",
  className = "",
  children,
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement> & {
  tone?: ActionTone;
  className?: string;
  children: ReactNode;
}) {
  const textClasses: Record<ActionTone, string> = {
    neutral: "text-slate-600 hover:bg-slate-50",
    blue: "text-blue-700 hover:bg-blue-50",
    emerald: "text-emerald-700 hover:bg-emerald-50",
    amber: "text-amber-700 hover:bg-amber-50",
    rose: "text-rose-700 hover:bg-rose-50",
    violet: "text-violet-700 hover:bg-violet-50",
  };

  return (
    <a
      {...props}
      role="menuitem"
      className={`flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm transition-colors ${textClasses[tone]} ${className}`.trim()}
    >
      {children}
    </a>
  );
}

export function CopyField({
  label,
  value,
  onCopy,
  help,
  copied = false,
}: {
  label: string;
  value: string;
  onCopy: () => void;
  help?: ReactNode;
  copied?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <label className="block text-xs font-bold uppercase tracking-[0.18em] text-slate-500">{label}</label>
        {help ? (
          <HelpPopover label={`Open setup note for ${label}`}>{help}</HelpPopover>
        ) : null}
      </div>
      <div className="flex items-stretch gap-2">
        <input
          readOnly
          value={value}
          className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-mono outline-none"
        />
        <button
          onClick={onCopy}
          className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 transition-colors hover:bg-slate-50"
          aria-label={`Copy ${label}`}
        >
          {copied ? <CheckCircle2 className="w-5 h-5 text-emerald-500" /> : <Copy className="w-5 h-5 text-slate-400" />}
        </button>
      </div>
    </div>
  );
}

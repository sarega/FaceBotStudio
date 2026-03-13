import { Bot, ExternalLink, Info, Phone, Shield } from "lucide-react";

import type { PublicEventPageResponse } from "../../../types";

function normalizeExternalHref(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return trimmed;
  return `https://${trimmed.replace(/^\/+/, "")}`;
}

function BrandMark({ label, logoUrl }: { label: string; logoUrl: string }) {
  if (logoUrl) {
    return (
      <div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-xl border border-slate-200 bg-white p-2 shadow-sm">
        <img
          src={logoUrl}
          alt={`${label} logo`}
          className="h-full w-full object-contain"
          loading="lazy"
          onError={(event) => {
            event.currentTarget.style.display = "none";
          }}
        />
      </div>
    );
  }

  return (
    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600 shadow-[0_10px_24px_rgba(37,99,235,0.18)]">
      <Bot className="h-4.5 w-4.5 text-white" />
    </div>
  );
}

type PlatformBrandPaneProps = {
  brand: PublicEventPageResponse["brand"];
};

export function PlatformBrandPane({ brand }: PlatformBrandPaneProps) {
  if (brand.mode === "hidden") return null;

  const label = brand.label.trim() || "Meetrix";
  const aboutHref = normalizeExternalHref(brand.about_url);
  const privacyHref = normalizeExternalHref(brand.privacy_url);
  const contactHref = normalizeExternalHref(brand.contact_url);

  return (
    <div className="border-b border-slate-200 bg-white/90 backdrop-blur supports-[backdrop-filter]:bg-white/75">
      <div className="mx-auto max-w-6xl px-4 py-2 sm:px-6 lg:px-8">
        <div className="flex flex-col gap-2 rounded-[1.25rem] border border-slate-200 bg-[radial-gradient(circle_at_top_left,_rgba(59,130,246,0.08),_transparent_55%),linear-gradient(180deg,_rgba(255,255,255,0.96),_rgba(248,250,252,0.96))] px-3.5 py-2.5 shadow-sm sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-2.5">
            <BrandMark label={label} logoUrl={brand.logo_url} />
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-blue-700">Platform</p>
              {brand.mode === "full" ? (
                <>
                  <p className="truncate text-sm font-semibold leading-5 text-slate-900">{label}</p>
                  <p className="truncate text-xs text-slate-500">Event page, registration, and attendee help</p>
                </>
              ) : (
                <p className="truncate text-sm font-semibold leading-5 text-slate-900">Event page by {label}</p>
              )}
            </div>
          </div>

          {brand.mode === "full" && (aboutHref || privacyHref || contactHref) && (
            <div className="flex flex-wrap items-center gap-2">
              {aboutHref && (
                <a
                  href={aboutHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="public-page-control inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition-colors hover:border-blue-200 hover:text-blue-600"
                >
                  <Info className="h-3.5 w-3.5" />
                  About
                </a>
              )}
              {privacyHref && (
                <a
                  href={privacyHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="public-page-control inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition-colors hover:border-blue-200 hover:text-blue-600"
                >
                  <Shield className="h-3.5 w-3.5" />
                  Privacy
                </a>
              )}
              {contactHref && (
                <a
                  href={contactHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="public-page-control inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition-colors hover:border-blue-200 hover:text-blue-600"
                >
                  <Phone className="h-3.5 w-3.5" />
                  Contact
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

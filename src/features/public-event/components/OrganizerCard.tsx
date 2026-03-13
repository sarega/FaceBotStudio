import { Building2, Globe, Link2, MessageSquare } from "lucide-react";

import type { PublicEventPageResponse } from "../../../types";

function normalizeExternalHref(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return trimmed;
  return `https://${trimmed.replace(/^\/+/, "")}`;
}

function LogoPanel({ name, logoUrl }: { name: string; logoUrl: string }) {
  if (logoUrl) {
    return (
      <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-slate-200 bg-white p-2.5 shadow-sm">
        <img
          src={logoUrl}
          alt={`${name} logo`}
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
    <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-500">
      <Building2 className="h-6 w-6" />
    </div>
  );
}

type OrganizerCardProps = {
  organizer: PublicEventPageResponse["organizer"];
};

export function OrganizerCard({ organizer }: OrganizerCardProps) {
  const name = organizer.name.trim();
  if (!name) return null;

  const websiteHref = normalizeExternalHref(organizer.website_url);
  const facebookHref = normalizeExternalHref(organizer.facebook_url);
  const lineHref = normalizeExternalHref(organizer.line_url);
  const hasExtendedDetails = Boolean(
    organizer.description.trim()
    || organizer.contact_text.trim()
    || websiteHref
    || facebookHref
    || lineHref,
  );

  return (
    <section className="py-4 sm:py-5">
      <div className={`flex gap-3 ${hasExtendedDetails ? "flex-col sm:flex-row" : "items-center"}`}>
        <LogoPanel name={name} logoUrl={organizer.logo_url} />
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">Organized by</p>
          <h2 className="mt-1.5 text-lg font-semibold text-slate-900">{name}</h2>

          {organizer.description.trim() && (
            <p className="mt-2.5 whitespace-pre-line text-sm leading-6 text-slate-600">
              {organizer.description}
            </p>
          )}

          {(websiteHref || facebookHref || lineHref) && (
            <div className="mt-3 flex flex-wrap gap-2">
              {websiteHref && (
                <a
                  href={websiteHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="public-page-control inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition-colors hover:border-blue-200 hover:text-blue-600"
                >
                  <Globe className="h-3.5 w-3.5" />
                  Website
                </a>
              )}
              {facebookHref && (
                <a
                  href={facebookHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="public-page-control inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition-colors hover:border-blue-200 hover:text-blue-600"
                >
                  <Link2 className="h-3.5 w-3.5" />
                  Facebook
                </a>
              )}
              {lineHref && (
                <a
                  href={lineHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="public-page-control inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition-colors hover:border-blue-200 hover:text-blue-600"
                >
                  <MessageSquare className="h-3.5 w-3.5" />
                  LINE
                </a>
              )}
            </div>
          )}

          {organizer.contact_text.trim() && (
            <div className="surface-subpanel mt-3 rounded-xl px-3.5 py-3.5">
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">Contact</p>
              <p className="mt-1.5 whitespace-pre-line text-sm leading-6 text-slate-600">{organizer.contact_text}</p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

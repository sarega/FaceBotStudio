import { ExternalLink, Handshake } from "lucide-react";

import { groupPublicSponsorsByTier } from "../../../lib/publicEventPageBranding";
import type { PublicEventPageResponse } from "../../../types";

function normalizeExternalHref(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return trimmed;
  return `https://${trimmed.replace(/^\/+/, "")}`;
}

function SponsorLogo({ name, logoUrl }: { name: string; logoUrl: string }) {
  if (logoUrl) {
    return (
      <img
        src={logoUrl}
        alt={`${name || "Sponsor"} logo`}
        className="h-16 w-full object-contain"
        loading="lazy"
        onError={(event) => {
          event.currentTarget.style.display = "none";
        }}
      />
    );
  }

  return (
    <div className="flex h-14 w-full items-center justify-center rounded-xl bg-slate-100 text-slate-500">
      <Handshake className="h-6 w-6" />
    </div>
  );
}

type SponsorsSectionProps = {
  sponsors: PublicEventPageResponse["sponsors"];
};

export function SponsorsSection({ sponsors }: SponsorsSectionProps) {
  if (sponsors.entries.length === 0) return null;

  const groups = groupPublicSponsorsByTier(sponsors.entries);

  return (
    <section className="py-4 sm:py-5">
      <div className="flex items-center gap-2">
        <Handshake className="h-4 w-4 text-blue-600" />
        <h2 className="text-lg font-semibold text-slate-900">Sponsors & Partners</h2>
      </div>

      <div className="mt-4 space-y-4">
        {groups.map((group) => (
          <div key={group.key}>
            {group.label && (
              <p className="mb-2.5 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">
                {group.label}
              </p>
            )}

            <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
              {group.items.map((sponsor, index) => {
                const href = normalizeExternalHref(sponsor.linkUrl);
                const key = `${group.key}:${sponsor.name || sponsor.logoUrl || index}`;
                const content = (
                  <>
                    <div className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-3">
                      <SponsorLogo name={sponsor.name} logoUrl={sponsor.logoUrl} />
                    </div>

                    <div className="mt-2.5 flex items-start justify-between gap-2.5">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-slate-900">{sponsor.name || "Sponsor"}</p>
                        {sponsor.tier && <p className="mt-0.5 text-xs text-slate-500">{sponsor.tier}</p>}
                      </div>
                      {href && <ExternalLink className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />}
                    </div>
                  </>
                );

                if (href) {
                  return (
                    <a
                      key={key}
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="public-page-control flex min-h-[7.25rem] flex-col justify-between rounded-[1.25rem] border border-slate-200 bg-white p-3.5 text-left shadow-sm transition-colors hover:border-blue-200"
                    >
                      {content}
                    </a>
                  );
                }

                return (
                  <div
                    key={key}
                    className="flex min-h-[7.25rem] flex-col justify-between rounded-[1.25rem] border border-slate-200 bg-white p-3.5 text-left shadow-sm"
                  >
                    {content}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

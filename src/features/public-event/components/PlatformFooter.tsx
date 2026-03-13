import { ExternalLink, Info, Phone, Shield } from "lucide-react";

import type { PublicEventPageResponse } from "../../../types";

function normalizeExternalHref(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return trimmed;
  return `https://${trimmed.replace(/^\/+/, "")}`;
}

type PlatformFooterProps = {
  brand: PublicEventPageResponse["brand"];
};

export function PlatformFooter({ brand }: PlatformFooterProps) {
  if (brand.mode === "hidden") return null;

  const label = brand.label.trim() || "Meetrix";
  const aboutHref = normalizeExternalHref(brand.about_url);
  const privacyHref = normalizeExternalHref(brand.privacy_url);
  const contactHref = normalizeExternalHref(brand.contact_url);

  return (
    <footer className="public-page-footer border-t border-slate-200 bg-white/80">
      <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-6 text-sm sm:px-6 lg:flex-row lg:items-center lg:justify-between lg:px-8">
        <div>
          <p className="font-semibold text-slate-900">
            {brand.mode === "full" ? label : `Event page and registration by ${label}`}
          </p>
          {brand.mode === "full" && (
            <p className="mt-1 text-slate-500">Attendee landing page, registration flow, and support touchpoint</p>
          )}
        </div>

        {brand.mode === "full" && (aboutHref || privacyHref || contactHref) && (
          <div className="flex flex-wrap items-center gap-3 text-xs font-semibold text-slate-600">
            {aboutHref && (
              <a href={aboutHref} target="_blank" rel="noopener noreferrer" className="public-page-control inline-flex items-center gap-1 hover:text-blue-600">
                <Info className="h-3.5 w-3.5" />
                About
              </a>
            )}
            {privacyHref && (
              <a href={privacyHref} target="_blank" rel="noopener noreferrer" className="public-page-control inline-flex items-center gap-1 hover:text-blue-600">
                <Shield className="h-3.5 w-3.5" />
                Privacy
              </a>
            )}
            {contactHref && (
              <a href={contactHref} target="_blank" rel="noopener noreferrer" className="public-page-control inline-flex items-center gap-1 hover:text-blue-600">
                <Phone className="h-3.5 w-3.5" />
                Contact
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            )}
          </div>
        )}
      </div>
    </footer>
  );
}

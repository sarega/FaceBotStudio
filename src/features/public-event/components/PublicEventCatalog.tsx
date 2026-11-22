import { PublicCustomerMenu } from "./PublicCustomerMenu";
import { useEffect, useState } from "react";
import { ArrowRight, CalendarDays, ExternalLink, MapPin, RefreshCw, Search, Ticket } from "lucide-react";
import type { PublicEventCatalogEntry, PublicEventCatalogResponse } from "../../../types";

function formatStartingPrice(value: number) {
  return new Intl.NumberFormat("th-TH", { style: "currency", currency: "THB", maximumFractionDigits: 0 }).format(value);
}

function CatalogCard({ event, locale }: { event: PublicEventCatalogEntry; locale: "th" | "en" }) {
  const t = (th: string, en: string) => locale === "th" ? th : en;
  const eventUrl = `/events/${encodeURIComponent(event.slug)}`;
  const venue = event.location.venue_name || event.location.compact;
  return (
    <article className="grid min-h-44 grid-cols-[38%_minmax(0,1fr)] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm sm:min-h-56 sm:grid-cols-[13rem_minmax(0,1fr)] md:grid-cols-[15rem_minmax(0,1fr)]">
      <div className="relative bg-slate-100">
        {event.poster_url ? (
          <img src={event.poster_url} alt="" className="absolute inset-0 h-full w-full object-cover" loading="lazy" />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-blue-600">
            <Ticket className="h-6 w-6 sm:h-9 sm:w-9" />
          </div>
        )}
      </div>
      <div className="flex min-w-0 flex-col gap-2.5 p-2.5 wrap-break-word sm:gap-3 sm:p-4">
        <div className="space-y-2">
          <h2 className="text-sm font-bold leading-snug text-slate-900 sm:text-xl">{event.name}</h2>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-700">{event.availability.label}</span>
            {event.organizer.name && <p className="hidden text-xs font-semibold text-slate-600 sm:block">{event.organizer.name}</p>}
          </div>
          <div className="flex flex-col gap-y-1 text-xs leading-snug text-slate-600 sm:flex-row sm:flex-wrap sm:gap-x-4 sm:text-sm">
            <p className="flex min-w-0 items-start gap-1.5"><CalendarDays aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-500 sm:h-4 sm:w-4" /> <span>{event.date_label || t("รอประกาศวันจัดงาน", "Date to be announced")}</span></p>
            {venue && <p className="flex min-w-0 items-start gap-1.5"><MapPin aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-500 sm:h-4 sm:w-4" /> <span>{venue}</span></p>}
          </div>
          {event.summary && <p className="hidden text-sm leading-5 text-slate-600 sm:line-clamp-2">{event.summary}</p>}
        </div>
        <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 pt-2">
          {event.starting_price != null && <span className="text-xs font-semibold text-slate-700 sm:text-sm">{t("เริ่มต้น", "From")} {formatStartingPrice(event.starting_price)}</span>}
          <div className="flex flex-wrap gap-1.5 sm:ml-auto">
            {event.availability.external_ticket_url && (
              <a href={event.availability.external_ticket_url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-slate-200 px-2 py-1.5 text-xs font-semibold text-slate-700 hover:border-blue-300 hover:text-blue-700 sm:px-3 sm:text-sm">
                <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> {t("บัตรเข้างาน", "Tickets")}
              </a>
            )}
            {event.availability.customer_checkout_enabled && (
              <a href={`${eventUrl}/checkout`} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-2 py-1.5 text-xs font-semibold text-blue-700 hover:border-blue-300 hover:bg-blue-100 sm:px-3 sm:text-sm">
                <Ticket className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> {t("ซื้อบัตร", "Buy seats")}
              </a>
            )}
            <a href={eventUrl} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-blue-600 px-2 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 sm:px-3 sm:text-sm">
              {t("ดูรายละเอียด", "View event")} <ArrowRight className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            </a>
          </div>
        </div>
      </div>
    </article>
  );
}

export function PublicEventCatalog({ locale, languageControl }: { locale: "th" | "en"; languageControl: React.ReactNode }) {
  const t = (th: string, en: string) => locale === "th" ? th : en;
  const [events, setEvents] = useState<PublicEventCatalogEntry[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/public/events", { credentials: "same-origin" })
      .then(async (response) => {
        const data = await response.json().catch(() => ({})) as Partial<PublicEventCatalogResponse> & { error?: string };
        if (!response.ok) throw new Error(data.error || "Failed to load events");
        if (!cancelled) setEvents(Array.isArray(data.events) ? data.events : []);
      })
      .catch((error: unknown) => {
        if (!cancelled) setErrorMessage(error instanceof Error ? error.message : "Failed to load events");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const normalizedQuery = query.trim().toLowerCase();
  const filteredEvents = normalizedQuery
    ? events.filter((event) => `${event.name} ${event.summary} ${event.location.compact} ${event.organizer.name}`.toLowerCase().includes(normalizedQuery))
    : events;
  const searchLabel = t("ค้นหางาน สถานที่ หรือผู้จัด", "Find events, venues, organizers");

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900">
      <header className="relative z-50 border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-2 px-4 py-2 sm:px-6">
          <a href="/events" className="flex items-center gap-2.5 text-sm font-bold tracking-wide text-slate-900">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-600 text-white"><Ticket className="h-4 w-4" /></span>
            Meetrix
          </a>
          <div className="flex flex-wrap items-center justify-end gap-2">{languageControl}<PublicCustomerMenu compact locale={locale} /></div>
        </div>
      </header>

      <section className="mx-auto max-w-5xl px-4 pb-8 pt-4 sm:px-6 sm:pt-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 sm:mb-4">
          <h1 className="text-xl font-bold tracking-tight text-slate-950 sm:text-2xl">{t("รายการอีเวนต์", "Events")}</h1>
          <div className="relative w-full max-w-[17rem]">
            <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <input type="search" aria-label={searchLabel} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={searchLabel} className="h-9 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-500/20" />
          </div>
        </div>

        {loading ? (
          <div role="status" className="flex min-h-28 items-center justify-center text-sm text-slate-500"><RefreshCw className="mr-2 h-4 w-4 animate-spin text-blue-600" /> {t("กำลังโหลดรายการงาน…", "Loading events…")}</div>
        ) : errorMessage ? (
          <div role="alert" className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{errorMessage}</div>
        ) : filteredEvents.length === 0 ? (
          <div role="status" className="rounded-2xl border border-dashed border-slate-300 bg-white p-5 text-center text-sm text-slate-600">
            {normalizedQuery ? t("ไม่พบงานที่ตรงกับคำค้น", "No events match your search") : t("ยังไม่มีงานที่เปิดให้ดู", "No public events yet")}
          </div>
        ) : (
          <div className="grid gap-3">{filteredEvents.map((event) => <CatalogCard key={event.slug} event={event} locale={locale} />)}</div>
        )}
      </section>
    </main>
  );
}

import { useEffect, useState } from "react";
import { ArrowRight, CalendarDays, ExternalLink, MapPin, RefreshCw, Search, Ticket } from "lucide-react";
import type { PublicEventCatalogEntry, PublicEventCatalogResponse } from "../../../types";

function formatStartingPrice(value: number | null) {
  if (value == null) return "";
  return new Intl.NumberFormat("th-TH", { style: "currency", currency: "THB", maximumFractionDigits: 0 }).format(value);
}

function CatalogCard({ event }: { event: PublicEventCatalogEntry }) {
  return (
    <article className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm transition-shadow hover:shadow-xl">
      <div className="aspect-[16/9] bg-slate-100">
        {event.poster_url ? (
          <img src={event.poster_url} alt="" className="h-full w-full object-cover" loading="lazy" />
        ) : (
          <div className="flex h-full items-center justify-center bg-gradient-to-br from-blue-100 via-indigo-50 to-slate-100 text-blue-500">
            <Ticket className="h-12 w-12" />
          </div>
        )}
      </div>
      <div className="space-y-4 p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-blue-600">{event.organizer.name || "Meetrix event"}</p>
            <h2 className="mt-1 text-xl font-bold tracking-tight text-slate-900">{event.name}</h2>
          </div>
          <span className="shrink-0 rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700">{event.availability.label}</span>
        </div>
        {event.summary && <p className="line-clamp-3 text-sm leading-6 text-slate-600">{event.summary}</p>}
        <div className="space-y-2 text-sm text-slate-600">
          <p className="flex items-start gap-2"><CalendarDays className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" /> {event.date_label || "Date to be announced"}</p>
          {event.location.compact && <p className="flex items-start gap-2"><MapPin className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" /> {event.location.compact}</p>}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
          <span className="text-sm font-semibold text-slate-700">{event.starting_price == null ? "Free registration or details" : `From ${formatStartingPrice(event.starting_price)}`}</span>
          <div className="flex flex-wrap gap-2">
            {event.availability.external_ticket_url && (
              <a href={event.availability.external_ticket_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:border-blue-300 hover:text-blue-700">
                <ExternalLink className="h-4 w-4" /> Tickets
              </a>
            )}
            {event.availability.customer_checkout_enabled && (
              <a href={`/events/${encodeURIComponent(event.slug)}/checkout`} className="inline-flex items-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-semibold text-blue-700 hover:border-blue-300 hover:bg-blue-100">
                <Ticket className="h-4 w-4" /> Buy seats
              </a>
            )}
            <a href={`/events/${encodeURIComponent(event.slug)}`} className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700">
              View event <ArrowRight className="h-4 w-4" />
            </a>
          </div>
        </div>
      </div>
    </article>
  );
}

export function PublicEventCatalog() {
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

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-5 sm:px-8">
          <a href="/events" className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-blue-600 text-white"><Ticket className="h-5 w-5" /></span>
            <span><span className="block text-sm font-bold tracking-wide text-slate-900">Meetrix</span><span className="block text-xs text-slate-500">Public events</span></span>
          </a>
          <a href="/account/login" className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:border-blue-300 hover:text-blue-700">Customer sign in</a>
        </div>
      </header>

      <section className="mx-auto max-w-6xl px-5 pb-12 pt-12 sm:px-8 sm:pt-16">
        <div className="max-w-2xl">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-blue-600">Discover events</p>
          <h1 className="mt-3 text-4xl font-bold tracking-tight text-slate-950 sm:text-5xl">Find your next event</h1>
          <p className="mt-4 text-base leading-7 text-slate-600">Browse public events, review the details, and choose the right way to register or continue to the organizer’s ticket page.</p>
        </div>
        <label className="relative mt-8 block max-w-xl">
          <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search events, places, or organizers" className="w-full rounded-2xl border border-slate-200 bg-white py-3.5 pl-12 pr-4 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-500/20" />
        </label>

        {loading ? (
          <div className="flex min-h-64 items-center justify-center text-slate-500"><RefreshCw className="mr-3 h-5 w-5 animate-spin text-blue-600" /> Loading events…</div>
        ) : errorMessage ? (
          <div className="mt-10 rounded-3xl border border-rose-200 bg-rose-50 p-6 text-sm text-rose-700">{errorMessage}</div>
        ) : filteredEvents.length === 0 ? (
          <div className="mt-10 rounded-3xl border border-dashed border-slate-300 bg-white p-10 text-center">
            <Ticket className="mx-auto h-8 w-8 text-slate-300" />
            <h2 className="mt-4 text-lg font-semibold text-slate-800">No public events yet</h2>
            <p className="mt-2 text-sm text-slate-500">Published events will appear here when organizers make them visible in the catalog.</p>
          </div>
        ) : (
          <div className="mt-10 grid gap-6 md:grid-cols-2 lg:grid-cols-3">{filteredEvents.map((event) => <CatalogCard key={event.slug} event={event} />)}</div>
        )}
      </section>
    </main>
  );
}

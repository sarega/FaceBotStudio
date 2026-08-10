import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, CalendarDays, Check, CheckCircle2, ChevronRight, CreditCard, LoaderCircle, MapPin, Ticket } from "lucide-react";

import { buildSpatialSeatLayout } from "../../direct-ticketing/seatMapLayout";
import { buildCheckoutPriceOptions, isSellableCheckoutSeat, normalizedCheckoutPrice } from "../checkoutSelection";
import { customerApi } from "./CustomerAccountScreen";

type CheckoutPerformance = {
  id: string;
  code: string;
  title: string;
  starts_at: string;
  ends_at?: string | null;
  seat_plan_image_url?: string | null;
  is_active: boolean;
};

type CheckoutSeat = {
  id: string;
  performance_id: string;
  zone: string;
  section_label?: string | null;
  ticket_class?: string | null;
  row_label: string;
  seat_label: string;
  face_value: number | null;
  status: string;
  allocation_status: string;
  x?: number | null;
  y?: number | null;
};

type CheckoutPayload = {
  event: { id: string; slug: string; name: string; seller_name: string };
  performances: CheckoutPerformance[];
  seats: CheckoutSeat[];
  receiver_name: string;
  promptpay_ready: boolean;
  hold_minutes: number;
  max_seats: number;
};

const naturalCompare = (left: string, right: string) => left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" });

function money(value: number) {
  return new Intl.NumberFormat("th-TH", { style: "currency", currency: "THB", maximumFractionDigits: 2 }).format(value);
}

function performanceDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("th-TH", { dateStyle: "full", timeStyle: "short" });
}

export function CustomerCheckoutScreen({ slug }: { slug: string }) {
  const [payload, setPayload] = useState<CheckoutPayload | null>(null);
  const [performanceId, setPerformanceId] = useState("");
  const [selectedPrice, setSelectedPrice] = useState<number | null>(null);
  const [selectedTicketClass, setSelectedTicketClass] = useState("");
  const [seatZone, setSeatZone] = useState("");
  const [selectedSeatIds, setSelectedSeatIds] = useState<string[]>([]);
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [createdOrderId, setCreatedOrderId] = useState("");

  useEffect(() => {
    let cancelled = false;
    void customerApi<CheckoutPayload>(`/api/public/events/${encodeURIComponent(slug)}/checkout`)
      .then((data) => {
        if (!cancelled) setPayload(data);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setErrorMessage(error instanceof Error && error.message === "CUSTOMER_NOT_AUTHENTICATED"
          ? "Please sign in with a verified customer account before buying tickets."
          : error instanceof Error ? error.message : "Checkout is unavailable");
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [slug]);

  const performanceOptions = useMemo(() => (payload?.performances || []).map((performance) => {
    const prices = buildCheckoutPriceOptions(payload?.seats || [], performance.id);
    return {
      ...performance,
      prices,
      seatCount: prices.reduce((total, option) => total + option.seatCount, 0),
      startingPrice: prices.length ? Math.min(...prices.map((option) => option.price)) : null,
    };
  }), [payload]);
  const selectedPerformance = performanceOptions.find((performance) => performance.id === performanceId) || null;
  const priceOptions = selectedPerformance?.prices || [];
  const selectableSeats = useMemo(() => (payload?.seats || []).filter((seat) => isSellableCheckoutSeat(seat, performanceId, selectedPrice, selectedTicketClass)), [payload, performanceId, selectedPrice, selectedTicketClass]);
  const seatZones = useMemo(() => Array.from(new Set(selectableSeats.map((seat) => seat.zone))).sort(naturalCompare), [selectableSeats]);
  const zonePlanSeats = useMemo(() => (payload?.seats || []).filter((seat) => seat.performance_id === performanceId && seat.zone === seatZone), [payload, performanceId, seatZone]);
  const spatialSeatMap = useMemo(() => buildSpatialSeatLayout(zonePlanSeats, seatZone), [zonePlanSeats, seatZone]);
  const spatialMapAvailable = spatialSeatMap.positioned.length > 0 && spatialSeatMap.coverage >= 0.8;
  const selectedSeats = useMemo(() => (payload?.seats || []).filter((seat) => selectedSeatIds.includes(seat.id)), [payload, selectedSeatIds]);
  const subtotal = selectedSeats.reduce((sum, seat) => sum + Math.max(0, Number(seat.face_value || 0)), 0);
  const activeStep = !performanceId ? 1 : selectedPrice == null ? 2 : 3;

  const choosePerformance = (id: string) => {
    setPerformanceId(id);
    setSelectedPrice(null);
    setSelectedTicketClass("");
    setSeatZone("");
    setSelectedSeatIds([]);
    setAcceptTerms(false);
  };

  const choosePrice = (price: number, ticketClass: string) => {
    const zones = Array.from(new Set((payload?.seats || []).filter((seat) => isSellableCheckoutSeat(seat, performanceId, price, ticketClass)).map((seat) => seat.zone))).sort(naturalCompare);
    setSelectedPrice(price);
    setSelectedTicketClass(ticketClass);
    setSeatZone(zones[0] || "");
    setSelectedSeatIds([]);
    setAcceptTerms(false);
  };

  const toggleSeat = (id: string) => {
    if (!selectableSeats.some((seat) => seat.id === id)) return;
    setSelectedSeatIds((current) => current.includes(id)
      ? current.filter((value) => value !== id)
      : current.length >= (payload?.max_seats || 6) ? current : [...current, id]);
  };

  const submit = async () => {
    setBusy(true);
    setErrorMessage("");
    try {
      const data = await customerApi<{ order: { id: string } }>(`/api/public/events/${encodeURIComponent(slug)}/orders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ performance_id: performanceId, seat_ids: selectedSeatIds, accept_terms: acceptTerms }),
      });
      setCreatedOrderId(data.order.id);
    } catch (error: unknown) {
      if (error instanceof Error && error.message === "CUSTOMER_NOT_AUTHENTICATED") {
        window.location.assign("/account/login");
        return;
      }
      setErrorMessage(error instanceof Error ? error.message : "Failed to create order");
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return <div className="flex min-h-screen items-center justify-center bg-slate-50 text-sm text-slate-500"><LoaderCircle className="mr-2 h-5 w-5 animate-spin" /> Loading checkout…</div>;
  }
  if (createdOrderId) {
    return <main className="flex min-h-screen items-center justify-center bg-slate-50 px-5"><div className="w-full max-w-lg rounded-3xl border border-emerald-200 bg-white p-8 text-center shadow-sm"><CheckCircle2 className="mx-auto h-12 w-12 text-emerald-500" /><h1 className="mt-5 text-2xl font-bold text-slate-900">Seat held</h1><p className="mt-2 text-sm leading-6 text-slate-600">Order <strong>{createdOrderId}</strong> is waiting for PromptPay payment. Continue in your customer app to view the QR and upload the slip.</p><a href="/app/orders" className="mt-6 inline-flex rounded-xl bg-blue-600 px-5 py-3 text-sm font-semibold text-white hover:bg-blue-700">Open my order</a></div></main>;
  }
  if (!payload) {
    return <main className="flex min-h-screen items-center justify-center bg-slate-50 px-5"><div className="w-full max-w-lg rounded-3xl border border-amber-200 bg-white p-8 text-center"><Ticket className="mx-auto h-10 w-10 text-amber-500" /><h1 className="mt-4 text-xl font-bold text-slate-900">Checkout unavailable</h1><p className="mt-2 text-sm leading-6 text-slate-600">{errorMessage || "This event has not enabled customer checkout yet."}</p><a href="/account/login" className="mt-5 inline-flex rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700">Sign in</a></div></main>;
  }

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4 sm:px-8">
          <a href={`/events/${encodeURIComponent(slug)}`} className="inline-flex items-center gap-2 text-sm font-semibold text-slate-600 hover:text-blue-700"><ArrowLeft className="h-4 w-4" /> Event details</a>
          <span className="inline-flex items-center gap-2 text-sm font-bold text-slate-900"><CreditCard className="h-4 w-4 text-blue-600" /> Secure checkout</span>
        </div>
      </header>

      <section className="mx-auto max-w-6xl px-5 py-8 sm:px-8">
        <div className="mb-7">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-blue-600">{payload.event.seller_name || "Event organizer"}</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950">{payload.event.name}</h1>
          <p className="mt-2 text-sm text-slate-600">Choose a performance, choose a price, then select seats from that seat plan. Your hold lasts {payload.hold_minutes} minutes.</p>
        </div>

        <ol className="mb-7 grid gap-2 rounded-2xl border border-slate-200 bg-white p-2 sm:grid-cols-3">
          {["Choose performance", "Choose price", "Choose seats"].map((label, index) => {
            const step = index + 1;
            const complete = activeStep > step;
            const active = activeStep === step;
            return <li key={label} className={`flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-semibold ${active ? "bg-blue-600 text-white" : complete ? "bg-emerald-50 text-emerald-700" : "text-slate-400"}`}><span className={`flex h-7 w-7 items-center justify-center rounded-full ${active ? "bg-white/20" : complete ? "bg-emerald-100" : "bg-slate-100"}`}>{complete ? <Check className="h-4 w-4" /> : step}</span>{label}</li>;
          })}
        </ol>

        {errorMessage && <div className="mb-5 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{errorMessage}</div>}

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="space-y-5">
            <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="mb-4 flex items-center gap-3"><span className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-100 text-sm font-bold text-blue-700">1</span><div><h2 className="font-semibold text-slate-900">Choose a performance</h2><p className="text-xs text-slate-500">Each performance has its own live seat inventory.</p></div></div>
              {performanceOptions.length ? <div className="grid gap-3 md:grid-cols-2">{performanceOptions.map((performance) => {
                const selected = performance.id === performanceId;
                return <button key={performance.id} type="button" aria-pressed={selected} onClick={() => choosePerformance(performance.id)} className={`rounded-2xl border p-4 text-left transition-colors ${selected ? "border-blue-500 bg-blue-50 ring-2 ring-blue-500/15" : "border-slate-200 hover:border-blue-300"}`}><div className="flex items-start justify-between gap-3"><span className="font-semibold text-slate-900">{performance.title}</span>{selected && <CheckCircle2 className="h-5 w-5 shrink-0 text-blue-600" />}</div><span className="mt-2 flex items-start gap-2 text-sm text-slate-600"><CalendarDays className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" />{performanceDate(performance.starts_at)}</span><span className="mt-3 flex items-center justify-between text-xs"><span className="font-semibold text-slate-500">{performance.seatCount ? `${performance.seatCount} seats` : "No priced seats"}</span><span className="font-bold text-slate-900">{performance.startingPrice == null ? "Pricing required" : `From ${money(performance.startingPrice)}`}</span></span></button>;
              })}</div> : <p className="rounded-2xl bg-amber-50 p-4 text-sm text-amber-700">No active performance is available yet.</p>}
            </section>

            <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="mb-4 flex items-center gap-3"><span className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-100 text-sm font-bold text-blue-700">2</span><div><h2 className="font-semibold text-slate-900">Choose a price</h2><p className="text-xs text-slate-500">Prices come directly from the selected performance inventory.</p></div></div>
              {!selectedPerformance ? <p className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-500">Choose a performance first.</p> : priceOptions.length ? <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{priceOptions.map((option) => {
                const selected = normalizedCheckoutPrice(selectedPrice) === option.price && selectedTicketClass === option.ticketClass;
                return <button key={`${option.ticketClass}-${option.price}`} type="button" aria-pressed={selected} onClick={() => choosePrice(option.price, option.ticketClass)} className={`rounded-2xl border p-4 text-left transition-colors ${selected ? "border-blue-500 bg-blue-50 ring-2 ring-blue-500/15" : "border-slate-200 hover:border-blue-300"}`}><span className="block text-xs font-bold uppercase tracking-[0.14em] text-blue-600">{option.ticketClass}</span><span className="mt-1 block text-xl font-bold text-slate-950">{money(option.price)}</span><span className="mt-1 block text-xs font-semibold text-emerald-700">{option.seatCount} seats available</span><span className="mt-2 block text-xs leading-5 text-slate-500">{option.zones.join(", ")}</span></button>;
              })}</div> : <p className="rounded-2xl bg-amber-50 p-4 text-sm text-amber-700">This performance has no sellable price yet. Add a face value to its allocated seats in Direct Ticketing.</p>}
            </section>

            <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="mb-4 flex items-center justify-between gap-3"><div className="flex items-center gap-3"><span className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-100 text-sm font-bold text-blue-700">3</span><div><h2 className="font-semibold text-slate-900">Choose seats</h2><p className="text-xs text-slate-500">The seat plan appears after the performance and price are selected.</p></div></div><span className="text-xs font-semibold text-slate-500">Up to {payload.max_seats}</span></div>
              {selectedPrice == null ? <p className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-500">Choose a performance and price first.</p> : <>
                <div className="mb-3 flex flex-wrap gap-2">{seatZones.map((zone) => <button key={zone} type="button" aria-pressed={seatZone === zone} onClick={() => setSeatZone(zone)} className={`rounded-full border px-3 py-2 text-xs font-semibold ${seatZone === zone ? "border-blue-600 bg-blue-600 text-white" : "border-slate-200 text-slate-600 hover:border-blue-300"}`}><MapPin className="mr-1 inline h-3.5 w-3.5" />{zone} · {selectableSeats.filter((seat) => seat.zone === zone).length}</button>)}</div>
                <div className="mb-3 flex flex-wrap gap-4 text-[11px] font-semibold text-slate-500"><span className="inline-flex items-center gap-1.5"><i className="h-3 w-3 rounded bg-rose-600" />Available to buy</span><span className="inline-flex items-center gap-1.5"><i className="h-3 w-3 rounded bg-violet-600" />Selected</span><span className="inline-flex items-center gap-1.5"><i className="h-3 w-3 rounded bg-slate-300" />Unavailable</span></div>
                {spatialMapAvailable ? <div className="overflow-auto rounded-2xl border border-slate-200 bg-slate-50 p-2"><div className="direct-ticketing-spatial-map" style={{ aspectRatio: String(spatialSeatMap.aspectRatio) }}>{spatialSeatMap.positioned.map((seat) => {
                  const selectable = isSellableCheckoutSeat(seat, performanceId, selectedPrice, selectedTicketClass);
                  const selected = selectedSeatIds.includes(seat.id);
                  return <button key={seat.id} type="button" disabled={!selectable} aria-pressed={selected} title={`${seat.zone} ${seat.row_label}-${seat.seat_label}${selectable ? ` · ${money(Number(seat.face_value))}` : " · unavailable"}`} onClick={() => toggleSeat(seat.id)} className={`direct-ticketing-spatial-seat ${selected ? "is-selected" : selectable ? "is-public-available" : "is-unknown"}`} style={{ left: `${seat.left}%`, top: `${seat.top}%` }}>{seat.row_label}{seat.seat_label}</button>;
                })}</div></div> : <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">{selectableSeats.filter((seat) => seat.zone === seatZone).sort((left, right) => naturalCompare(`${left.row_label}-${left.seat_label}`, `${right.row_label}-${right.seat_label}`)).map((seat) => {
                  const selected = selectedSeatIds.includes(seat.id);
                  return <button key={seat.id} type="button" aria-pressed={selected} onClick={() => toggleSeat(seat.id)} className={`rounded-xl border px-3 py-3 text-left text-sm font-semibold ${selected ? "border-violet-600 bg-violet-100 text-violet-900" : "border-emerald-300 bg-emerald-50 text-emerald-800"}`}>{seat.row_label}-{seat.seat_label}<span className="mt-1 block text-xs font-normal opacity-75">{seat.zone}</span></button>;
                })}</div>}
                {selectedSeats.length > 0 && <div className="mt-4 flex flex-wrap gap-2">{selectedSeats.map((seat) => <button key={seat.id} type="button" onClick={() => toggleSeat(seat.id)} className="inline-flex items-center gap-1 rounded-full bg-violet-100 px-3 py-1.5 text-xs font-semibold text-violet-800">{seat.zone} · {seat.row_label}-{seat.seat_label}<span aria-hidden="true">×</span></button>)}</div>}
                <label className="mt-4 flex items-start gap-3 rounded-2xl bg-slate-50 p-4 text-sm text-slate-600"><input type="checkbox" checked={acceptTerms} onChange={(event) => setAcceptTerms(event.target.checked)} className="mt-0.5 h-4 w-4 rounded border-slate-300 text-blue-600" /><span>I accept the event checkout terms and understand that payment is confirmed manually after I upload proof.</span></label>
              </>}
            </section>
          </div>

          <aside className="h-fit rounded-3xl border border-slate-200 bg-white p-5 shadow-sm lg:sticky lg:top-5">
            <h2 className="font-semibold text-slate-900">Order summary</h2>
            <div className="mt-5 space-y-4 text-sm">
              <div><p className="text-xs font-bold uppercase tracking-[0.12em] text-slate-400">Performance</p><p className="mt-1 font-semibold text-slate-800">{selectedPerformance?.title || "Not selected"}</p>{selectedPerformance && <p className="mt-1 text-xs text-slate-500">{performanceDate(selectedPerformance.starts_at)}</p>}</div>
              <div className="flex justify-between border-t border-slate-100 pt-4 text-slate-600"><span>Ticket class</span><span className="font-semibold text-slate-900">{selectedTicketClass || "—"}</span></div>
              <div className="flex justify-between text-slate-600"><span>Price</span><span className="font-semibold text-slate-900">{selectedPrice == null ? "—" : money(selectedPrice)}</span></div>
              <div className="flex justify-between text-slate-600"><span>Seats</span><span className="font-semibold text-slate-900">{selectedSeatIds.length}</span></div>
              <div className="flex justify-between border-t border-slate-100 pt-4 text-slate-600"><span>Subtotal preview</span><span className="text-base font-bold text-slate-950">{money(subtotal)}</span></div>
              <p className="text-xs leading-5 text-slate-500">Final fees and tax are calculated and snapshotted by the server before the order is created.</p>
            </div>
            {!payload.promptpay_ready && <p className="mt-5 rounded-xl bg-amber-50 p-3 text-xs leading-5 text-amber-700">PromptPay is not configured yet. The organizer must set PROMPTPAY_ID before accepting payments.</p>}
            <button type="button" onClick={() => void submit()} disabled={busy || !performanceId || selectedPrice == null || !selectedSeatIds.length || !acceptTerms || !payload.promptpay_ready} className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50">{busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <ChevronRight className="h-4 w-4" />}{busy ? "Creating order…" : `Hold seats for ${payload.hold_minutes} minutes`}</button>
          </aside>
        </div>
      </section>
    </main>
  );
}

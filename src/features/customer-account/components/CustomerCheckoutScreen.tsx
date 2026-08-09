import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, CheckCircle2, CreditCard, LoaderCircle, Ticket } from "lucide-react";
import { customerApi } from "./CustomerAccountScreen";

type CheckoutPerformance = { id: string; code: string; title: string; starts_at: string; ends_at?: string | null; is_active: boolean };
type CheckoutSeat = { id: string; performance_id: string; zone: string; row_label: string; seat_label: string; face_value: number | null; status: string; allocation_status: string };
type CheckoutPayload = {
  event: { id: string; slug: string; name: string; seller_name: string };
  performances: CheckoutPerformance[];
  seats: CheckoutSeat[];
  receiver_name: string;
  promptpay_ready: boolean;
  hold_minutes: number;
  max_seats: number;
};

function money(value: number) {
  return new Intl.NumberFormat("th-TH", { style: "currency", currency: "THB", maximumFractionDigits: 2 }).format(value);
}

export function CustomerCheckoutScreen({ slug }: { slug: string }) {
  const [payload, setPayload] = useState<CheckoutPayload | null>(null);
  const [performanceId, setPerformanceId] = useState("");
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
        if (cancelled) return;
        setPayload(data);
        setPerformanceId(data.performances[0]?.id || "");
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        if (error instanceof Error && error.message === "CUSTOMER_NOT_AUTHENTICATED") {
          setErrorMessage("Please sign in with a verified customer account before buying tickets.");
        } else {
          setErrorMessage(error instanceof Error ? error.message : "Checkout is unavailable");
        }
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [slug]);

  const seats = useMemo(() => (payload?.seats || []).filter((seat) => seat.performance_id === performanceId && seat.status === "available" && seat.allocation_status === "allocated"), [payload, performanceId]);
  const subtotal = selectedSeatIds.reduce((sum, id) => sum + Math.max(0, Number(seats.find((seat) => seat.id === id)?.face_value || 0)), 0);

  const toggleSeat = (id: string) => {
    setSelectedSeatIds((current) => current.includes(id) ? current.filter((value) => value !== id) : current.length >= (payload?.max_seats || 6) ? current : [...current, id]);
  };

  const submit = async () => {
    setBusy(true);
    setErrorMessage("");
    try {
      const data = await customerApi<{ order: { id: string } }>(`/api/public/events/${encodeURIComponent(slug)}/orders`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ performance_id: performanceId, seat_ids: selectedSeatIds, accept_terms: acceptTerms }) });
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

  if (loading) return <div className="flex min-h-screen items-center justify-center bg-slate-50 text-sm text-slate-500"><LoaderCircle className="mr-2 h-5 w-5 animate-spin" /> Loading checkout…</div>;
  if (createdOrderId) return <main className="flex min-h-screen items-center justify-center bg-slate-50 px-5"><div className="w-full max-w-lg rounded-3xl border border-emerald-200 bg-white p-8 text-center shadow-sm"><CheckCircle2 className="mx-auto h-12 w-12 text-emerald-500" /><h1 className="mt-5 text-2xl font-bold text-slate-900">Seat held</h1><p className="mt-2 text-sm leading-6 text-slate-600">Order <strong>{createdOrderId}</strong> is waiting for PromptPay payment. Continue in your customer app to view the QR and upload the slip.</p><a href="/app/orders" className="mt-6 inline-flex rounded-xl bg-blue-600 px-5 py-3 text-sm font-semibold text-white hover:bg-blue-700">Open my order</a></div></main>;
  if (!payload) return <main className="flex min-h-screen items-center justify-center bg-slate-50 px-5"><div className="w-full max-w-lg rounded-3xl border border-amber-200 bg-white p-8 text-center"><Ticket className="mx-auto h-10 w-10 text-amber-500" /><h1 className="mt-4 text-xl font-bold text-slate-900">Checkout unavailable</h1><p className="mt-2 text-sm leading-6 text-slate-600">{errorMessage || "This event has not enabled customer checkout yet."}</p><a href="/account/login" className="mt-5 inline-flex rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700">Sign in</a></div></main>;

  return <main className="min-h-screen bg-slate-50 text-slate-900"><header className="border-b border-slate-200 bg-white"><div className="mx-auto flex max-w-5xl items-center justify-between px-5 py-4 sm:px-8"><a href={`/events/${encodeURIComponent(slug)}`} className="inline-flex items-center gap-2 text-sm font-semibold text-slate-600 hover:text-blue-700"><ArrowLeft className="h-4 w-4" /> Event details</a><span className="inline-flex items-center gap-2 text-sm font-bold text-slate-900"><CreditCard className="h-4 w-4 text-blue-600" /> Secure checkout</span></div></header><section className="mx-auto max-w-5xl px-5 py-8 sm:px-8"><div className="mb-8"><p className="text-xs font-bold uppercase tracking-[0.2em] text-blue-600">{payload.event.seller_name || "Event organizer"}</p><h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950">{payload.event.name}</h1><p className="mt-2 text-sm text-slate-600">Select seats, review the total, then pay by PromptPay scan. Your hold lasts about {payload.hold_minutes} minutes.</p></div>{errorMessage && <div className="mb-5 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{errorMessage}</div>}<div className="grid gap-6 lg:grid-cols-[1fr_320px]"><div className="space-y-5 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm"><label className="block"><span className="mb-2 block text-xs font-bold uppercase tracking-[0.14em] text-slate-500">Performance</span><select value={performanceId} onChange={(event) => { setPerformanceId(event.target.value); setSelectedSeatIds([]); }} className="w-full rounded-xl border border-slate-200 px-3 py-3 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-500/20">{payload.performances.map((performance) => <option key={performance.id} value={performance.id}>{performance.title} · {new Date(performance.starts_at).toLocaleString("th-TH")}</option>)}</select></label><div><div className="mb-3 flex items-center justify-between"><h2 className="font-semibold text-slate-900">Available seats</h2><span className="text-xs text-slate-500">Up to {payload.max_seats}</span></div>{seats.length ? <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{seats.map((seat) => { const selected = selectedSeatIds.includes(seat.id); return <button key={seat.id} type="button" onClick={() => toggleSeat(seat.id)} className={`rounded-2xl border px-3 py-3 text-left transition-colors ${selected ? "border-blue-500 bg-blue-50 text-blue-800" : "border-slate-200 hover:border-blue-300"}`}><span className="block text-sm font-semibold">{seat.zone} · {seat.row_label}-{seat.seat_label}</span><span className="mt-1 block text-xs text-slate-500">{money(Number(seat.face_value || 0))}</span></button>; })}</div> : <p className="rounded-2xl bg-slate-50 p-5 text-sm text-slate-500">No seats are currently available for this performance.</p>}</div><label className="flex items-start gap-3 rounded-2xl bg-slate-50 p-4 text-sm text-slate-600"><input type="checkbox" checked={acceptTerms} onChange={(event) => setAcceptTerms(event.target.checked)} className="mt-0.5 h-4 w-4 rounded border-slate-300 text-blue-600" /><span>I accept the event checkout terms and understand that payment is confirmed manually after I upload proof.</span></label></div><aside className="h-fit rounded-3xl border border-slate-200 bg-white p-5 shadow-sm"><h2 className="font-semibold text-slate-900">Order summary</h2><div className="mt-5 space-y-3 text-sm"><div className="flex justify-between text-slate-600"><span>Seats</span><span>{selectedSeatIds.length}</span></div><div className="flex justify-between text-slate-600"><span>Subtotal preview</span><span>{money(subtotal)}</span></div><div className="border-t border-slate-100 pt-3"><p className="text-xs leading-5 text-slate-500">Final fees and tax are calculated and snapshotted by the server before the order is created.</p></div></div>{!payload.promptpay_ready && <p className="mt-5 rounded-xl bg-amber-50 p-3 text-xs leading-5 text-amber-700">PromptPay is not configured yet. The organizer must set PROMPTPAY_ID before accepting payments.</p>}<button type="button" onClick={() => void submit()} disabled={busy || !selectedSeatIds.length || !acceptTerms || !payload.promptpay_ready} className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50">{busy && <LoaderCircle className="h-4 w-4 animate-spin" />} {busy ? "Creating order…" : "Hold seats and continue"}</button></aside></div></section></main>;
}

import { useState, type FormEvent } from "react";

type ApiFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
type Booking = {
  id: string; reference: string; state: string; payment_state: string; version: number;
  total_minor: number; due_ms: number; attendees: number; checked_in: number;
  refunds: { reference: string; amount_minor: number }[];
};
const money = new Intl.NumberFormat(undefined, { style: "currency", currency: "THB" });

export function PaidBookingOperations({ eventId, apiFetch, onChange }: {
  eventId: string; apiFetch: ApiFetch; onChange: () => void;
}) {
  const [reference, setReference] = useState("");
  const [booking, setBooking] = useState<Booking | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const base = `/api/events/${encodeURIComponent(eventId)}/paid-registration/bookings`;

  async function find(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setError(""); setBooking(null);
    try {
      const response = await apiFetch(`${base}/by-reference/${encodeURIComponent(reference.trim())}`);
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Booking not found");
      setBooking(result.booking as Booking);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not load booking"); }
    finally { setBusy(false); }
  }

  async function manage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!booking || busy) return;
    const values = new FormData(event.currentTarget);
    const action = String(values.get("action") || "");
    const reason = String(values.get("reason") || "").trim();
    const label = action === "refund" ? "Record completed full refund and revoke all QR credentials" :
      action === "cancel" ? "Cancel this booking and release its capacity" :
      action === "reinstate" ? "Reinstate this expired booking, subject to live capacity" :
      "Extend this booking's payment deadline";
    if (!window.confirm(`${label}?\nBooking: ${booking.reference}\nReason: ${reason}`)) return;
    const body = {
      action, reason, version: booking.version,
      ...(["extend", "reinstate"].includes(action) ? { hold_minutes: Number(values.get("hold_minutes")) } : {}),
      ...(action === "refund" ? { refund_reference: String(values.get("refund_reference") || "").trim() } : {}),
    };
    setBusy(true); setError("");
    try {
      const response = await apiFetch(`${base}/${encodeURIComponent(booking.id)}/manage`, {
        method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify(body),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Booking update failed");
      setBooking({ ...booking, state: result.status, payment_state: result.payment_status,
        version: result.version, due_ms: Date.parse(result.due_at) });
      onChange();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Booking update failed"); }
    finally { setBusy(false); }
  }
  const actions = booking?.state === "expired" ? ["reinstate"] :
    booking?.state === "confirmed" && booking.payment_state === "verified" && !booking.checked_in ? ["refund"] :
    booking?.state === "awaiting_payment" && booking.due_ms > Date.now() ? ["extend", "cancel"] :
    booking?.state === "verification_pending" || booking?.state === "payment_exception" ? ["cancel"] : [];
  return (
    <section className="space-y-3 rounded-xl border border-slate-200 p-3">
      <h3 className="font-semibold">Booking operations</h3>
      <form className="flex flex-wrap items-end gap-2" onSubmit={find}>
        <label>Booking reference
          <input className="mt-1 block w-full rounded border p-2" required value={reference} onChange={(event) => setReference(event.target.value)} />
        </label>
        <button disabled={busy} className="rounded border px-3 py-2">Find</button>
      </form>
      {booking && <div className="space-y-2">
        <p className="break-all font-medium">{booking.reference}</p>
        <p>{booking.attendees} attendees · {money.format(booking.total_minor / 100)} · {booking.state} / {booking.payment_state}</p>
        <p>Payment deadline: {new Date(booking.due_ms).toLocaleString()} · Checked in: {booking.checked_in}</p>
        {!!booking.refunds?.length && <p>Refund recorded: {booking.refunds.map((item) => item.reference).join(", ")}</p>}
        {actions.length > 0 && <form onSubmit={manage} className="grid max-w-xl gap-2 rounded bg-slate-50 p-3">
          <label>Operation<select name="action" className="ml-2 rounded border p-2" required>
            {actions.map((item) => <option key={item} value={item}>{item}</option>)}
          </select></label>
          <label>Hold duration (minutes, for extend/reinstate)
            <input name="hold_minutes" type="number" min={5} max={43200} defaultValue={1440} className="ml-2 w-28 rounded border p-2" />
          </label>
          <label>Verified refund transfer reference (refund only)
            <input name="refund_reference" className="mt-1 block w-full rounded border p-2" placeholder="Only after the bank has completed the refund" />
          </label>
          <label>Reason
            <input name="reason" required maxLength={1000} className="mt-1 block w-full rounded border p-2" />
          </label>
          <p className="text-xs text-amber-800">Refund records a completed external transfer; it does not send money. It revokes all unscanned QR tickets.</p>
          <button disabled={busy} className="justify-self-start rounded bg-blue-700 px-3 py-2 text-white">Save operation</button>
        </form>}
      </div>}
      {error && <p role="alert" className="text-red-700">{error}</p>}
    </section>
  );
}

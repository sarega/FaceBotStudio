import { PaidBookingOperations } from "./PaidBookingOperations";
import { useEffect, useRef, useState, type FormEvent } from "react";

type Review = {
  booking_id: string;
  attempt_id: string | null;
  booking_reference: string;
  version: number;
  total_minor: number;
  attendee_count: number;
  claimed_minor: number | null;
  proof_id: string | null;
  claimed_transfer_ms: number | null;
  claimed_reference: string | null;
  payment_mode: "promptpay" | "external_manual";
  receiver_name: string | null;
  receiver_last_four: string;
  matching_proofs: number;
  payment_state: string;
  reason: string | null;
};
type ApiFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const money = new Intl.NumberFormat(undefined, { style: "currency", currency: "THB" });
const summaryLabels = {
  bookings: "Bookings", attendees: "Attendees", confirmed_bookings: "Confirmed bookings",
  confirmed_attendees: "Confirmed attendees", checked_in_attendees: "Checked in",
  held_attendees: "Places held", available_attendees: "Places available",
  awaiting_payment_bookings: "Awaiting payment", pending_review_bookings: "Pending review", expired_bookings: "Expired",
  accepted_minor: "Verified total", unsettled_due_minor: "Unsettled booking total",
};
const inputClass = "mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2";

function ReviewForm({ review, path, apiFetch, onUpdated }: { review: Review; path: string; apiFetch: ApiFetch; onUpdated: () => void }) {
  const [decision, setDecision] = useState("approve");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const command = useRef<{ body: string; key: string } | undefined>(undefined);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setError("");
    const data = new FormData(event.currentTarget);
    let observed;
    if (decision === "approve") {
      const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(String(data.get("amount") || "").trim());
      const amount = match ? Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0")) : 0;
      const paidAt = new Date(String(data.get("paid_at")));
      if (!Number.isSafeInteger(amount) || amount <= 0 || !Number.isFinite(paidAt.getTime())) {
        setError("Enter the amount and time shown by the bank.");
        return;
      }
      observed = { amount_minor: amount, currency: "THB", paid_at: paidAt.toISOString(), reference: data.get("reference"),
        receiver_id: review.payment_mode === "external_manual" ? "EXTERNAL_MANUAL" : data.get("receiver") };
    }
    const body = JSON.stringify({ decision, attempt_id: review.attempt_id, version: review.version, reason: data.get("reason"), observed });
    if (command.current?.body !== body) command.current = { body, key: crypto.randomUUID() };
    setBusy(true);
    try {
      const response = await apiFetch(`${path}/review`, {
        method: "POST", body, headers: { "Content-Type": "application/json", "Idempotency-Key": command.current.key },
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        const descriptions: Record<string, string> = {
          duplicate_reference_or_proof: "This reference or image has already been used. Flag the attempt for investigation.",
          receiver_mismatch: "The receiving account does not match the account recorded for this booking.",
          version_conflict: "Another reviewer updated this booking. Refresh the queue.",
        };
        setError(descriptions[result.error] || "Could not save the review. Retry or refresh the queue.");
        return;
      }
      onUpdated();
    } catch {
      setError("Could not reach the server. Retry with the same details.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <fieldset disabled={busy} className="grid gap-3 sm:grid-cols-2">
        <label>Decision<select className={inputClass} value={decision} onChange={(event) => setDecision(event.target.value)}>
          <option value="approve">Record bank verification</option>
          {review.attempt_id && <><option value="reject">Reject proof</option><option value="flag">Flag for investigation</option></>}
        </select></label>
        <label>Review reason<input className={inputClass} name="reason" required maxLength={1000} /></label>
        {decision === "approve" && <>
          <p className="sm:col-span-2">{review.payment_mode === "external_manual"
            ? "Record only payment you have independently verified outside FaceBotStudio. This approves the entire booking and issues attendee QR codes."
            : "Use the posted transfer in your bank records to complete these fields."}</p>
          <label>Amount received (THB)<input className={inputClass} name="amount" inputMode="decimal" required /></label>
          <label>Transfer time (your device’s timezone)<input className={inputClass} name="paid_at" type="datetime-local" step={1} required /></label>
          <label>{review.payment_mode === "external_manual" ? "Unique external payment / receipt reference" : "Bank transaction reference"}
            <input className={inputClass} name="reference" required maxLength={255} /></label>
          {review.payment_mode !== "external_manual" &&
            <label>Receiver identifier<input className={inputClass} name="receiver" inputMode="numeric" maxLength={32} required /></label>}
        </>}
        <button type="submit" className="justify-self-start rounded-lg bg-blue-600 px-3 py-2 font-semibold text-white">
          {busy ? "Saving…" : "Save review"}
        </button>
      </fieldset>
      {error && <p role="alert" className="text-red-700">{error}</p>}
    </form>
  );
}

export function PaidReviewQueue({ eventId, apiFetch }: { eventId: string; apiFetch: ApiFetch }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Review[]>();
  const [error, setError] = useState("");
  const [offset, setOffset] = useState(0);
  const [reference, setReference] = useState("");
  const [summary, setSummary] = useState<Record<string, string | number>>();
  const [summaryError, setSummaryError] = useState(false);
  const [next, setNext] = useState<number | null>(null);
  const [refresh, setRefresh] = useState(0);
  const fetchRef = useRef(apiFetch);
  fetchRef.current = apiFetch;
  const prefix = `/api/events/${encodeURIComponent(eventId)}/paid-registration`;

  useEffect(() => {
    if (!open) return;
    const request = new AbortController();
    setSummaryError(false);
    void fetchRef.current(`${prefix}/summary`, { signal: request.signal }).then(async (response) => {
      if (!response.ok) throw new Error();
      const result = await response.json();
      if (!request.signal.aborted) setSummary(result.summary ?? undefined);
    }).catch(() => { if (!request.signal.aborted) setSummaryError(true); });
    return () => request.abort();
  }, [open, prefix, refresh]);

  useEffect(() => {
    if (!open) return;
    const request = new AbortController();
    setRows(undefined);
    setError("");
    const params = new URLSearchParams({ offset: String(offset) });
    if (reference) params.set("reference", reference);
    void fetchRef.current(`${prefix}/review-queue?${params}`, { signal: request.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error();
        const result = await response.json();
        if (!request.signal.aborted) {
          setRows(result.reviews);
          setNext(result.next_offset);
        }
      }).catch(() => { if (!request.signal.aborted) setError("Could not load the review queue."); });
    return () => request.abort();
  }, [open, offset, prefix, reference, refresh]);

  return (
    <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-800">
      <div className="flex items-center gap-4">
        <button type="button" className="font-semibold text-blue-700 underline" aria-expanded={open} onClick={() => setOpen(!open)}>Paid registration reviews</button>
        {open && <button type="button" className="underline" onClick={() => setRefresh((value) => value + 1)}>Refresh</button>}
      </div>
      {open && <>
        <PaidBookingOperations eventId={eventId} apiFetch={apiFetch} onChange={() => setRefresh((value) => value + 1)} />
        {summaryError && <p role="alert" className="text-red-700">Could not load the registration totals.</p>}
        {summary && <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {Object.entries(summaryLabels).map(([key, label]) => (
            <div key={key} className="rounded-lg bg-slate-50 p-2">
              <dt className="text-slate-600">{label}</dt>
              <dd className="font-semibold">{key.endsWith("_minor") ? money.format(Number(summary[key]) / 100) : summary[key]}</dd>
            </div>
          ))}
        </dl>}
        <form className="flex flex-wrap items-end gap-2" onSubmit={(event) => {
          event.preventDefault();
          setReference(String(new FormData(event.currentTarget).get("reference") || "").trim());
          setOffset(0);
          setRefresh((value) => value + 1);
        }}>
          <label>Booking reference<input name="reference" className={inputClass} maxLength={36} /></label>
          <button type="submit" className="rounded-lg border border-slate-300 px-3 py-2">Find booking</button>
        </form>
        {error && <p role="alert" className="text-red-700">{error}</p>}
        {!rows && !error && <p role="status">Loading reviews…</p>}
        {rows?.length === 0 && <p>{reference ? "No payable or pending booking found for this reference." : "No payment proofs awaiting review."}</p>}
        {rows?.map((review) => {
          const path = `${prefix}/bookings/${encodeURIComponent(review.booking_id)}`;
          return (
            <details key={review.attempt_id ?? review.booking_id} className="space-y-3 border-t border-slate-200 pt-3">
              <summary className="cursor-pointer break-all">{review.booking_reference} · {review.attendee_count} attendees · {money.format(review.total_minor / 100)}</summary>
              {review.claimed_minor != null && review.claimed_transfer_ms != null
                ? <p>Claimed {money.format(review.claimed_minor / 100)} · {new Date(review.claimed_transfer_ms).toLocaleString()} {review.claimed_reference ? `· ${review.claimed_reference}` : ""}</p>
                : <p>{review.attempt_id ? "Recorded from bank records." : "Awaiting payment."}</p>}
              <p>Receiver {review.receiver_name} · ending {review.receiver_last_four}</p>
              {!!review.matching_proofs && <p className="font-semibold text-amber-800">This image matches another submitted proof.</p>}
              {review.reason && <p>Previous review · {review.reason}</p>}
              {review.proof_id && review.attempt_id && <a href={`${path}/proofs/${encodeURIComponent(review.attempt_id)}`} target="_blank" rel="noopener noreferrer" className="text-blue-700 underline">Open payment proof</a>}
              <ReviewForm key={review.version} review={review} path={path} apiFetch={apiFetch} onUpdated={() => { setOffset(0); setRefresh((value) => value + 1); }} />
            </details>
          );
        })}
        {rows && <div className="flex gap-4">
          {offset > 0 && <button type="button" className="underline" onClick={() => setOffset(Math.max(0, offset - 20))}>Previous</button>}
          {next != null && <button type="button" className="underline" onClick={() => setOffset(next)}>Next</button>}
        </div>}
      </>}
    </section>
  );
}

import { useEffect, useRef, useState, type FormEvent } from "react";
import { customerApi } from "./CustomerAccountScreen";

type Booking = {
  id: string;
  event_id: string;
  event_name: string;
  reference: string;
  status: string;
  total_due_minor: number;
  due_at: string;
};
type Detail = { status: string; version: number; payment_state: string; payment_mode: "promptpay" | "external_manual"; attendees: { id: string; first_name: string; last_name: string; category_label: string }[] };
type Page = { bookings: Booking[]; next_offset: number | null };

function PaidProofForm({ path, version, totalMinor, onSubmitted }: {
  path: string; version: number; totalMinor: number; onSubmitted: () => void;
}) {
  const [file, setFile] = useState<File>();
  const [amount, setAmount] = useState((totalMinor / 100).toFixed(2));
  const [paidAt, setPaidAt] = useState("");
  const [reference, setReference] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const command = useRef<{ signature: string; file: File; key: string } | undefined>(undefined);
  const submitting = useRef(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current || !file) return;
    const parts = /^(\d+)(?:\.(\d{1,2}))?$/.exec(amount.trim());
    const minor = parts ? Number(parts[1]) * 100 + Number((parts[2] ?? "").padEnd(2, "0")) : 0;
    const transferTime = new Date(paidAt);
    if (!Number.isSafeInteger(minor) || minor < 1 || !Number.isFinite(transferTime.getTime()) ||
        file.size < 1 || file.size > 4 * 1024 * 1024 || !["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setError("Enter the transferred amount and time and select a JPEG, PNG or WebP up to 4 MB.");
      return;
    }
    setError("");
    const claimedDate = transferTime.toISOString();
    const normalizedRef = reference.trim();
    if (normalizedRef && !/^[!-~]+$/.test(normalizedRef)) {
      setError("Use the transfer reference shown by your bank, without spaces or special characters outside ASCII.");
      return;
    }
    const signature = JSON.stringify([version, minor, claimedDate, normalizedRef]);
    if (command.current?.file !== file || command.current.signature !== signature) {
      command.current = { file, signature, key: crypto.randomUUID() };
    }
    submitting.current = true;
    setBusy(true);
    try {
      await customerApi(`${path}/proofs`, {
        method: "POST", body: file,
        headers: {
          "Content-Type": "application/octet-stream", "Idempotency-Key": command.current.key,
          "x-booking-version": String(version), "x-claimed-minor": String(minor),
          "x-claimed-transfer-at": claimedDate, "x-payment-method": "promptpay",
          "x-proof-mime": file.type, "x-payment-reference": normalizedRef,
        },
      });
      onSubmitted();
    } catch {
      setError("Could not submit the proof. Retry with the same details or refresh to check the booking status.");
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  const input = "mt-1 block w-full rounded-lg border border-white/20 bg-slate-950 px-3 py-2 text-white";
  return (
    <form onSubmit={submit} className="space-y-3 rounded-xl border border-white/10 p-3">
      <img src={`${path}/payment-qr`} alt="PromptPay payment QR for this booking" className="h-40 w-40 rounded-lg bg-white p-2" />
      <p className="text-slate-300">Pay the full booking amount in one transfer, then upload the receipt for manual review.</p>
      <fieldset disabled={busy} className="space-y-3">
        <label className="block">Amount transferred (THB)
          <input className={input} inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} required />
        </label>
        <label className="block">Transfer date and time (your device’s timezone)
          <input className={input} type="datetime-local" value={paidAt} onChange={(event) => setPaidAt(event.target.value)} required />
        </label>
        <label className="block">Bank reference (optional)
          <input className={input} maxLength={255} value={reference} onChange={(event) => setReference(event.target.value)} />
        </label>
        <label className="block">Payment proof
          <input className={input} type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => setFile(event.target.files?.[0])} required />
        </label>
        <button type="submit" className="rounded-lg bg-blue-600 px-3 py-2 font-semibold text-white">{busy ? "Submitting…" : "Submit payment proof"}</button>
      </fieldset>
      {error && <p role="alert" className="text-rose-300">{error}</p>}
    </form>
  );
}

export function CustomerPaidBookings() {
  const [reference, setReference] = useState(() => {
    const value = new URLSearchParams(window.location.search).get("paid_booking") || "";
    return /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value) ? value : "";
  });
  const [page, setPage] = useState<Page>();
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<Booking>();
  const [detail, setDetail] = useState<Detail>();
  const [error, setError] = useState("");
  useEffect(() => {
    const request = new AbortController();
    setPage(undefined);
    setError("");
    const params = new URLSearchParams({ offset: String(offset) });
    if (reference) params.set("reference", reference);
    void customerApi<Page>(`/api/customer/paid-bookings?${params}`, { signal: request.signal })
      .then((result) => {
        if (request.signal.aborted) return;
        setPage(result);
        if (reference) setSelected(result.bookings[0]);
      }).catch(() => { if (!request.signal.aborted) setError("Could not load paid registrations."); });
    return () => request.abort();
  }, [offset, reference]);
  useEffect(() => {
    setDetail(undefined);
    if (!selected) return;
    const request = new AbortController();
    void customerApi<Detail>(`/api/customer/paid-bookings/${encodeURIComponent(selected.event_id)}/${encodeURIComponent(selected.id)}`, { signal: request.signal })
      .then(setDetail).catch(() => { if (!request.signal.aborted) setError("Could not load attendees."); });
    return () => request.abort();
  }, [selected]);

  return (
    <section className="space-y-4 rounded-3xl border border-white/10 bg-slate-900/50 p-5 text-slate-200">
      <h2 className="font-semibold text-white">Paid registrations</h2>
      {reference && <button type="button" className="text-sm text-blue-300 underline" onClick={() => {
        setReference("");
        setSelected(undefined);
        window.history.replaceState(window.history.state, "", "/app/orders");
      }}>Show all paid registrations</button>}
      {error && <p role="alert" className="text-sm text-rose-300">{error}</p>}
      {!page && !error && <p role="status" className="text-sm">Loading bookings…</p>}
      {page?.bookings.length === 0 && <p className="text-sm text-slate-400">{reference ? "This booking is unavailable for your account." : "No paid registrations yet."}</p>}
      {page?.bookings.map((booking) => (
        <article key={booking.id} className="space-y-2 border-t border-white/10 pt-3 text-sm">
          <h3 className="font-semibold">{booking.event_name}</h3>
          <p className="break-all text-slate-400">{booking.reference}</p>
          <p>{booking.status.replaceAll("_", " ")} · {new Intl.NumberFormat(undefined, { style: "currency", currency: "THB" }).format(booking.total_due_minor / 100)}</p>
          {booking.status === "awaiting_payment" && <p>Pay by {new Date(booking.due_at).toLocaleString()}</p>}
          <button type="button" aria-expanded={selected?.id === booking.id} className="text-blue-300 underline"
            onClick={() => { setError(""); setDetail(undefined); setSelected(selected?.id === booking.id ? undefined : booking); }}>Booking details</button>
          {selected?.id === booking.id && detail && (
            <div className="space-y-3">
            <ul className="space-y-1">{detail.attendees.map((attendee) => (
              <li key={attendee.id}>
                {attendee.first_name} {attendee.last_name} · {attendee.category_label}
                {detail.status === "confirmed" && (
                  <a className="ml-2 text-blue-300 underline" target="_blank" rel="noopener noreferrer"
                    href={`/api/customer/paid-bookings/${encodeURIComponent(booking.event_id)}/${encodeURIComponent(booking.id)}/attendees/${encodeURIComponent(attendee.id)}/credential`}>
                    Admission QR
                  </a>
                )}
              </li>
            ))}</ul>
            {detail.status === "awaiting_payment" && detail.payment_mode === "external_manual" && (
              <p role="status" className="rounded-lg border border-blue-500/40 bg-blue-950/40 p-3 text-sm">
                Your place is reserved until the payment deadline. Please pay through the organizer's external instructions.
                No bank details or slip upload is required here. The organizer will confirm payment manually;
                attendee admission QR codes appear after confirmation.
              </p>
            )}
            {detail.status === "awaiting_payment" && detail.payment_mode !== "external_manual" && (
              <PaidProofForm key={booking.id} path={`/api/customer/paid-bookings/${encodeURIComponent(booking.event_id)}/${encodeURIComponent(booking.id)}`}
                version={detail.version} totalMinor={booking.total_due_minor} onSubmitted={() => {
                  const updated = { ...booking, status: "verification_pending" };
                  setDetail(undefined);
                  setSelected(updated);
                  setPage((current) => current && { ...current, bookings: current.bookings.map((row) => row.id === booking.id ? updated : row) });
                }} />
            )}
            {detail.status === "verification_pending" && <p role="status">Payment proof is pending verification.</p>}
            </div>
          )}
        </article>
      ))}
      {page && (offset > 0 || page.next_offset != null) && (
        <div className="flex gap-4 text-sm">
          {offset > 0 && <button type="button" className="underline" onClick={() => { setSelected(undefined); setOffset(Math.max(0, offset - 20)); }}>Previous</button>}
          {page.next_offset != null && <button type="button" className="underline" onClick={() => { setSelected(undefined); setOffset(page.next_offset!); }}>Next</button>}
        </div>
      )}
    </section>
  );
}

import { useEffect, useRef, useState, type FormEvent } from "react";
import { customerApi } from "./CustomerAccountScreen";

type Booking = {
  id: string;
  event_id: string;
  event_name: string;
  event_slug: string;
  reference: string;
  status: string;
  total_due_minor: number;
  due_at: string;
};
type Detail = { status: string; version: number; payment_state: string; payment_mode: "promptpay" | "external_manual"; attendees: { id: string; first_name: string; last_name: string; category_label: string; unit_minor: number; base_minor?: number; accommodation_discount_minor?: number }[] };
type Page = { bookings: Booking[]; next_offset: number | null };

function PaidProofForm({ path, version, totalMinor, paymentMode, onSubmitted }: {
  path: string; version: number; totalMinor: number; paymentMode: "promptpay" | "external_manual"; onSubmitted: () => void;
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
          "x-claimed-transfer-at": claimedDate, "x-payment-method": paymentMode === "external_manual" ? "bank_transfer" : "promptpay",
          "x-proof-mime": file.type, "x-payment-reference": normalizedRef,
        },
      });
      onSubmitted();
    } catch (failure) {
      const code = failure instanceof Error ? failure.message : "";
      setError(code === "proof_storage_unavailable"
        ? "ยังไม่เปิดระบบเก็บสลิปอย่างปลอดภัย กรุณาติดต่อผู้จัดงาน / Secure slip upload is not configured."
        : code === "hold_expired"
          ? "หมดเวลาชำระเงินแล้ว กรุณาติดต่อผู้จัดงาน / Payment deadline has passed."
          : "ส่งสลิปไม่สำเร็จ กรุณาลองใหม่ / Slip upload failed. Please retry.");
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  const input = "mt-1 block w-full rounded-lg border border-white/20 bg-slate-950 px-3 py-2 text-white";
  return (
    <form onSubmit={submit} className="space-y-3 rounded-xl border border-white/10 p-3">
      {paymentMode === "promptpay" && <img src={`${path}/payment-qr`} alt="PromptPay payment QR for this booking" className="h-40 w-40 rounded-lg bg-white p-2" />}
      <p className="text-slate-300">โอนเงินแล้วแนบสลิป / Transfer the full amount, then upload your payment slip.</p>
      <fieldset disabled={busy} className="space-y-3">
        <label className="block">จำนวนเงินที่โอน / Amount (THB)
          <input className={input} inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} required />
        </label>
        <label className="block">วันเวลาโอน / Transfer date and time
          <input className={input} type="datetime-local" value={paidAt} onChange={(event) => setPaidAt(event.target.value)} required />
        </label>
        <label className="block">เลขอ้างอิงธนาคาร (ถ้ามี) / Bank reference (optional)
          <input className={input} maxLength={255} value={reference} onChange={(event) => setReference(event.target.value)} />
        </label>
        <label className="block">สลิปชำระเงิน / Payment slip
          <input className={input} type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => setFile(event.target.files?.[0])} required />
        </label>
        <button type="submit" className="rounded-lg bg-blue-600 px-3 py-2 font-semibold text-white">{busy ? "กำลังส่ง… / Submitting…" : "ส่งสลิป / Submit payment slip"}</button>
      </fieldset>
      {error && <p role="alert" className="text-rose-300">{error}</p>}
    </form>
  );
}

type PaymentDisplay = { bank_name: string; account_name: string; account_number: string; qr_png_base64: string };
function ExternalPaymentInstructions({ eventId, bookingId }: { eventId: string; bookingId: string }) {
  const [details,setDetails] = useState<PaymentDisplay>();
  const [loading,setLoading] = useState(true);
  useEffect(() => {
    const abort = new AbortController();
    void customerApi<PaymentDisplay>("/api/customer/paid-bookings/" + encodeURIComponent(eventId) + "/" +
      encodeURIComponent(bookingId) + "/payment-display", {signal:abort.signal})
      .then(setDetails).catch(() => undefined).finally(() => {
        if (!abort.signal.aborted) setLoading(false);
      });
    return () => abort.abort();
  },[eventId,bookingId]);
  if (loading) return <p role="status" className="text-sm text-slate-300">กำลังโหลดบัญชีรับเงิน / Loading payment details…</p>;
  if (!details || !(details.account_name && (details.account_number || details.qr_png_base64))) {
    return <p role="alert" className="rounded-lg border border-amber-600/40 bg-amber-900/30 p-3 text-sm text-amber-100">
      ยังไม่มีข้อมูลบัญชีรับเงิน กรุณาติดต่อผู้จัดงานก่อนโอน<br />
      Payment details are incomplete. Contact the organizer before transferring.
    </p>;
  }
  return <div className="space-y-2 rounded-lg border border-white/20 p-3 text-sm">
    <strong>ชำระเงิน / Bank transfer details</strong>
    {!!details.bank_name && <p>ธนาคาร / Bank: {details.bank_name}</p>}
    {!!details.account_name && <p>ชื่อบัญชี / Recipient: <strong>{details.account_name}</strong></p>}
    {!!details.account_number && <p>เลขบัญชี / Account: <span className="font-mono font-semibold">{details.account_number}</span></p>}
    {!!details.qr_png_base64 && <div className="space-y-1">
      <img src={"data:image/png;base64," + details.qr_png_base64} alt="Organizer-provided payment QR code"
        className="block h-auto w-full max-w-72 rounded-xl bg-white p-3 object-contain" />
      <a href={"data:image/png;base64," + details.qr_png_base64} download="meetrix-payment-qr.png"
        className="inline-flex min-h-11 items-center rounded-lg border border-blue-400/50 px-4 py-2 text-sm font-semibold text-blue-200 underline underline-offset-2">
        บันทึก QR / Save QR image
      </a>
      <p className="text-xs">ใช้มือถือเครื่องเดียว: บันทึก QR แล้วนำเข้าแอปธนาคาร / Same phone: save the QR, then import it in your banking app.</p>
      <p className="text-xs">ตรวจชื่อผู้รับและยอดเงินก่อนโอน / Verify the recipient and amount.</p>
    </div>}
    <p className="text-xs text-slate-300">บัตรเข้างานจะออกหลังผู้จัดงานยืนยันยอดเงินจริง / Admission QR follows payment verification.</p>
  </div>;
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
  const [reactivating, setReactivating] = useState<string>();
  const paymentAnchorRef = useRef<HTMLDivElement>(null);
  const didScrollToInvoice = useRef(false);
  useEffect(() => {
    if (!reference || !detail || !selected || didScrollToInvoice.current) return;
    didScrollToInvoice.current = true;
    paymentAnchorRef.current?.scrollIntoView({ behavior: "auto", block: "start" });
  }, [reference, detail, selected]);
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

  async function reactivate(booking: Booking) {
    if (reactivating) return;
    setReactivating(booking.id);
    setError("");
    try {
      const result = await customerApi<{ status: string; due_at: string }>(
        "/api/customer/paid-bookings/" + encodeURIComponent(booking.event_id) + "/" +
        encodeURIComponent(booking.id) + "/reinstate", { method: "POST" },
      );
      const updated = { ...booking, status: result.status, due_at: result.due_at };
      setPage((previous) => previous && { ...previous,
        bookings: previous.bookings.map((entry) => entry.id === booking.id ? updated : entry) });
      setSelected(updated);
      setDetail(undefined);
      didScrollToInvoice.current = false;
    } catch (failure) {
      const code = failure instanceof Error ? failure.message : "";
      setError(code === "capacity_exhausted"
        ? "ที่นั่งเต็มแล้ว กรุณาติดต่อผู้จัดงาน / No capacity available for this booking."
        : code === "registration_unavailable" || code === "hold_expired"
          ? "ปิดรับลงทะเบียนแล้ว กรุณาติดต่อผู้จัดงาน / Registration window is closed."
          : code === "state_conflict"
            ? "สถานะเปลี่ยนไปแล้ว โปรดรีเฟรช / Booking state changed; please refresh."
            : "เปิดรายการอีกครั้งไม่สำเร็จ / Could not reactivate this booking.");
    } finally {
      setReactivating(undefined);
    }
  }

  return (
    <section className="space-y-4 rounded-3xl border border-white/10 bg-slate-900/50 p-5 text-slate-200">
      <h2 className="font-semibold text-white">Paid registrations</h2>
      {reference && <button type="button" className="text-sm text-blue-300 underline" onClick={() => {
        setReference("");
        didScrollToInvoice.current = false;
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
          {booking.status === "expired" && (
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-amber-200">หมดเวลาชำระเงิน / Payment hold expired</p>
              <button type="button" disabled={!!reactivating}
                className="inline-flex min-h-11 items-center rounded-lg bg-blue-600 px-4 py-2 font-semibold text-white hover:bg-blue-500 disabled:opacity-50"
                onClick={() => void reactivate(booking)}>
                {reactivating === booking.id ? "กำลังเปิดรายการ… / Reopening…" : "เปิดรายการอีกครั้ง / Reactivate booking"}
              </button>
            </div>
          )}
          <a href={booking.event_slug ? "/events/" + encodeURIComponent(booking.event_slug) : "/events"}
            className="inline-flex min-h-10 items-center text-blue-300 underline">
            ลงทะเบียนเพิ่ม / Book more attendees
          </a>
          <button type="button" aria-expanded={selected?.id === booking.id} className="text-blue-300 underline"
            onClick={() => { setError(""); setDetail(undefined); setSelected(selected?.id === booking.id ? undefined : booking); }}>
            {booking.status === "awaiting_payment" ? "ใบแจ้งชำระเงิน / Payment invoice" : "รายละเอียดการจอง / Booking details"}
          </button>
          {selected?.id === booking.id && detail && (
            <div ref={paymentAnchorRef} className="scroll-mt-4 space-y-3" aria-label="Payment and booking details">
            <ul className="space-y-1">{detail.attendees.map((attendee) => (
              <li key={attendee.id}>
                {attendee.first_name} {attendee.last_name} · {attendee.category_label} ·
                {" "}{new Intl.NumberFormat("th-TH", { style: "currency", currency: "THB" }).format(attendee.unit_minor / 100)}
                {!!attendee.accommodation_discount_minor && (
                  <span className="ml-2 text-emerald-300">
                    (No accommodation: −{new Intl.NumberFormat("th-TH", { style: "currency", currency: "THB" })
                      .format(attendee.accommodation_discount_minor / 100)})
                  </span>
                )}
                {detail.status === "confirmed" && (
                  <a className="ml-2 text-blue-300 underline" target="_blank" rel="noopener noreferrer"
                    href={`/api/customer/paid-bookings/${encodeURIComponent(booking.event_id)}/${encodeURIComponent(booking.id)}/attendees/${encodeURIComponent(attendee.id)}/credential`}>
                    Admission QR
                  </a>
                )}
              </li>
            ))}</ul>
            {detail.status === "awaiting_payment" && <>
              <p className="font-semibold">ใบแจ้งชำระเงิน / Payment invoice · {new Intl.NumberFormat("th-TH",{style:"currency",currency:"THB"}).format(booking.total_due_minor / 100)}</p>
              {detail.payment_mode === "external_manual" && <ExternalPaymentInstructions eventId={booking.event_id} bookingId={booking.id} />}
              <PaidProofForm key={booking.id} path={"/api/customer/paid-bookings/" + encodeURIComponent(booking.event_id) + "/" + encodeURIComponent(booking.id)}
                paymentMode={detail.payment_mode} version={detail.version} totalMinor={booking.total_due_minor} onSubmitted={() => {
                  const updated = { ...booking, status: "verification_pending" };
                  setDetail(undefined);
                  setSelected(updated);
                  setPage((current) => current && { ...current, bookings: current.bookings.map((row) => row.id === booking.id ? updated : row) });
                }} />
            </>}
            {detail.status === "verification_pending" && <p role="status">รับสลิปแล้ว รอการตรวจสอบ / Slip received. Awaiting verification.</p>}
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

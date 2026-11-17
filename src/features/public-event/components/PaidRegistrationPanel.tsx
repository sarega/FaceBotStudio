import { paidSeminarFields, type PaidSeminarField } from "../../../../backend/paidSeminarFields";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { customerApi, type CustomerAccount } from "../../customer-account/components/CustomerAccountScreen";

type Catalog = { payment_mode?: "promptpay" | "external_manual"; pricing_version: number; fields: PaidSeminarField[]; categories: { id: string; label: string; unit_minor: number }[] };
type Attendee = { category_id: string; first_name: string; last_name: string; answers?: Record<string, string> };
type Booking = { id: string; event_id: string; reference: string; status: string; total_due_minor: number; due_at: string };

const field = "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900";
const money = new Intl.NumberFormat("en-TH", { style: "currency", currency: "THB" });
const errors: Record<string, string> = {
  CUSTOMER_NOT_AUTHENTICATED: "Sign in with your customer account to book.",
  "Verified customer account required": "Verify your customer email before booking.",
  capacity_exhausted: "There is not enough capacity for this group.",
  quote_stale: "The registration form has changed. Refresh the page before booking.",
  invalid_seminar_answers: "Check the seminar answers and complete the required fields.",
  CUSTOMER_APP_DISABLED: "Registration is currently unavailable.",
};

function SeminarInputs({ fields, values, onChange }: {
  fields: PaidSeminarField[]; values?: Record<string, string>; onChange: (key: string, value: string) => void;
}) {
  return fields.map(({ key, required }) => {
    const definition = paidSeminarFields[key];
    const value = values?.[key] ?? "";
    return <label key={key} className="block text-sm">
      {definition.label}{required ? " *" : ""}
      {definition.type === "boolean" ? (
        <select className={field} required={required} value={value} onChange={(event) => onChange(key, event.target.value)}>
          <option value="">Select</option><option value="yes">Yes</option><option value="no">No</option>
        </select>
      ) : definition.type === "date" ? (
        <input className={field} type="date" required={required} value={value} onChange={(event) => onChange(key, event.target.value)} />
      ) : (
        <input className={field} maxLength={500} required={required} value={value} onChange={(event) => onChange(key, event.target.value)} />
      )}
    </label>;
  });
}

export function PaidRegistrationPanel({ slug, eventId, enabled, timezone }: { slug: string; eventId: string; enabled: boolean; timezone: string }) {
  const [catalog, setCatalog] = useState<Catalog>();
  const [customerAccount, setCustomerAccount] = useState<CustomerAccount | null>(null);
  const [accountLoading, setAccountLoading] = useState(true);
  const [contact, setContact] = useState("");
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [attendees, setAttendees] = useState<Attendee[]>([]);
  const [booking, setBooking] = useState<Booking>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [messengerCode, setMessengerCode] = useState("");
  const [messengerMessage, setMessengerMessage] = useState("");
  const [messengerBusy, setMessengerBusy] = useState(false);
  const command = useRef<{ request: string; key: string } | undefined>(undefined);
  const prefix = `/api/public/events/${encodeURIComponent(slug)}`;
  const recoveryKey = `paid-booking:${slug}`;

  useEffect(() => {
    const controller = new AbortController();
    let generation = 0;
    async function refreshAccount() {
      const current = ++generation;
      setAccountLoading(true);
      try {
        const response = await customerApi<{account: CustomerAccount}>("/api/customer/account/me", {
          signal: controller.signal,
        });
        if (controller.signal.aborted || current !== generation) return;
        setCustomerAccount(response.account);
        setContact((old) => old || [response.account.first_name, response.account.last_name].filter(Boolean).join(" "));
      } catch {
        if (controller.signal.aborted || current !== generation) return;
        setCustomerAccount(null);
      } finally {
        if (!controller.signal.aborted && current === generation) setAccountLoading(false);
      }
    }
    void refreshAccount();
    const onFocus = () => { void refreshAccount(); };
    const onVisible = () => {
      if (document.visibilityState === "visible") void refreshAccount();
    };
    window.addEventListener("focus", onFocus);
    window.addEventListener("customer-session-changed", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      controller.abort();
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("customer-session-changed", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const saved = localStorage.getItem(recoveryKey);
    if (saved && /^[\w-]+\/[\w-]+$/.test(saved)) {
      void customerApi<Booking>(`/api/customer/paid-bookings/${saved}`, { signal: controller.signal })
        .then(setBooking).catch(() => undefined);
    }
    if (enabled) {
      void customerApi<Catalog>(`${prefix}/paid-registration`, { signal: controller.signal }).then((data) => {
        setCatalog(data);
        if (data.categories[0]) setAttendees([{ category_id: data.categories[0].id, first_name: "", last_name: "" }]);
      }).catch(() => { if (!controller.signal.aborted) setError("Registration is currently unavailable."); });
    }
    return () => controller.abort();
  }, [enabled, prefix, recoveryKey]);

  function update(index: number, values: Partial<Attendee>) {
    setAttendees((rows) => rows.map((row, rowIndex) => rowIndex === index ? { ...row, ...values } : row));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || !catalog) return;
    setBusy(true);
    setError("");
    const request = JSON.stringify({ pricing_version: catalog.pricing_version, contact: { name: contact }, answers, attendees });
    if (command.current?.request !== request) command.current = { request, key: crypto.randomUUID() };
    try {
      const result = await customerApi<Booking>(`${prefix}/paid-bookings`, {
        method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": command.current.key }, body: request,
      });
      setBooking(result);
      localStorage.setItem(recoveryKey, `${result.event_id}/${result.id}`);
      // The next step is the private payment invoice, not a bare booking reference.
      window.location.assign("/app/orders?paid_booking=" + encodeURIComponent(result.reference));
    } catch (failure) {
      const message = failure instanceof Error ? failure.message : "";
      setError(errors[message] || "The booking could not be completed. Retry to check the result.");
    } finally {
      setBusy(false);
    }
  }

  async function updateMessenger(method: "POST" | "DELETE") {
    setMessengerBusy(true);
    setMessengerCode("");
    setMessengerMessage("");
    try {
      const result = await customerApi<{ command?: string }>(
        `/api/customer/paid-bookings/${encodeURIComponent(eventId)}/messenger-link`, { method },
      );
      setMessengerCode(result.command || "");
      if (method === "DELETE") setMessengerMessage("Messenger disconnected for this event.");
    } catch (failure) {
      const message = failure instanceof Error ? failure.message : "";
      setMessengerMessage(errors[message] || "Messenger linking is unavailable.");
    } finally {
      setMessengerBusy(false);
    }
  }

  const total = attendees.reduce((sum, row) => sum + (catalog?.categories.find(({ id }) => id === row.category_id)?.unit_minor ?? 0), 0);
  return (
    <div className="surface-panel space-y-3 rounded-2xl p-3 sm:p-4">
      <h2 className="text-lg font-semibold">ลงทะเบียน / Registration</h2>
      <section className="paid-signup-card space-y-2 rounded-xl p-3" aria-label="Account access">
        {accountLoading ? (
          <p className="paid-signup-hint text-sm" role="status">กำลังตรวจสอบบัญชี / Checking account…</p>
        ) : customerAccount ? (
          <>
            <p className="paid-signup-hint text-sm">
              <strong>เข้าสู่ระบบแล้ว / Signed in</strong>
              <span className="mt-1 block break-words">{customerAccount.first_name} {customerAccount.last_name}</span>
              <span className="block break-all text-xs">{customerAccount.email}</span>
            </p>
            {!customerAccount.email_verified_at && (
              <p className="paid-signup-note rounded-lg p-2 text-sm">
                กรุณายืนยันอีเมลก่อนจอง / Verify your email before booking.
              </p>
            )}
            <a className="paid-signup-primary inline-flex min-h-11 items-center justify-center rounded-lg px-4 py-2.5 text-center text-sm font-semibold"
               href="#public-registration-form">
              ลงทะเบียนเข้างาน / Book places
            </a>
          </>
        ) : (
          <>
            <p className="paid-signup-hint text-sm">
              สมัครบัญชีและยืนยันอีเมลก่อนจอง<br />
              Create an account and verify your email.
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              <a className="paid-signup-primary inline-flex min-h-11 items-center justify-center rounded-lg px-3 py-2.5 text-center text-sm font-semibold"
                 href="/account/register" target="_blank" rel="noopener noreferrer">
                สมัครบัญชี / Register
              </a>
              <a className="paid-signup-secondary inline-flex min-h-11 items-center justify-center rounded-lg px-3 py-2.5 text-center text-sm font-semibold"
                 href="/account/login" target="_blank" rel="noopener noreferrer">
                เข้าสู่ระบบ / Sign in
              </a>
            </div>
          </>
        )}
      </section>
      {catalog?.payment_mode === "external_manual" && <p role="status" className="paid-signup-note rounded-lg p-3 text-sm">
        ชำระเงินภายนอก · ผู้จัดงานยืนยันภายหลัง<br />
        Pay externally · Organizer confirms payment.
      </p>}
      {booking ? (
        <div role="status" className="space-y-2 text-sm text-slate-700">
          <p className="font-semibold">{booking.status.replaceAll("_", " ")}</p>
          <p className="break-all">Booking reference {booking.reference}</p>
          {booking.status === "awaiting_payment" && <a className="paid-signup-primary inline-flex rounded-lg px-4 py-3 font-semibold"
            href={"/app/orders?paid_booking=" + encodeURIComponent(booking.reference)}>
            ชำระเงิน / Continue to payment
          </a>}
          <p>Total due {money.format(booking.total_due_minor / 100)}</p>
          <a className="text-blue-700 underline" href={`/app/orders?paid_booking=${encodeURIComponent(booking.reference)}`}>Open booking in Orders</a>
          {booking.status === "awaiting_payment" && <p>Pay by {new Intl.DateTimeFormat(undefined, {
            dateStyle: "medium", timeStyle: "short", timeZone: timezone,
          }).format(new Date(booking.due_at))} ({timezone})</p>}
        </div>
      ) : enabled && catalog && attendees.length > 0 ? (
        <form id="public-registration-form" onSubmit={submit} className="scroll-mt-24 space-y-4">
          <fieldset disabled={busy} className="space-y-3">
            <label className="block text-sm font-medium">Primary contact name
              <input className={field} required maxLength={180} value={contact} onChange={(event) => setContact(event.target.value)} />
            </label>
            <SeminarInputs fields={catalog.fields.filter(({ scope }) => scope === "booking")} values={answers}
              onChange={(key, value) => setAnswers((current) => ({ ...current, [key]: value }))} />
            {attendees.map((row, index) => (
              <fieldset key={index} className="space-y-2 rounded-xl border border-slate-200 p-3">
                <legend className="px-1 text-sm font-semibold">Attendee {index + 1}</legend>
                <label className="block text-sm">Category
                  <select className={field} value={row.category_id} onChange={(event) => update(index, { category_id: event.target.value })}>
                    {catalog.categories.map((category) => <option key={category.id} value={category.id}>{category.label} · {money.format(category.unit_minor / 100)}</option>)}
                  </select>
                </label>
                <label className="block text-sm">First name
                  <input className={field} required maxLength={180} value={row.first_name} onChange={(event) => update(index, { first_name: event.target.value })} />
                </label>
                <label className="block text-sm">Last name
                  <input className={field} required maxLength={180} value={row.last_name} onChange={(event) => update(index, { last_name: event.target.value })} />
                </label>
                <SeminarInputs fields={catalog.fields.filter(({ scope }) => scope === "attendee")} values={row.answers}
                  onChange={(key, value) => update(index, { answers: { ...row.answers, [key]: value } })} />
                {attendees.length > 1 && <button type="button" onClick={() => setAttendees((rows) => rows.filter((_, rowIndex) => rowIndex !== index))} className="text-sm text-blue-700 underline">Remove attendee</button>}
              </fieldset>
            ))}
            {attendees.length < 100 && <button type="button" onClick={() => setAttendees((rows) => [...rows, { category_id: catalog.categories[0].id, first_name: "", last_name: "" }])} className="text-sm text-blue-700 underline">Add attendee</button>}
            <p className="font-semibold">Total due {money.format(total / 100)}</p>
            <button className="w-full rounded-xl bg-blue-600 px-4 py-3 font-semibold text-white" type="submit">{busy ? "Reserving…" : "Reserve places"}</button>
          </fieldset>

        </form>
      ) : <p role="status" className="text-sm text-slate-700">{enabled && !error ? "กำลังโหลด / Loading…" : "ยังไม่เปิดรับจอง / Booking not open yet"}</p>}
      {catalog?.payment_mode !== "external_manual" && (
      <details className="space-y-2 border-t border-slate-200 pt-3 text-sm text-slate-700">
        <summary className="cursor-pointer font-medium">Optional Messenger booking access</summary>
        <p>Generate a private code and send it to the organizer’s Messenger page within 10 minutes.</p>
        <div className="flex flex-wrap gap-3">
          <button type="button" disabled={messengerBusy} onClick={() => void updateMessenger("POST")} className="text-blue-700 underline">Generate code</button>
          <button type="button" disabled={messengerBusy} onClick={() => void updateMessenger("DELETE")} className="text-blue-700 underline">Disconnect</button>
        </div>
        {messengerCode && <code className="block select-all break-all rounded-lg bg-slate-100 p-2">{messengerCode}</code>}
        {messengerMessage && <p role="status">{messengerMessage}</p>}
      </details>
      )}
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    </div>
  );
}

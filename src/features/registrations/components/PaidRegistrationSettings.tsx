import { paidSeminarFields, type PaidSeminarField, type PaidSeminarKey } from "../../../../backend/paidSeminarFields";
import { useEffect, useRef, useState, type FormEvent } from "react";

type Category = { id: string; label: string; price: string; quota: string };
type Settings = {
  version: number;
  capacity: number;
  hold_minutes: number;
  cutoff_ms: number | null;
  published: 0 | 1;
  fields: PaidSeminarField[];
  categories: { id: string; label: string; unit_minor: number; quota: number | null }[];
};
type ApiFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
const field = "mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2";

function localDateInput(ms: number | null) {
  if (ms == null) return "";
  const date = new Date(ms);
  return new Date(ms - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function SettingsForm({ settings, path, apiFetch, onSaved }: {
  settings: Settings | null; path: string; apiFetch: ApiFetch; onSaved: (result: Settings) => void;
}) {
  const [categories, setCategories] = useState<Category[]>(settings?.categories.map((category) => ({
    id: category.id, label: category.label, price: (category.unit_minor / 100).toFixed(2),
    quota: category.quota == null ? "" : String(category.quota),
  })) ?? [{ id: "general", label: "", price: "", quota: "" }]);
  const [seminar, setSeminar] = useState(settings?.fields ?? []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setError("");
    const data = new FormData(event.currentTarget);
    const cutoff = String(data.get("cutoff") || "");
    const parsedCategories = categories.map(({ id, label, price, quota }) => {
      const amount = /^(\d+)(?:\.(\d{1,2}))?$/.exec(price.trim());
      return {
        id, label, unit_minor: amount ? Number(amount[1]) * 100 + Number((amount[2] ?? "").padEnd(2, "0")) : 0,
        quota: quota ? Number(quota) : null,
      };
    });
    if (parsedCategories.some(({ unit_minor }) => !Number.isSafeInteger(unit_minor) || unit_minor < 1)) {
      setError("Enter a positive price with up to two decimal places for each category.");
      return;
    }
    setBusy(true);
    try {
      const response = await apiFetch(path, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          version: settings?.version ?? 0, capacity: Number(data.get("capacity")),
          hold_minutes: Number(data.get("hold_minutes")), cutoff_ms: cutoff ? new Date(cutoff).getTime() : null,
          published: data.has("published"), categories: parsedCategories, fields: seminar,
        }),
      });
      const result = await response.json();
      if (!response.ok) {
        const messages: Record<string, string> = {
          version_conflict: "Someone changed these settings. Close and reopen the panel to load the current version.",
          legacy_enrollment_exists: "This event already has registrations or ticket performances.",
          capacity_in_use: "The new capacity or category quota is below current occupancy.",
          paid_enrollment_disabled: "Public paid registration is disabled for this deployment.",
          payment_profile_unavailable: "Activate a PromptPay receiver for this event’s organizer before publishing.",
        };
        setError(messages[result.error] || "Could not save these settings. Check capacity, hold duration and category details.");
        return;
      }
      onSaved(result.settings);
    } catch {
      setError("Could not reach the server. Reopen settings to check whether the changes were saved.");
    } finally {
      setBusy(false);
    }
  }
  function update(id: string, patch: Partial<Category>) {
    setCategories((current) => current.map((category) => category.id === id ? { ...category, ...patch } : category));
  }

  return (
    <form onSubmit={save} className="space-y-3">
      {!settings && <p>Saving these settings switches this event to Paid Registration. Public bookings open when you publish.</p>}
      <fieldset disabled={busy} className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-3">
          <label>Capacity<input className={field} name="capacity" type="number" min={1} step={1} required defaultValue={settings?.capacity} /></label>
          <label>Hold duration (minutes)<input className={field} name="hold_minutes" type="number" min={1} step={1} required defaultValue={settings?.hold_minutes} /></label>
          <label>Payment cutoff (device timezone)<input className={field} name="cutoff" type="datetime-local" defaultValue={localDateInput(settings?.cutoff_ms ?? null)} /></label>
        </div>
        {categories.map((category) => <fieldset key={category.id} className="grid gap-3 rounded-lg border border-slate-200 p-3 sm:grid-cols-3">
          <legend className="px-1">Category · {category.id}</legend>
          <label>Label<input className={field} required maxLength={180} value={category.label} onChange={(event) => update(category.id, { label: event.target.value })} /></label>
          <label>Price (THB)<input className={field} required inputMode="decimal" value={category.price} onChange={(event) => update(category.id, { price: event.target.value })} /></label>
          <label>Quota (optional)<input className={field} type="number" min={1} step={1} value={category.quota} onChange={(event) => update(category.id, { quota: event.target.value })} /></label>
          {categories.length > 1 && <button type="button" className="justify-self-start text-blue-700 underline"
            onClick={() => setCategories((current) => current.filter((item) => item.id !== category.id))}>Remove category</button>}
        </fieldset>)}
        {categories.length < 100 && <button type="button" className="text-blue-700 underline"
          onClick={() => setCategories((current) => [...current, { id: crypto.randomUUID(), label: "", price: "", quota: "" }])}>Add category</button>}
        <fieldset className="space-y-2 rounded-lg border border-slate-200 p-3">
          <legend className="px-1">Seminar questions</legend>
          {(Object.keys(paidSeminarFields) as PaidSeminarKey[]).map((key) => {
            const configured = seminar.find((item) => item.key === key);
            return <div key={key} className="grid items-end gap-2 sm:grid-cols-[minmax(10rem,1fr)_1fr]">
              <label>{paidSeminarFields[key].label}
                <select className={field} value={configured?.scope ?? ""} onChange={(event) => {
                  const scope = event.target.value;
                  setSeminar((current) => {
                    const rest = current.filter((item) => item.key !== key);
                    return scope === "booking" || scope === "attendee" ? [...rest, { key, scope, required: configured?.required ?? false }] : rest;
                  });
                }}>
                  <option value="">Hidden</option><option value="booking">Once per booking</option><option value="attendee">For each attendee</option>
                </select>
              </label>
              {configured && <label className="flex gap-2 pb-2">
                <input type="checkbox" checked={configured.required} onChange={(event) => {
                  const required = event.target.checked;
                  setSeminar((current) => current.map((item) => item.key === key ? { ...item, required } : item));
                }} />
                Require {paidSeminarFields[key].label.toLowerCase()}
              </label>}
            </div>;
          })}
        </fieldset>
        <label className="flex gap-2"><input type="checkbox" name="published" defaultChecked={settings?.published === 1} /> Accept public paid bookings</label>
        <button type="submit" className="rounded-lg bg-blue-600 px-3 py-2 font-semibold text-white">{busy ? "Saving…" : "Save paid registration settings"}</button>
      </fieldset>
      {error && <p role="alert" className="text-red-700">{error}</p>}
    </form>
  );
}

export function PaidRegistrationSettings({ eventId, apiFetch }: { eventId: string; apiFetch: ApiFetch }) {
  const [open, setOpen] = useState(false);
  const [settings, setSettings] = useState<Settings | null>();
  const [error, setError] = useState(false);
  const [saved, setSaved] = useState(false);
  const fetchRef = useRef(apiFetch);
  fetchRef.current = apiFetch;
  const path = `/api/events/${encodeURIComponent(eventId)}/paid-registration/settings`;
  useEffect(() => {
    if (!open) return;
    const request = new AbortController();
    setSettings(undefined);
    setError(false);
    setSaved(false);
    void fetchRef.current(path, { signal: request.signal }).then(async (response) => {
      if (!response.ok) throw new Error();
      const result = await response.json();
      if (!request.signal.aborted) setSettings(result.settings);
    }).catch(() => { if (!request.signal.aborted) setError(true); });
    return () => request.abort();
  }, [open, path]);

  return (
    <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-800">
      <button type="button" aria-expanded={open} className="font-semibold text-blue-700 underline" onClick={() => setOpen(!open)}>Paid registration settings</button>
      {open && (error ? <p role="alert">Could not load paid registration settings.</p> :
        settings === undefined ? <p role="status">Loading settings…</p> :
          <SettingsForm key={settings?.version ?? 0} settings={settings} path={path} apiFetch={apiFetch}
            onSaved={(result) => { setSettings(result); setSaved(true); }} />)}
      {open && saved && <p role="status">Settings saved.</p>}
    </section>
  );
}

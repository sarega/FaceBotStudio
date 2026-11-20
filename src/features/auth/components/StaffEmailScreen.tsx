import { useState, type FormEvent } from "react";
import { ActionButton } from "../../../components/shared/AppUi";

type ApiFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export function StaffEmailScreen({ apiFetch }: { apiFetch: ApiFetch }) {
  const link = new URLSearchParams(window.location.hash.slice(1));
  const token = link.get("token");
  const purpose = link.get("purpose");
  const invite = purpose === "invite";
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [message, setMessage] = useState("");

  async function confirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const password = invite ? new FormData(event.currentTarget).get("password") : undefined;
    setBusy(true);
    setMessage("");
    try {
      const response = await apiFetch("/api/auth/staff-email/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: invite ? "omit" : "same-origin",
        body: JSON.stringify({ token, purpose, password }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Failed to verify staff email");
      window.history.replaceState(null, "", window.location.pathname);
      setDone(true);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to verify staff email");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-100 px-4 py-16 text-slate-900">
      <section className="mx-auto max-w-md space-y-5 rounded-2xl bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-semibold">{done ? "Staff email verified" : invite ? "Activate your staff account" : "Verify your staff email"}</h1>
        {done ? (
          <p>Continue to FaceBotStudio. Use your assigned username when signing in.</p>
        ) : token && (invite || purpose === "verify") ? (
          <form onSubmit={confirm} className="space-y-4">
            {invite && (
              <label className="block space-y-2">
                <span>Create a password (at least 12 characters)</span>
                <input className="w-full rounded-lg border p-3" name="password" type="password" required minLength={12} maxLength={512} autoComplete="new-password" />
              </label>
            )}
            <ActionButton type="submit" tone="blue" disabled={busy}>{invite ? "Activate account" : "Verify email"}</ActionButton>
          </form>
        ) : <p>Open the latest link from your staff email.</p>}
        {message && <p role="alert" className="text-rose-700">{message}</p>}
        <a href="/" className="inline-block font-semibold text-blue-700">Continue to FaceBotStudio</a>
      </section>
    </main>
  );
}

export function StaffEmailSettings({ email, apiFetch }: { email?: string | null; apiFetch: ApiFetch }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function request(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    setBusy(true);
    setMessage("");
    try {
      const response = await apiFetch("/api/auth/staff-email/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: values.get("email"), password: values.get("password") }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Failed to send verification email");
      form.reset();
      setMessage("Verification link sent. Keep this staff account signed in when you open it.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to send verification email");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-5 space-y-3 border-t border-slate-200 pt-4">
      <h3 className="font-semibold">Staff email</h3>
      {email ? <p className="break-all text-sm">{email} · Verified</p> : (
        <form onSubmit={request} className="space-y-3">
          <label className="block text-sm">Email
            <input className="mt-1 w-full rounded-lg border p-2" name="email" type="email" autoComplete="email" required maxLength={254} />
          </label>
          <label className="block text-sm">Current password
            <input className="mt-1 w-full rounded-lg border p-2" name="password" type="password" autoComplete="current-password" required maxLength={512} />
          </label>
          <ActionButton type="submit" tone="blue" disabled={busy}>Send verification link</ActionButton>
        </form>
      )}
      {message && <p role="status" className="text-sm">{message}</p>}
    </section>
  );
}

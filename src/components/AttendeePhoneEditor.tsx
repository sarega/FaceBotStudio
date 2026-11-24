import { useState } from "react";
import { Pencil, Plus } from "lucide-react";
import { isOptionalAttendeePhone } from "../lib/attendeePhone";

export function AttendeePhoneEditor({ phone = "", language, onSave }: {
  phone?: string;
  language: "th" | "en";
  onSave: (phone: string) => Promise<void>;
}) {
  const th = language === "th";
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(phone);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const valid = isOptionalAttendeePhone(draft);
  const label = th ? "เบอร์โทรส่วนตัว" : "Personal phone";
  return <div className="mt-1 text-xs">
    {!open && <div className="flex flex-wrap items-center gap-2">
      {phone && <a className="text-blue-700 underline" href={`tel:${phone.replace(/[^+0-9]/g, "")}`}>{phone}</a>}
      <button type="button" className="inline-flex min-h-7 items-center gap-1 rounded px-1 text-blue-700 hover:underline"
        onClick={() => { setDraft(phone); setError(""); setOpen(true); }}>
        {phone ? <Pencil className="size-3" aria-hidden="true" /> : <Plus className="size-3" aria-hidden="true" />}
        {phone ? (th ? "แก้เบอร์" : "Edit phone") : label}
      </button>
    </div>}
    {open && <form className="space-y-1 rounded border border-slate-200 p-2" onSubmit={async event => {
      event.preventDefault();
      if (busy || !valid) return;
      setError("");
      setBusy(true);
      try {
        await onSave(draft.trim());
        setOpen(false);
      } catch (failure) {
        setError(failure instanceof Error && failure.message ? failure.message :
          (th ? "บันทึกเบอร์ไม่ได้ กรุณาลองอีกครั้ง" : "Could not save the number. Try again."));
      } finally {
        setBusy(false);
      }
    }}>
      <label className="block font-medium">{label}
        <input type="tel" maxLength={64} autoFocus disabled={busy} value={draft}
          className="mt-1 block w-full rounded border border-slate-300 bg-white px-2 py-1.5 font-normal"
          onChange={event => setDraft(event.target.value)} />
      </label>
      <p className="font-normal text-slate-500">{th ? "เว้นว่างเพื่อลบเบอร์ส่วนตัว" : "Leave empty to remove the personal number."}</p>
      {!valid && <p className="font-normal text-rose-700">{th ? "กรุณาตรวจสอบรูปแบบเบอร์โทร" : "Check the phone number format."}</p>}
      {error && <p className="font-normal text-rose-700" role="alert">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={busy || !valid} className="rounded bg-blue-700 px-2 py-1 font-semibold text-white disabled:opacity-50">
          {busy ? (th ? "กำลังบันทึก…" : "Saving…") : (th ? "บันทึก" : "Save")}
        </button>
        <button type="button" disabled={busy} className="px-1 text-slate-600" onClick={() => setOpen(false)}>{th ? "ยกเลิก" : "Cancel"}</button>
      </div>
    </form>}
  </div>;
}

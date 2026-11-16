import { useEffect, useState } from "react";

type ApiFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
type Instructions = { bank_name: string; account_name: string; account_number: string; qr_png_base64: string };
const empty: Instructions = { bank_name: "", account_name: "", account_number: "", qr_png_base64: "" };

export function PaidPaymentDisplaySettings({eventId, apiFetch}: {eventId: string; apiFetch: ApiFetch}) {
  const [data,setData] = useState<Instructions>(empty);
  const [message,setMessage] = useState("");
  const [busy,setBusy] = useState(false);
  const url = "/api/events/" + encodeURIComponent(eventId) + "/paid-registration/payment-display";
  useEffect(() => {
    const abort = new AbortController();
    void apiFetch(url,{signal:abort.signal}).then(async r => {
      if (!r.ok) throw new Error("Could not load payment details");
      const details = await r.json() as Instructions;
      if (!abort.signal.aborted) setData(details);
    }).catch(() => { if (!abort.signal.aborted) setMessage("Payment details unavailable"); });
    return () => abort.abort();
  },[url,apiFetch]);
  async function fileSelected(file: File | undefined) {
    if (!file) return;
    if (file.size > 4 * 1024 * 1024 || !["image/png","image/jpeg","image/webp"].includes(file.type)) {
      setMessage("Choose a PNG, JPEG, or WebP image under 4 MB."); return;
    }
    setBusy(true);setMessage("");
    try {
      const response=await apiFetch(url+"/qr",{method:"POST",
        headers:{"Content-Type":"application/octet-stream"},body:file});
      const result=await response.json();
      if (!response.ok) throw new Error(result.error || "Could not upload QR");
      setData(result as Instructions);
      setMessage("QR image uploaded. You can now save the bank account details.");
    } catch(e){setMessage(e instanceof Error?e.message:"QR upload failed");}
    finally {setBusy(false);}
  }
  async function removeQr() {
    setBusy(true);setMessage("");
    try {
      const response=await apiFetch(url+"/qr",{method:"DELETE"});
      const result=await response.json();
      if (!response.ok) throw new Error(result.error || "Could not remove QR");
      setData(result as Instructions);
    } catch(e){setMessage(e instanceof Error?e.message:"Could not remove QR");}
    finally{setBusy(false);}
  }
  async function save() {
    setBusy(true);setMessage("");
    try {
      const res = await apiFetch(url,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({bank_name:data.bank_name,account_name:data.account_name,account_number:data.account_number})});
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Could not save");
      setData(result as Instructions);
      setMessage("Saved. Attendees can view these details in their booking.");
    } catch(e) {setMessage(e instanceof Error?e.message:"Could not save");}
    finally {setBusy(false);}
  }
  const change=(key: keyof Instructions,value: string) => setData(prev => ({...prev,[key]:value}));
  return <section className="space-y-3 rounded-xl border-2 border-blue-200 bg-blue-50 p-4 text-sm text-slate-900">
    <h3 className="font-bold">Bank transfer / Upload existing QR (for this Event)</h3>
    <p className="text-xs">Use the bank details or QR picture provided by the receiver. No PromptPay ID needed. Payment is checked manually by the organizer.</p>
    <div className="grid gap-2 sm:grid-cols-2">
      <label>Bank name<input className="mt-1 block w-full rounded border bg-white p-2" value={data.bank_name}
        maxLength={120} onChange={e => change("bank_name",e.target.value)} placeholder="Bank name" /></label>
      <label>Account holder<input className="mt-1 block w-full rounded border bg-white p-2" value={data.account_name}
        maxLength={180} onChange={e => change("account_name",e.target.value)} placeholder="Name on account" /></label>
      <label className="sm:col-span-2">Bank account number<input className="mt-1 block w-full rounded border bg-white p-2" value={data.account_number}
        maxLength={50} onChange={e => change("account_number",e.target.value)} placeholder="Account number" /></label>
    </div>
    <label className="block font-semibold">Upload recipient QR image (PNG / JPEG / WebP, max 4 MB)
      <input type="file" accept="image/png,image/jpeg,image/webp" className="mt-1 block w-full rounded border bg-white p-2 font-normal"
        onChange={e => void fileSelected(e.target.files?.[0])} />
    </label>
    {!!data.qr_png_base64 && <div className="flex flex-col items-start gap-2">
      <img src={"data:image/png;base64," + data.qr_png_base64} alt="Recipient bank QR" className="max-h-60 max-w-60 rounded-lg border bg-white object-contain p-2"/>
      <button type="button" disabled={busy} onClick={() => void removeQr()} className="text-red-700 underline">Remove QR image</button>
    </div>}
    <button type="button" disabled={busy} onClick={() => void save()}
      className="rounded-lg bg-blue-700 px-4 py-2 font-bold text-white disabled:opacity-50">
      {busy?"Saving…":"Save bank details and QR image"}
    </button>
    {message && <p role="status">{message}</p>}
  </section>;
}

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { ScanText, UploadCloud } from "lucide-react";
import { thaiTransferTime, type PaidSlipFields } from "../../backend/paidSlipFields";
import type { CustomerCopy, CustomerLocale } from "../features/customer-account/customerLocale";

export function PaidProofForm({ locale, path, version, totalMinor, paymentMode, submitRequest, staff = false, bookingReference, onSubmitted }: { locale: CustomerLocale;
  path: string; version: number; totalMinor: number | null; paymentMode: "promptpay" | "external_manual"; onSubmitted: () => void;
  submitRequest: (path: string, init: RequestInit) => Promise<unknown>; staff?: boolean; bookingReference?: string;
}) {
  const t = (th: string, en: string) => locale === "th" ? th : en;
  const [file, setFile] = useState<File>();
  const fileId=useId();
  const [amount, setAmount] = useState("");
  const [paidAt, setPaidAt] = useState("");
  const [reference, setReference] = useState("");
  const [error, setError] = useState<CustomerCopy>();
  const [busy, setBusy] = useState(false);
  const [analysis, setAnalysis] = useState<PaidSlipFields>();
  const [analysisState, setAnalysisState] = useState<"idle" | "reading" | "done" | "error">("idle");
  const analysisRequest = useRef<AbortController | undefined>(undefined);
  useEffect(() => () => analysisRequest.current?.abort(), []);
  const reading = analysisState === "reading";
  const money = new Intl.NumberFormat(locale === "th" ? "th-TH" : "en-GB", { style: "currency", currency: "THB" });
  const mimeTypes = ["image/jpeg", "image/png", "image/webp"];

  async function analyze() {
    if (!staff || !file || reading || busy) return;
    const request = new AbortController();
    analysisRequest.current?.abort();
    analysisRequest.current = request;
    setAnalysisState("reading");
    try {
      const fields = await submitRequest(`${path}/proof-analysis`, {
        method: "POST", body: file, signal: request.signal,
        headers: {
          "Content-Type": "application/octet-stream",
          ...(bookingReference ? { "x-booking-reference": bookingReference } : {}),
        },
      }) as PaidSlipFields;
      if (request.signal.aborted) return;
      setAnalysis(fields);
      if (fields.amountMinor != null) setAmount((fields.amountMinor / 100).toFixed(2));
      if (fields.transferAt) setPaidAt(fields.transferAt);
      setAnalysisState("done");
    } catch {
      if (!request.signal.aborted) setAnalysisState("error");
    }
  }
  const command = useRef<{ signature: string; file: File; key: string } | undefined>(undefined);
  const submitting = useRef(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current || !file || reading) return;
    const parts = /^(\d+)(?:\.(\d{1,2}))?$/.exec(amount.trim());
    const minor = parts ? Number(parts[1]) * 100 + Number((parts[2] ?? "").padEnd(2, "0")) : null;
    const transferMs = paidAt ? thaiTransferTime(paidAt) : null;
    if ((amount.trim() && (minor == null || !Number.isSafeInteger(minor) || minor < 1)) ||
        (transferMs != null && !Number.isFinite(transferMs))) {
      setError(["ตรวจยอดและเวลาโอนที่กรอก หรือเว้นช่องที่ไม่ทราบไว้", "Check the amount and transfer time you entered, or leave unknown fields blank."]);
      return;
    }
    if (file.size < 1 || file.size > 4 * 1024 * 1024 || !mimeTypes.includes(file.type)) {
      setError(["เลือกภาพ JPG, PNG หรือ WebP ไม่เกิน 4 MB", "Choose a JPG, PNG or WebP up to 4 MB."]);
      return;
    }
    setError(undefined);
    const claimedDate = transferMs == null ? null : new Date(transferMs).toISOString();
    const normalizedRef = reference.trim();
    if (normalizedRef && !/^[!-~]+$/.test(normalizedRef)) {
      setError(["ใช้เลขอ้างอิงตามที่ธนาคารแสดง โดยไม่มีช่องว่างหรืออักขระนอกชุด ASCII", "Use the transfer reference shown by your bank, without spaces or special characters outside ASCII."]);
      return;
    }
    const signature = JSON.stringify([version, minor, claimedDate, normalizedRef, analysis?.payerName]);
    if (command.current?.file !== file || command.current.signature !== signature) {
      command.current = { file, signature, key: crypto.randomUUID() };
    }
    submitting.current = true;
    setBusy(true);
    try {
      await submitRequest(`${path}/proofs`, {
        method: "POST", body: file,
        headers: {
          "Content-Type": "application/octet-stream", "Idempotency-Key": command.current.key,
          "x-booking-version": String(version),
          ...(minor == null ? {} : { "x-claimed-minor": String(minor) }),
          ...(claimedDate ? { "x-claimed-transfer-at": claimedDate } : {}),
          ...(analysis?.payerName ? { "x-claimed-payer-name": encodeURIComponent(analysis.payerName) } : {}),
          "x-payment-method": paymentMode === "external_manual" ? "bank_transfer" : "promptpay",
          "x-proof-mime": file.type, "x-payment-reference": normalizedRef,
        },
      });
      onSubmitted();
    } catch (failure) {
      const code = failure instanceof Error ? failure.message : "";
      setError(code === "duplicate_reference_or_proof"
        ? ["ภาพนี้ถูกแนบไว้แล้ว กรุณาเลือกสลิปของรายการโอนอีกครั้ง", "This image is already attached. Choose the slip for the other transfer."]
        : code === "too_many_proofs"
          ? ["แนบสลิปรอตรวจได้สูงสุด 8 ใบ กรุณาติดต่อผู้จัดงาน", "This booking already has 8 slips pending review. Contact the organizer."]
        : code === "proof_storage_unavailable"
        ? ["ยังไม่เปิดระบบเก็บสลิปอย่างปลอดภัย กรุณาติดต่อผู้จัดงาน", "Secure slip upload is not configured."]
        : code === "hold_expired"
          ? staff ? ["ใบจองหมดอายุแล้ว กรุณาเปิดรายการอีกครั้งก่อนแนบสลิป", "Reactivate this expired booking before uploading a slip."]
            : ["หมดเวลาชำระเงินแล้ว กรุณาติดต่อผู้จัดงาน", "Payment deadline has passed."]
          : code === "version_conflict" || code === "state_conflict"
            ? ["สถานะใบจองเปลี่ยนแล้ว กรุณารีเฟรช", "Booking state changed. Refresh to continue."]
            : ["ส่งสลิปไม่สำเร็จ กรุณาลองใหม่", "Slip upload failed. Please retry."]);
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  const input = "mt-1 block w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-slate-900";
  return (
    <form onSubmit={submit} className="space-y-3">
      {!staff && paymentMode==="promptpay" && <p className="text-xs text-slate-700">{t("ตรวจสอบ QR ในขั้นตอนที่ 2 ก่อนโอน", "Check the QR code in step 2 before transferring.")}</p>}
      <label htmlFor={fileId} className={`relative flex cursor-pointer flex-col items-center justify-center border-2 text-center font-semibold focus-within:ring-2 focus-within:ring-blue-600 ${staff ? "paid-slip-staff-picker min-h-16 gap-0.5 rounded-lg px-3 py-1.5" : "min-h-24 gap-2 rounded-xl border-dashed border-blue-400 bg-blue-500/10 px-4 py-3 text-blue-700 hover:bg-blue-500/20"}`}>
        <UploadCloud className={staff ? "h-4 w-4" : "h-7 w-7"} aria-hidden="true" />
        <span>{file ? file.name : t("เลือกภาพสลิป", "Choose payment slip")}</span>
        <span className={`text-xs font-normal ${staff ? "text-inherit" : "text-slate-700"}`}>{t("รูปภาพ JPG, PNG หรือ WebP ไม่เกิน 4 MB", "JPG, PNG or WebP, up to 4 MB")}</span>
        <input id={fileId} className="absolute inset-0 h-full w-full cursor-pointer opacity-0" type="file" accept="image/jpeg,image/png,image/webp"
          disabled={busy} onChange={(event) => {
            const chosen=event.target.files?.[0];
            analysisRequest.current?.abort();
            setAnalysis(undefined);
            setAnalysisState("idle");
            setAmount("");
            setPaidAt("");
            setReference("");
            setError(undefined);
            if (chosen && (!mimeTypes.includes(chosen.type) || chosen.size > 4 * 1024 * 1024 || chosen.size === 0)) {
              event.target.value = "";
              setFile(undefined);
              setError(["กรุณาเลือกรูป JPG, PNG หรือ WebP ขนาดไม่เกิน 4 MB", "Choose a JPG, PNG or WebP up to 4 MB."]);
              return;
            }
            setFile(chosen);
          }}/>
      </label>
      {staff && file && <div className="space-y-1.5 rounded-lg border border-slate-200 p-2.5 text-sm">
        <button type="button" disabled={busy || reading} onClick={() => void analyze()} className="registration-admin-control">
          <ScanText className="h-4 w-4" aria-hidden="true" />
          {reading ? t("กำลังอ่านสลิป…", "Reading slip…") : t("อ่านยอดและเวลาจากสลิปด้วย AI", "Read amount and time with AI")}
        </button>
        <p className="text-xs text-slate-600">
          {t("การกดอ่านด้วย AI จะส่งภาพไปประมวลผลผ่าน OpenRouter ส่งสลิปได้โดยไม่ใช้ AI", "AI reading sends the image to OpenRouter for processing. You can submit the slip without using AI.")}
        </p>
        {analysisState === "error" && <p role="status" className="text-amber-800">
          {t("อ่านสลิปอัตโนมัติไม่ได้ ส่งภาพให้ผู้จัดงานตรวจได้เลย", "Automatic reading is unavailable. You can still submit the image for review.")}
        </p>}
        {analysis && <div role="status" className="space-y-1">
          <p className={analysis.amountMinor != null && (totalMinor == null || analysis.amountMinor === totalMinor) ? "font-semibold text-emerald-700" : "font-semibold text-amber-800"}>
            {analysis.amountMinor == null ? t("อ่านยอดไม่ชัด", "Amount could not be read") :
              totalMinor == null ? t("ยอดที่อ่านได้", "Amount read") : analysis.amountMinor === totalMinor ? t("ยอดที่อ่านได้ตรงกับใบจอง", "The amount read matches the booking") :
                t("ยอดที่อ่านได้ต่างจากใบจอง", "The amount read differs from the booking")}
            {analysis.amountMinor != null && ` · ${money.format(analysis.amountMinor / 100)}`}
          </p>
          {analysis.transferAt ? <p>{t("กรอกวันและเวลาโอนให้แล้ว ตรวจแก้ได้ด้านล่าง", "Transfer date and time filled in. Review or edit it below.")}</p> :
            <p>{t("อ่านวันหรือเวลาโอนไม่ชัด เว้นว่างไว้ได้", "Transfer date or time could not be read. You can leave it blank.")}</p>}
          {staff && analysis.payerName && <p>{t("ชื่อผู้โอนที่ AI อ่านได้", "Payer name read by AI")} <strong>{analysis.payerName}</strong></p>}
        </div>}
      </div>}
      {staff && <details open={analysis ? true : undefined} className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700">
        <summary className="cursor-pointer">{t("ยอดและเวลาโอน (ถ้ามี)", "Amount and transfer time (optional)")}</summary>
        <fieldset disabled={busy || reading} className="mt-3 grid gap-3 sm:grid-cols-2">
          <label>{t("ยอดที่โอน (บาท)", "Transferred amount (THB)")}
            <input className={input} inputMode="decimal" value={amount}
              onChange={(event) => setAmount(event.target.value)}/>
          </label>
          <label>{t("เวลาโอน (วัน/เดือน/ปี เวลาไทย)", "Transfer time (day/month/year, Thailand)")}
            <input className={input} type="datetime-local" lang="en-GB" step="1" value={paidAt}
              onChange={(event) => setPaidAt(event.target.value)}/>
          </label>
          <label className="sm:col-span-2">{t("เลขอ้างอิงธนาคาร (ถ้ามี)", "Bank reference (optional)")}
            <input className={input} value={reference} maxLength={255}
              onChange={(event) => setReference(event.target.value)}/>
          </label>
        </fieldset>
      </details>}
      <button type="submit" disabled={busy || reading || !file}
        className={staff ? "registration-admin-control paid-slip-staff-submit" : "flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-blue-500 px-5 py-3 text-base font-bold text-white hover:bg-blue-400 disabled:cursor-not-allowed disabled:bg-slate-600"}>
        <UploadCloud className="h-5 w-5"/>
        {busy ? t("กำลังส่งสลิป…", "Submitting slip…") : staff ? t("แนบสลิปเข้าคิวรอตรวจ", "Submit slip for review") : t("ส่งสลิปให้ผู้จัดงาน", "Submit slip")}
      </button>
      {!file && <p className="text-center text-xs text-slate-600">{t("เลือกภาพสลิปก่อนกดส่ง", "Choose a payment slip before submitting.")}</p>}
      {error && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-rose-700">{t(...error)}</p>}
    </form>
  );
}

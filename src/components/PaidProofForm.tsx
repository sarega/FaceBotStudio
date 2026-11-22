import { useId, useRef, useState, type FormEvent } from "react";
import { UploadCloud } from "lucide-react";
import type { CustomerCopy, CustomerLocale } from "../features/customer-account/customerLocale";

export function PaidProofForm({ locale, path, version, totalMinor, paymentMode, submitRequest, staff = false, onSubmitted }: { locale: CustomerLocale;
  path: string; version: number; totalMinor: number; paymentMode: "promptpay" | "external_manual"; onSubmitted: () => void;
  submitRequest: (path: string, init: RequestInit) => Promise<unknown>; staff?: boolean;
}) {
  const t = (th: string, en: string) => locale === "th" ? th : en;
  const [file, setFile] = useState<File>();
  const fileId=useId();
  const [amount, setAmount] = useState((totalMinor / 100).toFixed(2));
  const [paidAt, setPaidAt] = useState("");
  const [reference, setReference] = useState("");
  const [error, setError] = useState<CustomerCopy>();
  const [busy, setBusy] = useState(false);
  const command = useRef<{ signature: string; file: File; key: string } | undefined>(undefined);
  const submitting = useRef(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current || !file) return;
    const parts = /^(\d+)(?:\.(\d{1,2}))?$/.exec(amount.trim());
    const minor = parts ? Number(parts[1]) * 100 + Number((parts[2] ?? "").padEnd(2, "0")) : 0;
    const transferTime = new Date(staff && paidAt ? `${paidAt}+07:00` : paidAt);
    if (!Number.isSafeInteger(minor) || minor < 1 || !Number.isFinite(transferTime.getTime()) ||
        file.size < 1 || file.size > 4 * 1024 * 1024 || !["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setError(["กรอกยอดและเวลาโอน แล้วเลือกภาพ JPEG, PNG หรือ WebP ไม่เกิน 4 MB", "Enter the transferred amount and time and select a JPEG, PNG or WebP up to 4 MB."]);
      return;
    }
    setError(undefined);
    const claimedDate = transferTime.toISOString();
    const normalizedRef = reference.trim();
    if (normalizedRef && !/^[!-~]+$/.test(normalizedRef)) {
      setError(["ใช้เลขอ้างอิงตามที่ธนาคารแสดง โดยไม่มีช่องว่างหรืออักขระนอกชุด ASCII", "Use the transfer reference shown by your bank, without spaces or special characters outside ASCII."]);
      return;
    }
    const signature = JSON.stringify([version, minor, claimedDate, normalizedRef]);
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
          "x-booking-version": String(version), "x-claimed-minor": String(minor),
          "x-claimed-transfer-at": claimedDate, "x-payment-method": paymentMode === "external_manual" ? "bank_transfer" : "promptpay",
          "x-proof-mime": file.type, "x-payment-reference": normalizedRef,
        },
      });
      onSubmitted();
    } catch (failure) {
      const code = failure instanceof Error ? failure.message : "";
      setError(code === "proof_storage_unavailable"
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
      <label htmlFor={fileId} className={`relative flex cursor-pointer flex-col items-center justify-center border-2 border-dashed border-blue-400 bg-blue-500/10 text-center font-semibold text-blue-700 hover:bg-blue-500/20 focus-within:ring-2 focus-within:ring-blue-600 ${staff ? "min-h-16 gap-0.5 rounded-lg px-3 py-1.5" : "min-h-24 gap-2 rounded-xl px-4 py-3"}`}>
        <UploadCloud className={staff ? "h-4 w-4" : "h-7 w-7"} aria-hidden="true" />
        <span>{file ? file.name : t("เลือกภาพสลิป", "Choose payment slip")}</span>
        <span className="text-xs font-normal text-slate-700">{t("รูปภาพ JPG, PNG หรือ WebP ไม่เกิน 4 MB", "JPG, PNG or WebP, up to 4 MB")}</span>
        <input id={fileId} className="absolute inset-0 h-full w-full cursor-pointer opacity-0" type="file" accept="image/*"
          disabled={busy} onChange={(event) => {
            const chosen=event.target.files?.[0];
            setError(undefined);
            if (chosen && (!["image/png", "image/jpeg", "image/webp"].includes(chosen.type) || chosen.size > 4 * 1024 * 1024 || chosen.size === 0)) {
              event.target.value = "";
              setFile(undefined);
              setError(["กรุณาเลือกรูป JPG, PNG หรือ WebP ขนาดไม่เกิน 4 MB", "Choose a JPG, PNG or WebP up to 4 MB."]);
              return;
            }
            setFile(chosen);
            if(chosen&&!paidAt&&!staff){
              const now=new Date();
              setPaidAt(new Date(now.getTime()-now.getTimezoneOffset()*60000).toISOString().slice(0,16));
            }
          }}/>
      </label>
      <details open={staff || undefined} className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700">
        <summary className="cursor-pointer">{staff ? t("ยอดและเวลาโอนตามสลิป", "Amount and time shown on the slip") : t("แก้ไขยอดหรือเวลาโอน (ถ้าจำเป็น)", "Edit the amount or transfer time if needed")}</summary>
        <fieldset disabled={busy} className="mt-3 grid gap-3 sm:grid-cols-2">
          <label>{t("ยอดที่โอน (บาท)", "Transferred amount (THB)")}
            <input className={input} inputMode="decimal" value={amount}
              onChange={(event) => setAmount(event.target.value)}/>
          </label>
          <label>{staff ? t("วันเวลาโอน (เวลาไทย)", "Transfer date and time (Thailand)") : t("วันเวลาโอน", "Transfer date and time")}
            <input className={input} type="datetime-local" required={staff} value={paidAt}
              onChange={(event) => setPaidAt(event.target.value)}/>
          </label>
          <label className="sm:col-span-2">{t("เลขอ้างอิงธนาคาร (ถ้ามี)", "Bank reference (optional)")}
            <input className={input} value={reference} maxLength={255}
              onChange={(event) => setReference(event.target.value)}/>
          </label>
        </fieldset>
      </details>
      <button type="submit" disabled={busy||!file}
        className={staff ? "registration-admin-control registration-admin-control-primary" : "flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-blue-500 px-5 py-3 text-base font-bold text-white hover:bg-blue-400 disabled:cursor-not-allowed disabled:bg-slate-600"}>
        <UploadCloud className="h-5 w-5"/>
        {busy ? t("กำลังส่งสลิป…", "Submitting slip…") : staff ? t("แนบสลิปเข้าคิวรอตรวจ", "Submit slip for review") : t("ส่งสลิปให้ผู้จัดงาน", "Submit slip")}
      </button>
      {!file && <p className="text-center text-xs text-slate-600">{t("เลือกภาพสลิปก่อนกดส่ง", "Choose a payment slip before submitting.")}</p>}
      {error && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-rose-700">{t(...error)}</p>}
    </form>
  );
}

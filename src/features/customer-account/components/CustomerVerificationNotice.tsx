import { AlertCircle, MailCheck, RefreshCw } from "lucide-react";

/** Public/customer-facing next step: never imply a message was sent if delivery failed. */
export function CustomerVerificationNotice({
  locale = "th", email, onResend, busy = false, status = "", error = "", deliveryFailed = false,
}: {
  locale?: "th" | "en";
  email: string;
  onResend?: () => void;
  busy?: boolean;
  status?: string;
  error?: string;
  deliveryFailed?: boolean;
}) {
  const t = (th: string, en: string) => locale === "th" ? th : en;
  return <section role="alert" aria-label={t("ต้องยืนยันอีเมล", "Email verification required")}
    className="customer-verification-notice rounded-2xl border p-4 sm:p-6">
    <div className="flex items-start gap-3">
      <div className="customer-verification-icon flex h-11 w-11 shrink-0 items-center justify-center rounded-xl">
        <MailCheck className="h-6 w-6" aria-hidden="true"/>
      </div>
      <div className="min-w-0 flex-1 space-y-2">
        <p className="text-xs font-bold uppercase tracking-wide">{t("สำคัญ", "Action required")}</p>
        <h2 className="text-xl font-extrabold leading-snug sm:text-2xl">
          {t("เปิดอีเมลและกดลิงก์ยืนยันบัญชี", "Check your email and click the verification link.")}
        </h2>
        <p className="text-sm leading-relaxed">
          {deliveryFailed
            ? t("ระบบยังส่งอีเมลไม่ได้ กรุณากดส่งอีกครั้งหรือติดต่อผู้จัดงาน", "Email delivery failed. Try resending or contact the organizer.")
            : t("ใช้ลิงก์ยืนยันในอีเมลที่ใช้สมัครก่อนกลับมาลงทะเบียน", "Use the verification link sent to your account email before booking.")}
        </p>
        {email && <p className="customer-verification-email break-all rounded-lg px-3 py-2 text-sm font-bold">
          <span className="mr-2">{t("อีเมลของคุณ", "Your email")}</span>{email}
        </p>}
        <p className="text-sm leading-relaxed">
          {t("หาอีเมลไม่พบ? ตรวจกล่องจดหมายเข้าและโฟลเดอร์สแปม", "Missing the email? Check your inbox and spam folder.")}
        </p>
        <p className="text-sm font-semibold">{t("ยืนยันอีเมลก่อนจองที่นั่ง", "Verify your email before booking a spot.")}</p>
        {onResend && <button type="button" disabled={busy} onClick={onResend}
          className="customer-verification-button inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-60">
          <RefreshCw className={"h-4 w-4"+(busy?" animate-spin":"")}/>
          {busy ? t("กำลังส่ง…", "Sending…") : t("ส่งอีเมลยืนยันอีกครั้ง", "Resend email")}
        </button>}
        {status && <p role="status" className="customer-verification-feedback rounded-lg p-3 text-sm font-semibold">{status}</p>}
        {error && <p role="alert" className="customer-verification-error flex items-center gap-2 rounded-lg p-3 text-sm font-semibold">
          <AlertCircle className="h-4 w-4 shrink-0"/>{error}
        </p>}
      </div>
    </div>
  </section>;
}

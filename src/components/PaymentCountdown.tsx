import { useEffect, useState } from "react";

export function PaymentCountdown({ dueAt, locale = "th", onExpired }: { dueAt: string; locale?: "th" | "en"; onExpired?: () => void }) {
  const deadline = Date.parse(dueAt);
  const [now, setNow] = useState(Date.now);
  const seconds = Math.max(0, Math.ceil((deadline - now) / 1000));

  useEffect(() => {
    const update = () => setNow(Date.now());
    update();
    if (!Number.isFinite(deadline) || deadline <= Date.now()) return;
    const timer = window.setInterval(() => {
      update();
      if (deadline <= Date.now()) window.clearInterval(timer);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [deadline]);

  useEffect(() => {
    if (Number.isFinite(deadline) && now >= deadline) onExpired?.();
  }, [deadline, now, onExpired]);

  if (!Number.isFinite(deadline)) return null;
  if (!seconds) return <p className="font-semibold text-amber-800">{locale === "th" ? "หมดเวลาชำระเงิน" : "Payment deadline passed"}</p>;
  const days = Math.floor(seconds / 86400);
  const clock = [Math.floor(seconds / 3600) % 24, Math.floor(seconds / 60) % 60, seconds % 60]
    .map((part) => String(part).padStart(2, "0")).join(":");
  return <p className="font-semibold tabular-nums text-amber-800">
    {locale === "th" ? "เหลือเวลาชำระ" : "Time left to pay"} {days > 0 && `${days} ${locale === "th" ? "วัน" : "d"} `}{clock}
  </p>;
}

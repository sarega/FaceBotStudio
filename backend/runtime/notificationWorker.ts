import type { AppDatabase } from "../db/types";
import { dispatchNotificationDeliveries } from "../notifications/outbox";

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

export function startEmbeddedNotificationWorker(db: AppDatabase, options?: { enabled?: boolean }) {
  if (options?.enabled === false || timer) return timer;
  const intervalMs = Math.max(2_000, Number.parseInt(process.env.NOTIFICATION_WORKER_INTERVAL_MS || "10000", 10) || 10_000);
  const run = async () => {
    if (running) return;
    running = true;
    try {
      await dispatchNotificationDeliveries(db, `notification-worker-${process.pid}`, undefined, { limit: 20 });
    } catch (error) {
      console.error("Notification worker error:", error);
    } finally {
      running = false;
    }
  };
  void run();
  timer = setInterval(() => void run(), intervalMs);
  return timer;
}

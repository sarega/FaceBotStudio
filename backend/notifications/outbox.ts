import type { AppDatabase, NotificationDeliveryRow } from "../db/types";
import { getEmailConfig } from "../email/config";
import { sendProviderEmail } from "../email/provider";
import { getSmsConfig, sendProviderSms } from "./sms";

type NotificationOutboxDatabase = Pick<
  AppDatabase,
  | "claimNotificationDeliveries"
  | "markNotificationDeliverySent"
  | "markNotificationDeliveryRetryable"
  | "markNotificationDeliveryFailed"
>;

export type NotificationSendResult = {
  provider?: string | null;
  providerMessageId?: string | null;
};

export type NotificationDeliverySender = (delivery: NotificationDeliveryRow) => Promise<NotificationSendResult>;

export class NotificationDeliveryError extends Error {
  readonly retryable: boolean;

  constructor(message: string, retryable: boolean) {
    super(message);
    this.name = "NotificationDeliveryError";
    this.retryable = retryable;
  }
}

export type DispatchNotificationDeliveriesOptions = {
  limit?: number;
  maxAttempts?: number;
  baseBackoffMs?: number;
  maxBackoffMs?: number;
  now?: () => number;
};

export type DispatchNotificationDeliveriesResult = {
  claimed: number;
  sent: number;
  retried: number;
  failed: number;
};

function normalizeText(value: unknown) {
  return String(value || "").trim();
}

function toErrorMessage(error: unknown) {
  return error instanceof Error && error.message.trim()
    ? error.message.trim()
    : normalizeText(error) || "Notification delivery failed";
}

function parseEmailPayload(delivery: NotificationDeliveryRow) {
  if (delivery.channel !== "email") {
    throw new NotificationDeliveryError(`Unsupported notification channel: ${delivery.channel}`, false);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(delivery.payload_json);
  } catch {
    throw new NotificationDeliveryError("Notification payload is not valid JSON", false);
  }

  const record = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  const subject = normalizeText(record.subject);
  const text = normalizeText(record.text);
  const html = normalizeText(record.html);
  if (!subject || !text || !html) {
    throw new NotificationDeliveryError("Email notification payload is incomplete", false);
  }

  const rawAttachments = record.attachments == null
    ? []
    : Array.isArray(record.attachments)
      ? record.attachments
      : null;
  if (!rawAttachments) {
    throw new NotificationDeliveryError("Email notification attachments must be an array", false);
  }
  if (rawAttachments.length > 4) {
    throw new NotificationDeliveryError("Email notification has too many attachments", false);
  }
  const attachments = rawAttachments.map((attachment, index) => {
    if (!attachment || typeof attachment !== "object") {
      throw new NotificationDeliveryError(`Email attachment ${index + 1} is invalid`, false);
    }
    const value = attachment as Record<string, unknown>;
    const filename = normalizeText(value.filename).slice(0, 240);
    const content = normalizeText(value.content);
    if (!filename || !content) {
      throw new NotificationDeliveryError(`Email attachment ${index + 1} is incomplete`, false);
    }
    return { filename, content };
  });

  return { subject, text, html, attachments };
}

function parseSmsPayload(delivery: NotificationDeliveryRow) {
  if (delivery.channel !== "sms") {
    throw new NotificationDeliveryError(`Unsupported notification channel: ${delivery.channel}`, false);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(delivery.payload_json);
  } catch {
    throw new NotificationDeliveryError("Notification payload is not valid JSON", false);
  }

  const record = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  const message = normalizeText(record.message || record.text);
  if (!message) throw new NotificationDeliveryError("SMS notification payload is incomplete", false);
  if (message.length > 1000) throw new NotificationDeliveryError("SMS notification payload is too long", false);
  return { message };
}

export async function sendWithCurrentEmailSender(delivery: NotificationDeliveryRow): Promise<NotificationSendResult> {
  const payload = parseEmailPayload(delivery);
  const config = getEmailConfig();
  if (!config.ready) {
    throw new NotificationDeliveryError(config.errorMessage || "Email is not configured", false);
  }

  const result = await sendProviderEmail({
    to: delivery.recipient,
    subject: payload.subject,
    text: payload.text,
    html: payload.html,
    attachments: payload.attachments,
  }, config);

  return {
    provider: result.provider,
    providerMessageId: result.providerMessageId,
  };
}

export async function sendWithCurrentSmsSender(delivery: NotificationDeliveryRow): Promise<NotificationSendResult> {
  const payload = parseSmsPayload(delivery);
  const config = getSmsConfig();
  if (!config.ready) throw new NotificationDeliveryError(config.errorMessage || "SMS is not configured", false);
  const result = await sendProviderSms({ to: delivery.recipient, message: payload.message }, config);
  return { provider: result.provider, providerMessageId: result.providerMessageId };
}

export async function sendWithCurrentNotificationSender(delivery: NotificationDeliveryRow): Promise<NotificationSendResult> {
  if (delivery.channel === "sms") return sendWithCurrentSmsSender(delivery);
  if (delivery.channel === "email") return sendWithCurrentEmailSender(delivery);
  throw new NotificationDeliveryError(`Unsupported notification channel: ${delivery.channel}`, false);
}

export async function dispatchNotificationDeliveries(
  db: NotificationOutboxDatabase,
  workerId: string,
  sender: NotificationDeliverySender = sendWithCurrentNotificationSender,
  options: DispatchNotificationDeliveriesOptions = {},
): Promise<DispatchNotificationDeliveriesResult> {
  const maxAttempts = Math.max(1, Math.floor(options.maxAttempts || 5));
  const baseBackoffMs = Math.max(1000, Math.floor(options.baseBackoffMs || 30_000));
  const maxBackoffMs = Math.max(baseBackoffMs, Math.floor(options.maxBackoffMs || 15 * 60_000));
  const now = options.now || Date.now;
  const deliveries = await db.claimNotificationDeliveries(workerId, options.limit);
  const result: DispatchNotificationDeliveriesResult = { claimed: deliveries.length, sent: 0, retried: 0, failed: 0 };

  for (const delivery of deliveries) {
    try {
      const sendResult = await sender(delivery);
      await db.markNotificationDeliverySent(
        delivery.id,
        workerId,
        sendResult.providerMessageId,
        sendResult.provider,
      );
      result.sent += 1;
    } catch (error) {
      const message = toErrorMessage(error);
      const retryable = !(error instanceof NotificationDeliveryError) || error.retryable;
      if (retryable && delivery.attempt_count < maxAttempts) {
        const delayMs = Math.min(
          maxBackoffMs,
          baseBackoffMs * (2 ** Math.max(delivery.attempt_count - 1, 0)),
        );
        await db.markNotificationDeliveryRetryable(
          delivery.id,
          workerId,
          message,
          new Date(now() + delayMs).toISOString(),
        );
        result.retried += 1;
      } else {
        await db.markNotificationDeliveryFailed(delivery.id, workerId, message);
        result.failed += 1;
      }
    }
  }

  return result;
}

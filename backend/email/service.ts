import type { AppDatabase } from "../db/types";
import { getEmailConfig } from "./config";
import { sendProviderEmail, type ProviderEmailSendResult } from "./provider";
import type { RenderedTransactionalEmail } from "./templates";

type EmailDeliveryDatabase = Pick<
  AppDatabase,
  "createRegistrationEmailDelivery" | "markRegistrationEmailDeliverySent" | "markRegistrationEmailDeliveryFailed"
>;

export type SendTransactionalEmailInput = {
  db?: EmailDeliveryDatabase;
  to: string;
  template: RenderedTransactionalEmail;
  delivery?: {
    registrationId: string;
    eventId: string;
    kind: string;
  };
};

export type SendTransactionalEmailResult = {
  provider: string;
  deliveryId: string | null;
  providerMessageId: string | null;
  skipped: boolean;
};

function normalizeText(value: unknown) {
  return String(value || "").trim();
}

function toErrorMessage(error: unknown) {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }
  return normalizeText(error) || "Failed to send email";
}

export async function sendTransactionalEmail(input: SendTransactionalEmailInput): Promise<SendTransactionalEmailResult> {
  const config = getEmailConfig();
  const recipient = normalizeText(input.to);
  const deliveryContext = input.delivery;
  const delivery = input.db && deliveryContext
    ? await input.db.createRegistrationEmailDelivery({
      registration_id: deliveryContext.registrationId,
      event_id: deliveryContext.eventId,
      recipient_email: recipient,
      kind: deliveryContext.kind,
      subject: input.template.subject,
      provider: config.provider,
    })
    : null;

  if (input.db && deliveryContext && !delivery) {
    return {
      provider: config.provider,
      deliveryId: null,
      providerMessageId: null,
      skipped: true,
    };
  }

  let sendResult: ProviderEmailSendResult;
  try {
    sendResult = await sendProviderEmail({
      to: recipient,
      subject: input.template.subject,
      text: input.template.text,
      html: input.template.html,
    }, config);
  } catch (error) {
    const message = toErrorMessage(error);
    if (delivery && input.db) {
      await input.db.markRegistrationEmailDeliveryFailed(delivery.id, message, config.provider);
    }
    throw new Error(message);
  }

  if (delivery && input.db) {
    await input.db.markRegistrationEmailDeliverySent(delivery.id, sendResult.provider);
  }

  return {
    provider: sendResult.provider,
    deliveryId: delivery?.id || null,
    providerMessageId: sendResult.providerMessageId,
    skipped: false,
  };
}

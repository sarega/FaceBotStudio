import { formatStoredDateRangeForDisplay, normalizeTimeZone } from "../datetime";
import { buildEventLocationSummary, formatEventLocationCompact, resolveEventMapUrl } from "../../src/lib/eventLocation";
import {
  EMAIL_TEMPLATE_DEFAULTS,
  getEmailTemplateSettingKey,
  replaceEmailTemplateTokens,
  type EmailTemplateKind,
} from "../../src/lib/emailTemplateCatalog";
import { resolveEnglishPublicSlug } from "../../src/lib/publicEventPage";
import { buildAbsoluteAppUrl } from "./config";

export type TransactionalEmailKind = EmailTemplateKind;

export type RenderedTransactionalEmail = {
  kind: TransactionalEmailKind;
  subject: string;
  text: string;
  html: string;
};

export type RegistrationConfirmationTemplateInput = {
  appUrl: string;
  settings: Record<string, string>;
  attendee: {
    registrationId: string;
    firstName?: string | null;
    lastName?: string | null;
  };
  eventId?: string | null;
  eventSlug?: string | null;
  ticketPngUrl?: string | null;
  ticketSvgUrl?: string | null;
  recoveryUrl?: string | null;
  supportEmail?: string | null;
};

export type EventUpdateEmailTemplateInput = {
  appUrl: string;
  settings: Record<string, string>;
  attendee: {
    registrationId: string;
    firstName?: string | null;
    lastName?: string | null;
  };
  eventId?: string | null;
  eventSlug?: string | null;
  updateSummary: string;
  supportEmail?: string | null;
};

export type SampleTransactionalEmailInput = {
  kind: TransactionalEmailKind;
  appUrl: string;
  settings: Record<string, string>;
  eventId?: string | null;
  eventSlug?: string | null;
  supportEmail?: string | null;
};

type TemplateSource = {
  subject: string;
  html: string;
  text: string;
};

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function normalizeText(value: unknown) {
  return String(value || "").trim();
}

function buildFullName(firstName?: string | null, lastName?: string | null) {
  return `${normalizeText(firstName)} ${normalizeText(lastName)}`.trim();
}

function buildEventDateLabel(settings: Record<string, string>) {
  return formatStoredDateRangeForDisplay(
    settings.event_date || "",
    settings.event_end_date || "",
    normalizeTimeZone(settings.event_timezone),
  );
}

function buildEventName(settings: Record<string, string>) {
  return normalizeText(settings.event_name) || "Event";
}

function buildRecoveryUrl(options: {
  appUrl: string;
  settings: Record<string, string>;
  eventId?: string | null;
  eventSlug?: string | null;
}) {
  if (!normalizeText(options.appUrl)) {
    return null;
  }
  if (normalizeText(options.settings.event_public_page_enabled) !== "1") {
    return null;
  }

  const slug = resolveEnglishPublicSlug({
    customSlug: options.settings.event_public_slug,
    eventName: options.settings.event_name,
    eventSlug: options.eventSlug,
    eventId: options.eventId,
  });
  if (!slug) return null;

  return buildAbsoluteAppUrl(options.appUrl, `/events/${encodeURIComponent(slug)}`);
}

function resolveTemplateSource(kind: TransactionalEmailKind, settings: Record<string, string>): TemplateSource {
  const subjectKey = getEmailTemplateSettingKey(kind, "subject");
  const htmlKey = getEmailTemplateSettingKey(kind, "html");
  const textKey = getEmailTemplateSettingKey(kind, "text");
  const fallback = EMAIL_TEMPLATE_DEFAULTS[kind];

  return {
    subject:
      normalizeText(settings[subjectKey])
      || (kind === "registration_confirmation" ? normalizeText(settings.confirmation_email_subject) : "")
      || fallback.subject,
    html: normalizeText(settings[htmlKey]) || fallback.html,
    text: normalizeText(settings[textKey]) || fallback.text,
  };
}

function renderTemplateFromTokens(
  kind: TransactionalEmailKind,
  settings: Record<string, string>,
  tokens: Record<string, string>,
): RenderedTransactionalEmail {
  const source = resolveTemplateSource(kind, settings);
  const htmlTokens = Object.fromEntries(
    Object.entries(tokens).map(([key, value]) => [key, escapeHtml(value)]),
  );
  return {
    kind,
    subject: replaceEmailTemplateTokens(source.subject, tokens).trim(),
    html: replaceEmailTemplateTokens(source.html, htmlTokens),
    text: replaceEmailTemplateTokens(source.text, tokens).trim(),
  };
}

function buildCommonTokens(options: {
  appUrl: string;
  settings: Record<string, string>;
  eventId?: string | null;
  eventSlug?: string | null;
  fullName?: string | null;
  registrationId?: string | null;
  ticketUrl?: string | null;
  supportEmail?: string | null;
}) {
  const locationSummary = buildEventLocationSummary(options.settings);
  const eventPageUrl = buildRecoveryUrl(options) || normalizeText(options.appUrl);

  return {
    app_url: normalizeText(options.appUrl),
    event_name: buildEventName(options.settings),
    full_name: normalizeText(options.fullName) || "Attendee",
    registration_id: normalizeText(options.registrationId),
    event_date: buildEventDateLabel(options.settings),
    event_location: formatEventLocationCompact(options.settings),
    map_url: resolveEventMapUrl(options.settings),
    travel_info: locationSummary.travelInfo,
    ticket_url: normalizeText(options.ticketUrl),
    event_page_url: eventPageUrl,
    support_email: normalizeText(options.supportEmail),
  };
}

export function buildRegistrationConfirmationLinks(options: {
  appUrl: string;
  settings: Record<string, string>;
  registrationId: string;
  eventId?: string | null;
  eventSlug?: string | null;
  includeTicketLinks?: boolean;
  ticketPngUrl?: string | null;
  ticketSvgUrl?: string | null;
}) {
  if (!normalizeText(options.appUrl)) {
    return {
      ticketPngUrl: null,
      ticketSvgUrl: null,
      recoveryUrl: null,
    };
  }

  const includeTicketLinks = options.includeTicketLinks !== false;

  return {
    ticketPngUrl: includeTicketLinks
      ? normalizeText(options.ticketPngUrl) || null
      : null,
    ticketSvgUrl: includeTicketLinks
      ? normalizeText(options.ticketSvgUrl) || null
      : null,
    recoveryUrl: buildRecoveryUrl(options),
  };
}

export function renderRegistrationConfirmationEmail(
  input: RegistrationConfirmationTemplateInput,
): RenderedTransactionalEmail {
  const fullName = buildFullName(input.attendee.firstName, input.attendee.lastName) || "Attendee";
  const ticketUrl = normalizeText(input.ticketPngUrl) || normalizeText(input.ticketSvgUrl);
  const recoveryUrl = normalizeText(input.recoveryUrl)
    || buildRecoveryUrl({
      appUrl: input.appUrl,
      settings: input.settings,
      eventId: input.eventId,
      eventSlug: input.eventSlug,
    })
    || "";

  return renderTemplateFromTokens("registration_confirmation", input.settings, {
    ...buildCommonTokens({
      appUrl: input.appUrl,
      settings: input.settings,
      eventId: input.eventId,
      eventSlug: input.eventSlug,
      fullName,
      registrationId: input.attendee.registrationId,
      ticketUrl,
      supportEmail: input.supportEmail,
    }),
    event_page_url: recoveryUrl || normalizeText(input.appUrl),
  });
}

export function renderEventUpdateEmail(
  input: EventUpdateEmailTemplateInput,
): RenderedTransactionalEmail {
  return renderTemplateFromTokens("event_update", input.settings, {
    ...buildCommonTokens({
      appUrl: input.appUrl,
      settings: input.settings,
      eventId: input.eventId,
      eventSlug: input.eventSlug,
      fullName: buildFullName(input.attendee.firstName, input.attendee.lastName),
      registrationId: input.attendee.registrationId,
      supportEmail: input.supportEmail,
    }),
    update_summary: normalizeText(input.updateSummary),
  });
}

export function renderTicketRecoveryEmail(input: {
  eventName: string;
  eventDate?: string | null;
  eventLocation?: string | null;
  ticketUrl: string;
  supportEmail?: string | null;
}): RenderedTransactionalEmail {
  const eventName = normalizeText(input.eventName) || "your event";
  const eventDate = normalizeText(input.eventDate);
  const eventLocation = normalizeText(input.eventLocation);
  const ticketUrl = normalizeText(input.ticketUrl);
  const supportEmail = normalizeText(input.supportEmail);
  const subject = `Your secure ticket link for ${eventName}`;
  const details = [
    eventDate ? `Date: ${eventDate}` : "",
    eventLocation ? `Location: ${eventLocation}` : "",
  ].filter(Boolean);

  return {
    kind: "ticket_delivery",
    subject,
    text: [
      `Your secure ticket link for ${eventName}`,
      "",
      "Use the link below to open your ticket. The link expires soon.",
      ...details,
      `Open ticket: ${ticketUrl}`,
      supportEmail ? `Support: ${supportEmail}` : "",
    ].filter(Boolean).join("\n"),
    html: `<!DOCTYPE html>
<html lang="en">
  <body style="margin:0;padding:24px;background:#f8fafc;font-family:'Noto Sans Thai',system-ui,sans-serif;color:#0f172a;">
    <div style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:24px;overflow:hidden;">
      <div style="padding:24px;background:#0f172a;color:#ffffff;">
        <p style="margin:0 0 8px;font-size:12px;letter-spacing:.18em;text-transform:uppercase;opacity:.8;">Secure ticket recovery</p>
        <h1 style="margin:0;font-size:28px;">${escapeHtml(eventName)}</h1>
      </div>
      <div style="padding:24px;">
        <p style="margin:0 0 16px;font-size:16px;">Use the secure link below to open your ticket. The link expires soon.</p>
        ${eventDate ? `<p style="margin:0 0 8px;"><strong>Date:</strong> ${escapeHtml(eventDate)}</p>` : ""}
        ${eventLocation ? `<p style="margin:0 0 16px;"><strong>Location:</strong> ${escapeHtml(eventLocation)}</p>` : ""}
        <p style="margin:0 0 16px;"><a href="${escapeHtml(ticketUrl)}" style="display:inline-block;padding:12px 16px;border-radius:12px;background:#111827;color:#ffffff;text-decoration:none;font-weight:700;">Open Ticket</a></p>
        ${supportEmail ? `<p style="margin:0;font-size:13px;color:#64748b;">Support: ${escapeHtml(supportEmail)}</p>` : ""}
      </div>
    </div>
  </body>
</html>`,
  };
}

export function renderSampleTransactionalEmail(
  input: SampleTransactionalEmailInput,
): RenderedTransactionalEmail {
  const registrationId = `TEST-${Date.now().toString(36).toUpperCase()}`;
  const links = buildRegistrationConfirmationLinks({
    appUrl: input.appUrl,
    settings: input.settings,
    registrationId,
    eventId: input.eventId,
    eventSlug: input.eventSlug,
    includeTicketLinks: input.kind !== "event_update" && input.kind !== "magic_link_login",
  });

  const commonTokens = buildCommonTokens({
    appUrl: input.appUrl,
    settings: input.settings,
    eventId: input.eventId,
    eventSlug: input.eventSlug,
    fullName: "Test Attendee",
    registrationId,
    ticketUrl: links.ticketPngUrl || links.ticketSvgUrl || "",
    supportEmail: input.supportEmail,
  });

  const tokens = {
    ...commonTokens,
    payment_amount: "THB 1,500",
    payment_status: "Paid",
    update_summary: "The event schedule has changed. Please review the latest event page before attending.",
    magic_link_url: normalizeText(input.appUrl) ? buildAbsoluteAppUrl(input.appUrl, "/admin") : "",
  };

  return renderTemplateFromTokens(input.kind, input.settings, tokens);
}

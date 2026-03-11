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
}) {
  if (!normalizeText(options.appUrl)) {
    return {
      ticketPngUrl: null,
      ticketSvgUrl: null,
      recoveryUrl: null,
    };
  }

  const encodedRegistrationId = encodeURIComponent(options.registrationId);
  const includeTicketLinks = options.includeTicketLinks !== false;

  return {
    ticketPngUrl: includeTicketLinks
      ? buildAbsoluteAppUrl(options.appUrl, `/api/tickets/${encodedRegistrationId}.png`)
      : null,
    ticketSvgUrl: includeTicketLinks
      ? buildAbsoluteAppUrl(options.appUrl, `/api/tickets/${encodedRegistrationId}.svg`)
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

import { formatStoredDateRangeForDisplay, normalizeTimeZone } from "../datetime";
import { buildEventLocationSummary, formatEventLocationCompact, resolveEventMapUrl } from "../../src/lib/eventLocation";
import { resolveEnglishPublicSlug } from "../../src/lib/publicEventPage";
import { buildAbsoluteAppUrl } from "./config";

export type TransactionalEmailKind =
  | "registration_confirmation"
  | "ticket_delivery"
  | "payment_confirmation"
  | "magic_link_login";

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
  subjectTemplate?: string | null;
  eventId?: string | null;
  eventSlug?: string | null;
  ticketPngUrl?: string | null;
  ticketSvgUrl?: string | null;
  recoveryUrl?: string | null;
  sample?: boolean;
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

export function renderRegistrationConfirmationSubject(
  template: string | null | undefined,
  attendee: RegistrationConfirmationTemplateInput["attendee"],
  settings: Record<string, string>,
) {
  const source = normalizeText(template) || "Your registration for {{event_name}}";
  const fullName = buildFullName(attendee.firstName, attendee.lastName);
  const eventName = buildEventName(settings);
  const eventDate = buildEventDateLabel(settings);

  return source
    .replace(/\{\{\s*event_name\s*\}\}/gi, eventName)
    .replace(/\{\{\s*registration_id\s*\}\}/gi, attendee.registrationId)
    .replace(/\{\{\s*full_name\s*\}\}/gi, fullName || attendee.registrationId)
    .replace(/\{\{\s*event_date\s*\}\}/gi, eventDate)
    .trim();
}

export function renderRegistrationConfirmationEmail(
  input: RegistrationConfirmationTemplateInput,
): RenderedTransactionalEmail {
  const subject = renderRegistrationConfirmationSubject(input.subjectTemplate, input.attendee, input.settings);
  const eventName = buildEventName(input.settings);
  const fullName = buildFullName(input.attendee.firstName, input.attendee.lastName) || "Attendee";
  const locationSummary = buildEventLocationSummary(input.settings);
  const locationLabel = formatEventLocationCompact(input.settings);
  const eventDate = buildEventDateLabel(input.settings);
  const mapUrl = resolveEventMapUrl(input.settings);
  const travelInfo = locationSummary.travelInfo;
  const ticketUrl = normalizeText(input.ticketPngUrl) || normalizeText(input.ticketSvgUrl);
  const recoveryUrl = normalizeText(input.recoveryUrl)
    || buildRecoveryUrl({
      appUrl: input.appUrl,
      settings: input.settings,
      eventId: input.eventId,
      eventSlug: input.eventSlug,
    })
    || "";
  const escapedSubject = escapeHtml(subject);
  const escapedEventName = escapeHtml(eventName);
  const escapedFullName = escapeHtml(fullName);
  const escapedRegistrationId = escapeHtml(input.attendee.registrationId);
  const escapedEventDate = escapeHtml(eventDate);
  const escapedLocation = escapeHtml(locationLabel);
  const escapedMapUrl = escapeHtml(mapUrl);
  const escapedTravelInfo = escapeHtml(travelInfo);
  const escapedTicketUrl = escapeHtml(ticketUrl);
  const escapedRecoveryUrl = escapeHtml(recoveryUrl);
  const intro = input.sample
    ? `Hello ${escapedFullName}, this is a sample registration confirmation for ${escapedEventName}.`
    : `Hello ${escapedFullName}, your registration is confirmed.`;

  const textLines = [
    input.sample ? "Sample registration confirmation" : "Registration confirmed",
    "",
    `Event: ${eventName}`,
    `Name: ${fullName}`,
    `Registration ID: ${input.attendee.registrationId}`,
    `Date: ${eventDate}`,
    `Location: ${locationLabel}`,
    mapUrl ? `Map: ${mapUrl}` : "",
    travelInfo ? `Travel: ${travelInfo}` : "",
    ticketUrl ? `Ticket: ${ticketUrl}` : "",
    recoveryUrl ? `Recovery: ${recoveryUrl}` : "",
  ].filter(Boolean);

  const html = `<!DOCTYPE html>
<html lang="en">
  <body style="margin:0;padding:24px;background:#f3f6fb;font-family:'Noto Sans Thai',system-ui,sans-serif;color:#0f172a;">
    <div style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #dbe4f0;border-radius:24px;overflow:hidden;">
      <div style="padding:24px 24px 18px;background:linear-gradient(135deg,#2857f0 0%,#3567f6 100%);color:#ffffff;">
        <p style="margin:0 0 8px;font-size:12px;letter-spacing:.18em;text-transform:uppercase;opacity:.85;">${input.sample ? "Sample email" : "Registration confirmed"}</p>
        <h1 style="margin:0;font-size:28px;line-height:1.2;">${escapedEventName}</h1>
      </div>
      <div style="padding:24px;">
        <p style="margin:0 0 12px;font-size:16px;">${intro}</p>
        <div style="border:1px solid #dbe4f0;border-radius:18px;padding:16px 18px;background:#f8fbff;">
          <p style="margin:0 0 8px;"><strong>Registration ID:</strong> ${escapedRegistrationId}</p>
          <p style="margin:0 0 8px;"><strong>Date:</strong> ${escapedEventDate}</p>
          <p style="margin:0;"><strong>Location:</strong> ${escapedLocation}</p>
        </div>
        ${ticketUrl ? `<div style="margin-top:18px;"><a href="${escapedTicketUrl}" style="display:inline-block;padding:12px 16px;border-radius:12px;background:#2857f0;color:#ffffff;text-decoration:none;font-weight:700;">Open Ticket</a></div>` : ""}
        ${mapUrl ? `<p style="margin:18px 0 0;"><a href="${escapedMapUrl}" style="color:#2857f0;">Open Map</a></p>` : ""}
        ${recoveryUrl ? `<p style="margin:18px 0 0;"><a href="${escapedRecoveryUrl}" style="color:#2857f0;">Open Event Page</a></p>` : ""}
        ${travelInfo ? `<p style="margin:18px 0 0;font-size:14px;line-height:1.6;color:#334155;"><strong>Travel:</strong> ${escapedTravelInfo}</p>` : ""}
      </div>
      <div style="padding:14px 24px;background:#f8fafc;border-top:1px solid #e2e8f0;font-size:12px;color:#64748b;">
        ${escapedSubject}
      </div>
    </div>
  </body>
</html>`;

  return {
    kind: "registration_confirmation",
    subject,
    text: textLines.join("\n"),
    html,
  };
}

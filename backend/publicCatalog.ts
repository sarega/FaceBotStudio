export type PublicCatalogAvailabilityState =
  | "open"
  | "not_started"
  | "closed"
  | "full"
  | "invalid"
  | "tickets_available"
  | "tickets_unavailable"
  | "external";

export function normalizePublicExternalTicketUrl(value: unknown) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const url = new URL(raw);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : "";
  } catch {
    return "";
  }
}

export function hasPublicCatalogAction(input: {
  registrationEnabled: boolean;
  externalTicketUrl: string;
  directTicketingEnabled: boolean;
}) {
  return input.registrationEnabled || Boolean(input.externalTicketUrl) || input.directTicketingEnabled;
}

export function resolvePublicCatalogAvailability(input: {
  registrationEnabled: boolean;
  registrationAvailability: string;
  externalTicketUrl: string;
  directTicketingEnabled: boolean;
  availableSeatCount: number;
}): { state: PublicCatalogAvailabilityState; label: string } {
  if (input.directTicketingEnabled && input.availableSeatCount > 0) {
    return { state: "tickets_available", label: "Tickets available" };
  }
  if (input.registrationEnabled && input.registrationAvailability === "open") {
    return { state: "open", label: "Registration open" };
  }
  if (input.externalTicketUrl) {
    return { state: "external", label: "Ticket link available" };
  }
  if (input.directTicketingEnabled) {
    return { state: "tickets_unavailable", label: "Tickets unavailable" };
  }
  if (input.registrationAvailability === "not_started") {
    return { state: "not_started", label: "Opens soon" };
  }
  if (input.registrationAvailability === "full") {
    return { state: "full", label: "Full" };
  }
  if (input.registrationAvailability === "closed") {
    return { state: "closed", label: "Registration closed" };
  }
  return { state: "invalid", label: "Unavailable" };
}

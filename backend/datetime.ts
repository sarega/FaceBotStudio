const DEFAULT_TIMEZONE = process.env.EVENT_TIMEZONE || "Asia/Bangkok";

type DateTimeParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
};

export type RegistrationWindowState = "open" | "not_started" | "closed";
export type ManualEventStatus = "pending" | "active" | "cancelled";
export type EventStatus = ManualEventStatus | "closed";

function parseDateTimeLocalInput(value: string): DateTimeParts | null {
  const match = String(value || "")
    .trim()
    .match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);

  if (!match) return null;

  return {
    year: Number.parseInt(match[1], 10),
    month: Number.parseInt(match[2], 10),
    day: Number.parseInt(match[3], 10),
    hour: Number.parseInt(match[4], 10),
    minute: Number.parseInt(match[5], 10),
  };
}

function getOffsetMinutes(date: Date, timeZone: string) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "shortOffset",
  });
  const parts = formatter.formatToParts(date);
  const token = parts.find((part) => part.type === "timeZoneName")?.value || "GMT";
  const match = token.match(/^GMT([+-])(\d{1,2})(?::(\d{2}))?$/i);
  if (!match) return 0;

  const sign = match[1] === "-" ? -1 : 1;
  const hours = Number.parseInt(match[2], 10);
  const minutes = Number.parseInt(match[3] || "0", 10);
  return sign * (hours * 60 + minutes);
}

export function normalizeTimeZone(value: string | undefined) {
  const timeZone = String(value || "").trim();
  if (!timeZone) return DEFAULT_TIMEZONE;

  try {
    Intl.DateTimeFormat("en-US", { timeZone }).format(new Date());
    return timeZone;
  } catch {
    return DEFAULT_TIMEZONE;
  }
}

export function zonedDateTimeToUtc(value: string, timeZone: string) {
  const parts = parseDateTimeLocalInput(value);
  if (!parts) return null;

  const zone = normalizeTimeZone(timeZone);
  let instant = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, 0));
  for (let i = 0; i < 2; i += 1) {
    const offsetMinutes = getOffsetMinutes(instant, zone);
    instant = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, 0) - offsetMinutes * 60_000);
  }
  return instant;
}

export function formatInTimeZone(date: Date, timeZone: string) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: normalizeTimeZone(timeZone),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

export function getEventState(settings: Record<string, string>, now = new Date()) {
  const timeZone = normalizeTimeZone(settings.event_timezone);
  const start = zonedDateTimeToUtc(settings.reg_start || "", timeZone);
  const end = zonedDateTimeToUtc(settings.reg_end || "", timeZone);
  let registrationStatus: RegistrationWindowState = "open";

  if (start && now < start) {
    registrationStatus = "not_started";
  } else if (end && now > end) {
    registrationStatus = "closed";
  }

  const eventDate = zonedDateTimeToUtc(settings.event_date || "", timeZone);
  let eventLifecycle = "unscheduled";
  if (eventDate) {
    if (now.getTime() < eventDate.getTime()) {
      eventLifecycle = "upcoming";
    } else {
      eventLifecycle = "past";
    }
  }

  return {
    now,
    timeZone,
    start,
    end,
    eventDate,
    registrationStatus,
    eventLifecycle,
    nowLabel: formatInTimeZone(now, timeZone),
    startLabel: start ? formatInTimeZone(start, timeZone) : "-",
    endLabel: end ? formatInTimeZone(end, timeZone) : "-",
    eventDateLabel: eventDate ? formatInTimeZone(eventDate, timeZone) : settings.event_date || "-",
  };
}

export function getEffectiveEventStatus(
  manualStatus: string | undefined,
  settings: Record<string, string>,
  now = new Date(),
): EventStatus {
  const normalizedManual = String(manualStatus || "").trim().toLowerCase();
  if (normalizedManual === "cancelled") {
    return "cancelled";
  }

  const eventState = getEventState(settings, now);
  if (eventState.eventDate && now.getTime() >= eventState.eventDate.getTime()) {
    return "closed";
  }

  if (normalizedManual === "pending") {
    return "pending";
  }

  return "active";
}

export function formatStoredDateForDisplay(value: string, timeZone: string) {
  const instant = zonedDateTimeToUtc(value, timeZone);
  if (!instant) return value || "-";
  return formatInTimeZone(instant, timeZone);
}

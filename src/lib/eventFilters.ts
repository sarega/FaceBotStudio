import type { EventRecord } from "../types";
export type EventFilter = "current" | "all" | "active" | "upcoming" | "pending" | "inactive" | "past" | "closed" | "cancelled" | "archived" | "assigned";
export const EVENT_FILTERS: {id: EventFilter; label: string}[] = [
  {id:"current",label:"Current"}, {id:"active",label:"Live"}, {id:"upcoming",label:"Upcoming"}, {id:"pending",label:"Draft / Pending"},
  {id:"inactive",label:"Inactive"}, {id:"past",label:"Past"}, {id:"closed",label:"Completed"}, {id:"cancelled",label:"Cancelled"},
  {id:"archived",label:"Archive"}, {id:"all",label:"All Events"}, {id:"assigned",label:"Assigned Only"}
];
export function eventMatchesFilter(event: EventRecord, filter: EventFilter, selected: readonly string[] = [], now = new Date()) {
  const status = event.effective_status;
  switch(filter) {
    case "all": return true;
    case "current": return status === "active" || status === "pending";
    case "past": return status === "closed" || status === "cancelled";
    case "assigned": return selected.includes(event.id);
    case "upcoming": {
      if (status !== "active" && status !== "pending" && status !== "inactive") return false;
      if (!event.event_date) return false;
      // Compare the stored local start against the current wall clock in the event's timezone.
      try {
        const parts = new Intl.DateTimeFormat("en-CA",{timeZone:event.event_timezone || "Asia/Bangkok",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(now);
        const get = (key:string) => parts.find(p=>p.type===key)?.value || "";
        const local = get("year")+"-"+get("month")+"-"+get("day")+"T"+get("hour")+":"+get("minute");
        return event.event_date.slice(0,16).replace(" ","T") > local;
      } catch { return false; }
    }
    default: return status === filter;
  }
}
export function eventMatchesText(event: EventRecord, query: string) {
  const haystack = [event.name,event.slug,event.organizer_name,event.effective_status,event.event_type,event.event_date].filter(Boolean).join(" ").toLocaleLowerCase();
  return query.trim().toLocaleLowerCase().split(/\s+/).every(word=>haystack.includes(word));
}

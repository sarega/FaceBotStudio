import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { translate, type AppLanguage } from "../../../lib/i18n";
import { buildSpatialSeatLayout } from "../seatMapLayout";

type Performance = { id: string; code: string; title: string; starts_at: string; seat_plan_image_url: string | null };
type Seat = { id: string; performance_id: string; zone: string; section_label?: string | null; row_label: string; seat_label: string; external_seat_ref?: string | null; ticket_class?: string | null; status: string; allocation_status?: "allocated" | "not_allocated"; source_status?: "available" | "sold" | "generated" | "blocked" | "unknown"; face_value: number | null; x?: number | null; y?: number | null };
type SeatDraft = { zone: string; section_label: string; row_label: string; seat_label: string; external_seat_ref: string; ticket_class: string; face_value: string; x: string; y: string; allocation_status: "allocated" | "not_allocated"; source_status: "available" | "sold" | "generated" | "blocked" | "unknown" };
type SeatMapReview = { rows: SeatDraft[]; zones: string[]; added: number; removed: number; changed: number; unchanged: number; protectedCount: number; sourceNames: string[] };
type ProcessingState = { phase: "analyzing" | "preparing" | "saving"; completed: number; total: number; label: string; startedAt: number };
type Ticket = { id: string; performance_id: string; ticket_class: string; holder_name: string; buyer_name: string; phone?: string; email?: string; price_amount: number; payment_status: string; status: string; delivery_status?: "unsent" | "sent"; delivery_method?: "email" | "manual" | null; delivery_sent_at?: string | null; hold_expires_at?: string | null; has_payment_proof?: boolean; performance_title?: string; zone?: string; row_label?: string; seat_label?: string; delivery?: { png_url: string; pdf_url: string; email_pdf_url?: string } | null; share_delivery?: { png_url: string; pdf_url: string; email_pdf_url?: string } | null };
type Order = { id: string; status: string; total_amount: number; currency?: string; buyer_name: string; payment_proof_submitted_at?: string | null; rejection_reason?: string | null; performance_title?: string; tickets: Array<{ id: string; has_payment_proof?: boolean; status: string }> };
type TicketClassPreset = { id: string; name: string; price_amount: number; payment_required: boolean; primary_color: string; accent_color: string };
type TicketDesign = { event_name: string; direct_ticket_artwork_url: string; direct_ticket_artwork_mode: "panel" | "background"; direct_ticket_artwork_opacity: string; direct_ticket_primary_color: string; direct_ticket_accent_color: string; direct_ticket_heading: string; direct_ticket_note: string };

type Props = { eventId: string; apiFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>; canManage: boolean; language: AppLanguage };
type DirectTicketingSection = "settings" | "import" | "manage";

const csvRows = (text: string) => {
  const [headerLine, ...lines] = text.trim().split(/\r?\n/); const headers = headerLine?.split(",").map((v) => v.trim().toLowerCase()) || [];
  return lines.map((line) => Object.fromEntries(line.split(",").map((value, index) => [headers[index], value.trim()]))).filter((row) => row.zone && (row.row_label || row.row) && (row.seat_label || row.seat));
};
const blankSeatDraft = (): SeatDraft => ({ zone: "", section_label: "", row_label: "", seat_label: "", external_seat_ref: "", ticket_class: "", face_value: "", x: "", y: "", allocation_status: "allocated", source_status: "unknown" });
const parseSeatDrafts = (text: string): SeatDraft[] => csvRows(text).map((row) => ({ zone: row.zone || "", section_label: row.section_label || row.section || "", row_label: row.row_label || row.row || "", seat_label: row.seat_label || row.seat || "", external_seat_ref: row.external_seat_ref || "", ticket_class: row.ticket_class || "", face_value: row.face_value || "", x: row.x || "", y: row.y || "", allocation_status: row.allocation_status === "not_allocated" ? "not_allocated" : "allocated", source_status: ["available", "sold", "generated", "blocked", "unknown"].includes(row.source_status) ? row.source_status as SeatDraft["source_status"] : "unknown" }));
const seatDraftCsv = (rows: SeatDraft[]) => ["zone,section_label,row_label,seat_label,external_seat_ref,ticket_class,face_value,x,y,allocation_status,source_status", ...rows.filter((row) => row.zone && row.row_label && row.seat_label).map((row) => [row.zone, row.section_label, row.row_label, row.seat_label, row.external_seat_ref, row.ticket_class, row.face_value, row.x, row.y, row.allocation_status, row.source_status].map((value) => String(value).replaceAll(",", " ")).join(","))].join("\n");
const normalizeSeatDrafts = (rows: SeatDraft[]) => rows.filter((row) => row.zone.trim() && row.row_label.trim() && row.seat_label.trim()).map((row) => ({ zone: row.zone.trim(), section_label: row.section_label.trim() || null, row_label: row.row_label.trim(), seat_label: row.seat_label.trim(), external_seat_ref: row.external_seat_ref.trim() || null, ticket_class: row.ticket_class.trim() || null, face_value: Number(row.face_value) || null, x: Number.isFinite(Number(row.x)) ? Number(row.x) : null, y: Number.isFinite(Number(row.y)) ? Number(row.y) : null, allocation_status: row.allocation_status, source_status: row.source_status }));
const seatDraftKey = (row: Pick<SeatDraft, "zone" | "section_label" | "row_label" | "seat_label">) => `${row.zone}\u0000${row.section_label}\u0000${row.row_label}\u0000${row.seat_label}`;
const seatDraftFingerprint = (row: SeatDraft) => [row.section_label, row.external_seat_ref, row.ticket_class, row.face_value, row.x, row.y, row.allocation_status, row.source_status].join("\u0000");
const naturalLabelCompare = (left: string, right: string) => left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" });
const DIRECT_TICKET_ZONE_GROUPS: Record<string, string[]> = {
  all: [],
  "zones-1-6": Array.from({ length: 6 }, (_, index) => `ZONE ${index + 1}`),
  "zones-7-9": Array.from({ length: 3 }, (_, index) => `ZONE ${index + 7}`),
};
const ticketMatchesZones = (ticketZone: string | undefined, requestedZones: string[]) => {
  if (!requestedZones.length) return true;
  const value = String(ticketZone || "").trim().toLocaleLowerCase();
  return requestedZones.some((zone) => {
    const requested = zone.trim().toLocaleLowerCase();
    return value === requested || value.startsWith(`${requested} `);
  });
};
const ticketRecipientName = (ticket: Pick<Ticket, "holder_name" | "buyer_name">) => ticket.holder_name?.trim() || ticket.buyer_name?.trim() || "—";
const seatMapContextFromFilename = (filename: string) => {
  const zoneMatch = filename.match(/zone\s*([0-9]+)/i);
  const price = /premium/i.test(filename) ? 1500 : /standard\s*plus/i.test(filename) ? 1000 : /standard/i.test(filename) ? 800 : null;
  return { zone: zoneMatch ? `ZONE ${zoneMatch[1]}` : "", section_label: /premium/i.test(filename) ? "Premium" : /standard\s*plus/i.test(filename) ? "Standard Plus" : /standard/i.test(filename) ? "Standard" : "", price };
};
const isSeatMapOverview = (filename: string) => /seat\s*plan|overview|all\s*zones?|seat\s*map/i.test(filename);
const toDateTimeInputValue = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 16);
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

const DEFAULT_TICKET_DESIGN: TicketDesign = {
  event_name: "Your Event",
  direct_ticket_artwork_url: "",
  direct_ticket_artwork_mode: "panel",
  direct_ticket_artwork_opacity: "0.18",
  direct_ticket_primary_color: "#321d48",
  direct_ticket_accent_color: "#d8b66a",
  direct_ticket_heading: "DIRECT SEAT TICKET",
  direct_ticket_note: "Please present this ticket at the entrance.",
};
const DEFAULT_TICKET_CLASSES: TicketClassPreset[] = [
  { id: "vip", name: "VIP", price_amount: 0, payment_required: true, primary_color: "#7f1d1d", accent_color: "#f5d06b" },
  { id: "complimentary", name: "Complimentary", price_amount: 0, payment_required: false, primary_color: "#475569", accent_color: "#cbd5e1" },
];
const CLASS_COLOR_PRESETS = [
  { primary_color: "#7f1d1d", accent_color: "#f5d06b" },
  { primary_color: "#475569", accent_color: "#cbd5e1" },
  { primary_color: "#92400e", accent_color: "#fde68a" },
  { primary_color: "#1e3a8a", accent_color: "#93c5fd" },
  { primary_color: "#166534", accent_color: "#86efac" },
];
const validHexColor = (value: unknown) => typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
const parseTicketClasses = (value: unknown): TicketClassPreset[] => {
  try {
    const parsed = JSON.parse(String(value || ""));
    if (!Array.isArray(parsed)) return DEFAULT_TICKET_CLASSES;
    return parsed.slice(0, 20).map((item, index) => ({ id: String(item.id || `class-${index}`), name: String(item.name || "").trim().slice(0, 80), price_amount: Math.max(0, Number(item.price_amount) || 0), payment_required: item.payment_required !== false, primary_color: validHexColor(item.primary_color) ? item.primary_color : CLASS_COLOR_PRESETS[index % CLASS_COLOR_PRESETS.length].primary_color, accent_color: validHexColor(item.accent_color) ? item.accent_color : CLASS_COLOR_PRESETS[index % CLASS_COLOR_PRESETS.length].accent_color })).filter((item) => item.name);
  } catch { return DEFAULT_TICKET_CLASSES; }
};

export function DirectTicketingScreen({ eventId, apiFetch, canManage, language }: Props) {
  const t = (key: string, fallback: string) => translate(language, `directTickets.${key}`, fallback);
  const formatNumber = (value: number) => new Intl.NumberFormat(language === "th" ? "th-TH" : "en-US").format(value);
  const statusLabel = (status: string) => t(`status.${status}`, status);
  const paymentLabel = (status: string) => t(`payment.${status}`, status);
  const [performances, setPerformances] = useState<Performance[]>([]); const [seats, setSeats] = useState<Seat[]>([]); const [tickets, setTickets] = useState<Ticket[]>([]); const [orders, setOrders] = useState<Order[]>([]);
  const [performanceId, setPerformanceId] = useState(""); const [message, setMessage] = useState(""); const [busy, setBusy] = useState(false);
  const [editingPerformanceId, setEditingPerformanceId] = useState<string | null>(null);
  const [performanceForm, setPerformanceForm] = useState({ code: "", title: "", starts_at: "", seat_plan_image_url: "" });
  const [ticketForm, setTicketForm] = useState({ seat_id: "", ticket_class: "VIP", holder_name: "", buyer_name: "", phone: "", email: "", price_amount: "", payment_required: true, hold_minutes: "15" });
  const [selectedSeatIds, setSelectedSeatIds] = useState<string[]>([]);
  const [ticketCreationProgress, setTicketCreationProgress] = useState<{ completed: number; total: number } | null>(null);
  const [ticketClasses, setTicketClasses] = useState<TicketClassPreset[]>(DEFAULT_TICKET_CLASSES);
  const [previewTicketClass, setPreviewTicketClass] = useState("VIP");
  const [newClass, setNewClass] = useState({ name: "", price_amount: "", payment_required: true, primary_color: "#1d4ed8", accent_color: "#bfdbfe" });
  const [seatDrafts, setSeatDrafts] = useState<SeatDraft[]>([blankSeatDraft()]);
  const [seatMapImageUrl, setSeatMapImageUrl] = useState(""); const [seatMapFile, setSeatMapFile] = useState<File | null>(null); const [seatMapSourceNames, setSeatMapSourceNames] = useState<string[]>([]); const [seatMapZoom, setSeatMapZoom] = useState("1"); const [seatTableZoom, setSeatTableZoom] = useState("0.75"); const [seatMapZone, setSeatMapZone] = useState(""); const [seatMapView, setSeatMapView] = useState<"map" | "table">("map"); const [showSeatMapImage, setShowSeatMapImage] = useState(false); const [utilityPaneWidth, setUtilityPaneWidth] = useState("380"); const [zoneOverviewMode, setZoneOverviewMode] = useState<"docked" | "floating">("docked"); const [zoneOverviewWidth, setZoneOverviewWidth] = useState("380"); const [zoneOverviewOffset, setZoneOverviewOffset] = useState({ x: 16, y: 80 }); const [zoneLayoutOrder, setZoneLayoutOrder] = useState<string[]>([]); const [zoneLayoutPositions, setZoneLayoutPositions] = useState<Record<string, { row: number; col: number }>>({}); const [batchPrice, setBatchPrice] = useState(""); const [batchTicketClass, setBatchTicketClass] = useState(""); const [batchPriceSection, setBatchPriceSection] = useState(""); const [ticketSearch, setTicketSearch] = useState(""); const [ticketStatusFilter, setTicketStatusFilter] = useState("all"); const [ticketPerformanceFilter, setTicketPerformanceFilter] = useState("all"); const [ticketZoneFilter, setTicketZoneFilter] = useState("all"); const [ticketBuyerFilter, setTicketBuyerFilter] = useState("all"); const [ticketRecipientFilter, setTicketRecipientFilter] = useState("all"); const [ticketExportZoneGroup, setTicketExportZoneGroup] = useState("all");
  const zoneOverviewDragRef = useRef<{ pointerX: number; pointerY: number; x: number; y: number } | null>(null);
  const [seatMapReview, setSeatMapReview] = useState<SeatMapReview | null>(null); const [rescanPending, setRescanPending] = useState(false); const [rescanZones, setRescanZones] = useState<string[]>([]);
  const [processing, setProcessing] = useState<ProcessingState | null>(null); const [processingElapsed, setProcessingElapsed] = useState(0);
  const [activeSection, setActiveSection] = useState<DirectTicketingSection>("import");
  const [design, setDesign] = useState<TicketDesign>(DEFAULT_TICKET_DESIGN);
  const load = async () => {
    if (!eventId) return;
    try {
      const query = `event_id=${encodeURIComponent(eventId)}`;
      const [performanceResponse, ticketResponse, orderResponse] = await Promise.all([apiFetch(`/api/direct-ticketing/performances?${query}`), apiFetch(`/api/direct-ticketing/tickets?${query}`), apiFetch(`/api/direct-ticketing/orders?${query}`)]);
      const [nextPerformances, nextTickets, nextOrders] = await Promise.all([performanceResponse.json(), ticketResponse.json(), orderResponse.json()]);
      const failed = [performanceResponse, ticketResponse, orderResponse].find((response) => !response.ok);
      if (failed) {
        const data = [nextPerformances, nextTickets, nextOrders][[performanceResponse, ticketResponse, orderResponse].indexOf(failed)] as { error?: string };
        throw new Error(data?.error || t("couldNotLoadTickets", "Could not load direct-ticket data"));
      }
      setPerformances(Array.isArray(nextPerformances) ? nextPerformances : []);
      setTickets(Array.isArray(nextTickets) ? nextTickets : []);
      setOrders(Array.isArray(nextOrders) ? nextOrders : []);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t("couldNotLoadTickets", "Could not load direct-ticket data"));
    }
  };
  useEffect(() => { void load(); }, [eventId]);
  useEffect(() => {
    if (!eventId) return;
    void apiFetch(`/api/settings?event_id=${encodeURIComponent(eventId)}`).then((response) => response.json()).then((settings) => { setTicketClasses(parseTicketClasses(settings.direct_ticket_classes_json)); setDesign({
      event_name: String(settings.event_name || DEFAULT_TICKET_DESIGN.event_name),
      direct_ticket_artwork_url: String(settings.direct_ticket_artwork_url || ""),
      direct_ticket_artwork_mode: settings.direct_ticket_artwork_mode === "background" ? "background" : "panel",
      direct_ticket_artwork_opacity: String(Math.min(0.6, Math.max(0, Number(settings.direct_ticket_artwork_opacity ?? DEFAULT_TICKET_DESIGN.direct_ticket_artwork_opacity) || 0.18))),
      direct_ticket_primary_color: /^#[0-9a-f]{6}$/i.test(settings.direct_ticket_primary_color) ? settings.direct_ticket_primary_color : DEFAULT_TICKET_DESIGN.direct_ticket_primary_color,
      direct_ticket_accent_color: /^#[0-9a-f]{6}$/i.test(settings.direct_ticket_accent_color) ? settings.direct_ticket_accent_color : DEFAULT_TICKET_DESIGN.direct_ticket_accent_color,
      direct_ticket_heading: String(settings.direct_ticket_heading || DEFAULT_TICKET_DESIGN.direct_ticket_heading),
      direct_ticket_note: String(settings.direct_ticket_note ?? DEFAULT_TICKET_DESIGN.direct_ticket_note),
    }); }).catch(() => setMessage(t("couldNotLoadDesign", "Could not load ticket design")));
  }, [eventId]);
  useEffect(() => { setSelectedSeatIds([]); if (!performanceId) { setSeats([]); return; } void apiFetch(`/api/direct-ticketing/seats?event_id=${encodeURIComponent(eventId)}&performance_id=${encodeURIComponent(performanceId)}`).then((r) => r.json()).then((data) => setSeats(Array.isArray(data) ? data : [])); }, [eventId, performanceId]);
  useEffect(() => { if (!performanceId) { setSeatDrafts([blankSeatDraft()]); return; } if (seats.length) setSeatDrafts(seats.map((seat) => ({ zone: seat.zone, section_label: seat.section_label || "", row_label: seat.row_label, seat_label: seat.seat_label, external_seat_ref: seat.external_seat_ref || "", ticket_class: seat.ticket_class || "", face_value: seat.face_value == null ? "" : String(seat.face_value), x: seat.x == null ? "" : String(seat.x), y: seat.y == null ? "" : String(seat.y), allocation_status: seat.allocation_status === "not_allocated" ? "not_allocated" : "allocated", source_status: seat.source_status || "unknown" }))); else setSeatDrafts([blankSeatDraft()]); }, [performanceId, seats]);
  const selectedPerformance = useMemo(() => performances.find((item) => item.id === performanceId), [performances, performanceId]);
  const setActivePerformance = (nextPerformanceId: string) => {
    setPerformanceId(nextPerformanceId);
    setEditingPerformanceId(null);
    setPerformanceForm({ code: "", title: "", starts_at: "", seat_plan_image_url: "" });
  };
  const beginNewPerformance = () => {
    setActivePerformance("");
    setActiveSection("import");
  };
  useEffect(() => { if (!performanceId && activeSection === "manage") setActiveSection("import"); }, [activeSection, performanceId]);
  const startEditingPerformance = () => {
    if (!selectedPerformance) return;
    setPerformanceForm({ code: selectedPerformance.code, title: selectedPerformance.title, starts_at: toDateTimeInputValue(selectedPerformance.starts_at), seat_plan_image_url: selectedPerformance.seat_plan_image_url || "" });
    setEditingPerformanceId(selectedPerformance.id);
  };
  const deletePerformance = async () => {
    if (!selectedPerformance || busy) return;
    if (!window.confirm(`${t("deleteConfirm", "Delete performance")} ${selectedPerformance.code} — ${selectedPerformance.title}? ${t("deleteWarning", "This removes the performance and its imported seats. Tickets must be cleared first.")}`)) return;
    setBusy(true); setMessage("");
    try {
      const deletePath = `/api/direct-ticketing/performances/${encodeURIComponent(selectedPerformance.id)}`;
      let response = await apiFetch(deletePath, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ event_id: eventId }) });
      let data = await response.json().catch(() => ({}));
      if (response.status === 409) {
        const resetResponse = await apiFetch(`/api/direct-ticketing/performances/${encodeURIComponent(selectedPerformance.id)}/reset`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ event_id: eventId }) });
        const resetData = await resetResponse.json().catch(() => ({}));
        if (!resetResponse.ok) throw new Error(resetData.error || t("couldNotResetPerformance", "Could not reset performance"));
        response = await apiFetch(deletePath, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ event_id: eventId }) });
        data = await response.json().catch(() => ({}));
      }
      if (!response.ok) {
        setMessage(response.status === 409 ? t("deleteBlockedTickets", "Delete the tickets first, or reset this performance before deleting it.") : data.error || t("couldNotDeletePerformance", "Could not delete performance"));
        return;
      }
      await load();
      setPerformanceId(""); setEditingPerformanceId(null); setPerformanceForm({ code: "", title: "", starts_at: "", seat_plan_image_url: "" }); setSeats([]); setSeatDrafts([blankSeatDraft()]);
      setMessage(`${t("performanceDeleted", "Performance deleted")} — ${data.seats || 0} ${t("seats", "seats")}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t("couldNotDeletePerformance", "Could not delete performance"));
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => { setSeatMapFile(null); setSeatMapSourceNames([]); setSeatMapReview(null); setRescanPending(false); setRescanZones([]); setSeatMapImageUrl(selectedPerformance?.seat_plan_image_url || ""); setShowSeatMapImage(false); setSeatMapZone(""); }, [performanceId, selectedPerformance?.seat_plan_image_url]);
  useEffect(() => {
    if (!processing) { setProcessingElapsed(0); return; }
    const update = () => setProcessingElapsed(Math.max(0, Math.floor((Date.now() - processing.startedAt) / 1000)));
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [processing?.startedAt]);
  const availableSeats = useMemo(() => seats.filter((seat) => seat.status === "available" && seat.allocation_status !== "not_allocated"), [seats]);
  const seatMapZones = useMemo(() => Array.from(new Set((seats.length ? seats : normalizeSeatDrafts(seatDrafts)).map((seat) => seat.zone).filter(Boolean))).sort(naturalLabelCompare), [seats, seatDrafts]);
  const filteredAvailableSeats = useMemo(() => seatMapZone ? availableSeats.filter((seat) => seat.zone === seatMapZone) : availableSeats, [seatMapZone, availableSeats]);
  const filteredTickets = useMemo(() => {
    const query = ticketSearch.trim().toLocaleLowerCase();
    return tickets.filter((ticket) => {
      if (ticketStatusFilter !== "all" && ticket.status !== ticketStatusFilter) return false;
      if (ticketPerformanceFilter !== "all" && ticket.performance_id !== ticketPerformanceFilter) return false;
      if (ticketZoneFilter !== "all" && ticket.zone !== ticketZoneFilter) return false;
      if (ticketBuyerFilter !== "all" && ticket.buyer_name?.trim() !== ticketBuyerFilter) return false;
      if (ticketRecipientFilter !== "all" && ticketRecipientName(ticket) !== ticketRecipientFilter) return false;
      if (!query) return true;
      return [ticket.id, ticket.holder_name, ticket.buyer_name, ticket.ticket_class, ticket.performance_title, ticket.zone, ticket.row_label, ticket.seat_label].filter(Boolean).join(" ").toLocaleLowerCase().includes(query);
    });
  }, [ticketBuyerFilter, ticketPerformanceFilter, ticketRecipientFilter, ticketSearch, ticketStatusFilter, ticketZoneFilter, tickets]);
  const ticketZones = useMemo(() => Array.from(new Set(tickets.map((ticket) => ticket.zone).filter((zone): zone is string => Boolean(zone)))).sort(naturalLabelCompare), [tickets]);
  const ticketBuyers = useMemo(() => Array.from(new Set(tickets.map((ticket) => ticket.buyer_name?.trim()).filter((name): name is string => Boolean(name)))).sort(naturalLabelCompare), [tickets]);
  const ticketStatusCounts = useMemo(() => filteredTickets.reduce((counts, ticket) => ({ ...counts, [ticket.status]: (counts[ticket.status] || 0) + 1 }), {} as Record<string, number>), [filteredTickets]);
  const ticketRecipientSummary = useMemo(() => {
    const groups = new Map<string, { name: string; total: number; issued: number; held: number; checked_in: number; voided: number; sent: number; unsent: number }>();
    filteredTickets.forEach((ticket) => {
      const name = ticketRecipientName(ticket);
      const current = groups.get(name) || { name, total: 0, issued: 0, held: 0, checked_in: 0, voided: 0, sent: 0, unsent: 0 };
      current.total += 1;
      if (ticket.status === "issued") current.issued += 1;
      if (ticket.status === "held") current.held += 1;
      if (ticket.status === "checked_in") current.checked_in += 1;
      if (ticket.status === "voided") current.voided += 1;
      if (["issued", "checked_in"].includes(ticket.status)) {
        if (ticket.delivery_status === "sent") current.sent += 1;
        else current.unsent += 1;
      }
      groups.set(name, current);
    });
    return Array.from(groups.values()).sort((left, right) => right.total - left.total || naturalLabelCompare(left.name, right.name));
  }, [filteredTickets]);
  const recipientDeliveryTickets = useMemo(() => ticketRecipientFilter === "all" ? [] : filteredTickets.filter((ticket) => ["issued", "checked_in"].includes(ticket.status) && ticket.delivery_status !== "sent"), [filteredTickets, ticketRecipientFilter]);
  const recipientEmailTicketCount = useMemo(() => recipientDeliveryTickets.filter((ticket) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(ticket.email || "").trim())).length, [recipientDeliveryTickets]);
  const selectedExportZones = DIRECT_TICKET_ZONE_GROUPS[ticketExportZoneGroup] || [];
  const exportFilteredTickets = useMemo(() => filteredTickets.filter((ticket) => ticketMatchesZones(ticket.zone, selectedExportZones)), [filteredTickets, selectedExportZones]);
  const printableTicketIds = useMemo(() => exportFilteredTickets.filter((ticket) => ["issued", "checked_in"].includes(ticket.status)).map((ticket) => ticket.id), [exportFilteredTickets]);
  const printA4Params = new URLSearchParams({ event_id: eventId });
  if (ticketStatusFilter !== "all") printA4Params.set("status", ticketStatusFilter);
  if (ticketPerformanceFilter !== "all") printA4Params.set("performance_id", ticketPerformanceFilter);
  if (ticketZoneFilter !== "all") printA4Params.set("zones", ticketZoneFilter);
  if (ticketBuyerFilter !== "all") printA4Params.set("buyer_name", ticketBuyerFilter);
  if (ticketRecipientFilter !== "all") printA4Params.set("recipient_name", ticketRecipientFilter);
  if (ticketSearch.trim()) printA4Params.set("search", ticketSearch.trim());
  if (ticketZoneFilter === "all" && selectedExportZones.length) printA4Params.set("zones", selectedExportZones.join(","));
  const printA4Href = `/api/direct-ticketing/tickets/print-a4.pdf?${printA4Params.toString()}`;
  const batchAssetParams = new URLSearchParams(printA4Params);
  batchAssetParams.set("ids", printableTicketIds.join(","));
  const batchPngHref = `/api/direct-ticketing/tickets/export-assets.zip?format=png&${batchAssetParams.toString()}`;
  const batchPdfHref = `/api/direct-ticketing/tickets/export-assets.zip?format=pdf&${batchAssetParams.toString()}`;
  const ticketExportParams = new URLSearchParams({ event_id: eventId });
  if (selectedExportZones.length) ticketExportParams.set("zones", selectedExportZones.join(","));
  const ticketExportHref = `/api/direct-ticketing/tickets/export?${ticketExportParams.toString()}`;
  useEffect(() => { if (!seatMapZone && seatMapZones.length) setSeatMapZone(seatMapZones[0]); }, [seatMapZone, seatMapZones]);
  const zoneColor = (zone: string, section = "") => {
    const value = `${zone} ${section}`.toLowerCase();
    if (value.includes("premium") || value.includes("zone 2")) return { border: "#9f1239", fill: "#fff1f2", text: "#9f1239" };
    if (value.includes("standard plus") || value.includes("zone 1") || value.includes("zone 3")) return { border: "#075985", fill: "#eff6ff", text: "#075985" };
    return { border: "#b45309", fill: "#fffbeb", text: "#92400e" };
  };
  const zoneSummary = useMemo(() => {
    const persisted = new Map(seats.map((seat) => [seatDraftKey({ zone: seat.zone, section_label: seat.section_label || "", row_label: seat.row_label, seat_label: seat.seat_label }), seat]));
    const source = normalizeSeatDrafts(seatDrafts).map((draft) => { const current = persisted.get(seatDraftKey({ ...draft, section_label: draft.section_label || "" })); return { zone: draft.zone, section_label: draft.section_label || "", ticket_class: draft.ticket_class, face_value: draft.face_value, status: current?.status || "available", allocation_status: draft.allocation_status }; });
    const grouped = new Map<string, { zone: string; section_label: string; total: number; allocated: number; available: number; held: number; issued: number; classes: Set<string>; prices: Set<number> }>();
    source.forEach((seat) => { const key = `${seat.zone}\u0000${seat.section_label}`; const item = grouped.get(key) || { zone: seat.zone || "Unassigned", section_label: seat.section_label, total: 0, allocated: 0, available: 0, held: 0, issued: 0, classes: new Set<string>(), prices: new Set<number>() }; item.total += 1; if (seat.allocation_status !== "not_allocated") item.allocated += 1; if (seat.status === "available" && seat.allocation_status !== "not_allocated") item.available += 1; if (seat.status === "held") item.held += 1; if (["issued", "checked_in"].includes(seat.status)) item.issued += 1; if (seat.ticket_class) item.classes.add(seat.ticket_class); if (seat.face_value != null && seat.face_value > 0) item.prices.add(seat.face_value); grouped.set(key, item); });
    return Array.from(grouped.values()).sort((left, right) => naturalLabelCompare(`${left.zone} ${left.section_label}`, `${right.zone} ${right.section_label}`)).map((item) => ({ ...item, classLabel: Array.from(item.classes).sort(naturalLabelCompare).join(" / "), priceLabel: Array.from(item.prices).sort((a, b) => a - b).map((value) => formatNumber(value)).join(" / ") }));
  }, [seats, seatDrafts]);
  const zoneNames = useMemo(() => Array.from(new Set(zoneSummary.map((item) => item.zone))).sort(naturalLabelCompare), [zoneSummary]);
  const batchPriceRowsFor = (section: string) => seatDrafts.filter((row) => {
    if (!row.zone || !row.row_label || !row.seat_label) return false;
    return !section || `${row.zone} · ${row.section_label}` === section || row.zone === section;
  });
  const batchPriceValueFor = (section: string) => {
    const prices = new Set(batchPriceRowsFor(section).map((row) => row.face_value.trim()).filter(Boolean).map(Number).filter((price) => Number.isFinite(price) && price >= 0));
    return prices.size === 1 ? String(Array.from(prices)[0]) : "";
  };
  const batchClassValueFor = (section: string) => {
    const classes = new Set(batchPriceRowsFor(section).map((row) => row.ticket_class.trim()).filter(Boolean));
    return classes.size === 1 ? Array.from(classes)[0] : "";
  };
  const batchPriceOptions = useMemo(() => Array.from(new Set(seatDrafts.filter((row) => row.zone && row.row_label && row.seat_label).map((row) => `${row.zone} · ${row.section_label}`))).sort(naturalLabelCompare), [seatDrafts]);
  const zoneLayoutStorageKey = `meetrix:direct-ticket-zone-layout:${eventId}:${performanceId || "draft"}`;
  const zoneOverviewStorageKey = `meetrix:direct-ticket-zone-overview:${eventId}`;
  useEffect(() => {
    let saved: unknown = null;
    try { saved = JSON.parse(window.localStorage.getItem(zoneLayoutStorageKey) || "null"); } catch { saved = null; }
    const savedRecord = saved && typeof saved === "object" && !Array.isArray(saved) ? saved as Record<string, unknown> : null;
    const savedOrder = Array.isArray(saved) ? saved : Array.isArray(savedRecord?.order) ? savedRecord.order : [];
    const validOrder = savedOrder.filter((zone): zone is string => typeof zone === "string" && zoneNames.includes(zone));
    const nextOrder = [...validOrder, ...zoneNames.filter((zone) => !validOrder.includes(zone))];
    const savedPositions = savedRecord?.positions && typeof savedRecord.positions === "object" ? savedRecord.positions as Record<string, { row?: unknown; col?: unknown }> : {};
    const nextPositions: Record<string, { row: number; col: number }> = {};
    const occupied = new Set<string>();
    nextOrder.forEach((zone, index) => {
      const candidate = savedPositions[zone];
      const row = Number(candidate?.row);
      const col = Number(candidate?.col);
      if (Number.isInteger(row) && row >= 0 && Number.isInteger(col) && col >= 0 && col < 3 && !occupied.has(`${row}:${col}`)) {
        nextPositions[zone] = { row, col }; occupied.add(`${row}:${col}`); return;
      }
      let fallbackIndex = index;
      while (occupied.has(`${Math.floor(fallbackIndex / 3)}:${fallbackIndex % 3}`)) fallbackIndex += 1;
      const fallback = { row: Math.floor(fallbackIndex / 3), col: fallbackIndex % 3 };
      nextPositions[zone] = fallback; occupied.add(`${fallback.row}:${fallback.col}`);
    });
    setZoneLayoutOrder(nextOrder);
    setZoneLayoutPositions(nextPositions);
  }, [zoneLayoutStorageKey, zoneNames]);
  useEffect(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem(zoneOverviewStorageKey) || "null");
      if (saved?.mode === "floating" || saved?.mode === "docked") setZoneOverviewMode(saved.mode);
      if (Number.isFinite(Number(saved?.width))) setZoneOverviewWidth(String(Math.min(560, Math.max(280, Number(saved.width)))));
      if (Number.isFinite(Number(saved?.x)) && Number.isFinite(Number(saved?.y))) setZoneOverviewOffset({ x: Number(saved.x), y: Number(saved.y) });
    } catch { /* Browser storage is optional. */ }
  }, [zoneOverviewStorageKey]);
  useEffect(() => {
    try { window.localStorage.setItem(zoneOverviewStorageKey, JSON.stringify({ mode: zoneOverviewMode, width: zoneOverviewWidth, ...zoneOverviewOffset })); } catch { /* Browser storage is optional. */ }
  }, [zoneOverviewMode, zoneOverviewOffset, zoneOverviewStorageKey, zoneOverviewWidth]);
  useEffect(() => {
    const move = (event: PointerEvent) => {
      const drag = zoneOverviewDragRef.current;
      if (!drag) return;
      setZoneOverviewOffset({
        x: Math.max(8, Math.min(window.innerWidth - 220, drag.x + event.clientX - drag.pointerX)),
        y: Math.max(56, Math.min(window.innerHeight - 120, drag.y + event.clientY - drag.pointerY)),
      });
    };
    const stop = () => { zoneOverviewDragRef.current = null; };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
    return () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", stop); };
  }, []);
  const beginZoneOverviewDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (zoneOverviewMode !== "floating" || (event.target as HTMLElement).closest("button, input, select")) return;
    zoneOverviewDragRef.current = { pointerX: event.clientX, pointerY: event.clientY, ...zoneOverviewOffset };
  };
  const zoneGridColumns = 3;
  const zonePositionFor = (zone: string) => {
    const saved = zoneLayoutPositions[zone];
    if (saved) return saved;
    const fallbackOrder = zoneLayoutOrder.length ? zoneLayoutOrder : zoneNames;
    const index = Math.max(0, fallbackOrder.indexOf(zone));
    return { row: Math.floor(index / zoneGridColumns), col: index % zoneGridColumns };
  };
  const zoneSummaryGroups = useMemo(() => {
    const grouped = new Map<string, (typeof zoneSummary)[number][]>();
    zoneSummary.forEach((item) => grouped.set(item.zone, [...(grouped.get(item.zone) || []), item]));
    return Array.from(grouped.entries()).map(([zone, items]) => ({ zone, items })).sort((left, right) => {
      const leftPosition = zonePositionFor(left.zone); const rightPosition = zonePositionFor(right.zone);
      return leftPosition.row - rightPosition.row || leftPosition.col - rightPosition.col || naturalLabelCompare(left.zone, right.zone);
    });
  }, [zoneLayoutOrder, zoneLayoutPositions, zoneNames, zoneSummary]);
  const moveZoneGroup = (source: string, targetPosition: { row: number; col: number }) => {
    if (!source) return;
    const sourcePosition = zonePositionFor(source);
    const targetZone = zoneSummaryGroups.find((group) => {
      const position = zonePositionFor(group.zone);
      return position.row === targetPosition.row && position.col === targetPosition.col;
    })?.zone;
    if (targetZone === source) return;
    const nextPositions = { ...zoneLayoutPositions, [source]: targetPosition };
    if (targetZone) nextPositions[targetZone] = sourcePosition;
    setZoneLayoutPositions(nextPositions);
    try { window.localStorage.setItem(zoneLayoutStorageKey, JSON.stringify({ order: zoneLayoutOrder, positions: nextPositions })); } catch { /* Browser storage is optional; the layout still works for this session. */ }
  };
  const zoneGridRows = Math.max(4, Math.ceil(zoneSummaryGroups.length / zoneGridColumns) + 1, ...zoneSummaryGroups.map((group) => zonePositionFor(group.zone).row + 1));
  const zoneGroupsByPosition = new Map(zoneSummaryGroups.map((group) => { const position = zonePositionFor(group.zone); return [`${position.row}:${position.col}`, group] as const; }));
  const seatMapGrid = useMemo(() => {
    const byRow = new Map<string, Map<string, SeatDraft>>();
    seatDrafts.filter((row) => (!seatMapZone || row.zone === seatMapZone) && row.row_label.trim() && row.seat_label.trim()).forEach((row) => {
      const rowKey = `${row.zone}\u0000${row.section_label}\u0000${row.row_label}`;
      const rowSeats = byRow.get(rowKey) || new Map<string, SeatDraft>();
      rowSeats.set(row.seat_label, row);
      byRow.set(rowKey, rowSeats);
    });
    const seatLabels = Array.from(new Set(Array.from(byRow.values()).flatMap((rowSeats) => Array.from(rowSeats.keys())))).sort(naturalLabelCompare);
    return { seatLabels, rows: Array.from(byRow.entries()).sort(([left], [right]) => naturalLabelCompare(left, right)).map(([rowKey, rowSeats]) => { const [zone, sectionLabel, rowLabel] = rowKey.split("\u0000"); return { zone, sectionLabel, rowLabel: sectionLabel ? `${sectionLabel} · ${rowLabel}` : rowLabel, seats: rowSeats }; }) };
  }, [seatDrafts, seatMapZone]);
  const spatialSeatMap = useMemo(() => buildSpatialSeatLayout(seatDrafts, seatMapZone), [seatDrafts, seatMapZone]);
  const spatialMapAvailable = Boolean(seatMapZone) && spatialSeatMap.positioned.length > 0 && spatialSeatMap.coverage >= 0.8;
  const seatByKey = useMemo(() => new Map(seats.map((seat) => [seatDraftKey({ zone: seat.zone, section_label: seat.section_label || "", row_label: seat.row_label, seat_label: seat.seat_label }), seat])), [seats]);
  const toggleSeatSelection = (seat: Seat) => {
    if (!canManage || seat.status !== "available" || seat.allocation_status === "not_allocated") return;
    setSelectedSeatIds((current) => {
      const next = current.includes(seat.id) ? current.filter((id) => id !== seat.id) : [...current, seat.id];
      setTicketForm((form) => ({ ...form, seat_id: next[next.length - 1] || "" }));
      return next;
    });
  };
  const selectAllAvailableSeats = () => {
    const ids = filteredAvailableSeats.map((seat) => seat.id);
    setSelectedSeatIds(ids);
    setTicketForm((form) => ({ ...form, seat_id: ids[ids.length - 1] || "" }));
  };
  const submit = async (path: string, body: unknown) => { setBusy(true); setMessage(""); try { const response = await apiFetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); const data = await response.json().catch(() => ({})); if (!response.ok) throw new Error(data.error || t("requestFailed", "Request failed")); await load(); if (performanceId) { const refreshed = await apiFetch(`/api/direct-ticketing/seats?event_id=${encodeURIComponent(eventId)}&performance_id=${encodeURIComponent(performanceId)}`); setSeats(await refreshed.json()); } return data; } catch (error) { setMessage(error instanceof Error ? error.message : t("requestFailed", "Request failed")); return null; } finally { setBusy(false); } };
  const createPerformance = async (event: React.FormEvent) => { event.preventDefault(); const data = await submit("/api/direct-ticketing/performances", { event_id: eventId, ...performanceForm }); if (data) { const createdPerformanceId = String(data.id || ""); setPerformanceForm({ code: "", title: "", starts_at: "", seat_plan_image_url: "" }); setEditingPerformanceId(null); setPerformanceId(createdPerformanceId); setMessage(t("performanceSavedReadyToScan", "Performance saved and selected. You can now upload or scan its seat-plan images.")); } };
  const resetPerformance = async () => {
    if (!performanceId || !selectedPerformance || busy) return;
    if (!window.confirm(`${t("resetConfirm", "Reset performance")}: ${selectedPerformance.code} — ${selectedPerformance.title}? ${t("resetWarning", "This permanently removes its imported seats and all test tickets.")}`)) return;
    const data = await submit(`/api/direct-ticketing/performances/${encodeURIComponent(performanceId)}/reset`, { event_id: eventId });
    if (data) { setSeatDrafts([blankSeatDraft()]); setSelectedSeatIds([]); setSeatMapReview(null); setRescanPending(false); setRescanZones([]); setTicketForm((form) => ({ ...form, seat_id: "" })); setMessage(data.blocked ? `Reset blocked: ${data.orders || 0} order(s) already exist for this performance.` : `${t("performanceReset", "Performance reset")} — ${t("removed", "removed")} ${data.seats || 0} ${t("seats", "seats")} ${t("and", "and")} ${data.tickets || 0} ${t("tickets", "tickets")}`); }
  };
  const loadCsv = async (file?: File) => { if (!file) return; const rows = parseSeatDrafts(await file.text()); if (rows.length) { setSeatDrafts(rows); setMessage(`${rows.length} ${t("rowsLoaded", "rows loaded")} — ${t("reviewAndSave", "review then click Save all changes")}`); } else setMessage(t("csvNoValidRows", "CSV has no valid seat rows")); };
  const applyBatchPrice = () => {
    const price = Number(batchPrice);
    if (!batchTicketClass) { setMessage(t("batchClassRequired", "Choose a ticket class")); return; }
    if (!Number.isFinite(price) || price < 0) { setMessage(t("batchPriceInvalid", "Enter a valid non-negative price")); return; }
    const next = seatDrafts.map((row) => (!batchPriceSection || `${row.zone} · ${row.section_label}` === batchPriceSection || row.zone === batchPriceSection ? { ...row, ticket_class: batchTicketClass, face_value: String(price) } : row));
    const changed = next.filter((row, index) => row.ticket_class !== seatDrafts[index]?.ticket_class || row.face_value !== seatDrafts[index]?.face_value).length;
    setSeatDrafts(next); setMessage(`${batchTicketClass} · ${t("batchPriceApplied", "Price applied to")} ${changed} ${t("seats", "seats")} — ${t("saveHintShort", "click Save all changes to persist")}`);
  };
  const analyzeSeatMapBundle = async (input?: FileList | File[]) => {
    if (!performanceId) { setMessage(t("scanNeedsPerformance", "Create or choose a performance before uploading or scanning seat-plan images.")); return; }
    const files = Array.from(input || []);
    if (!files.length) return;
    const invalid = files.find((file) => !["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size > 4 * 1024 * 1024);
    if (invalid) { setMessage(`${invalid.name}: ${t("seatMapFileInvalid", "Seat map must be PNG, JPG, or WebP and no larger than 4 MB")}`); return; }
    const overview = files.find((file) => isSeatMapOverview(file.name));
    const sources = files.filter((file) => file !== overview);
    const analyzeFiles = sources.length ? sources : files;
    const primary = overview || files[0];
    const totalSteps = analyzeFiles.length + 1;
    const startedAt = Date.now();
    setSeatMapFile(primary); setSeatMapSourceNames(files.map((file) => file.name)); setSeatMapImageUrl(URL.createObjectURL(primary)); setShowSeatMapImage(true); setBusy(true); setProcessing({ phase: "analyzing", completed: 0, total: totalSteps, label: `${t("analyzingSeatMapBundle", "Analyzing seat-plan bundle with Gemini")} (0/${analyzeFiles.length})`, startedAt }); setMessage(`${t("analyzingSeatMapBundle", "Analyzing seat-plan bundle with Gemini")} (0/${analyzeFiles.length})`);
    try {
      const combined: SeatDraft[] = [];
      const warnings: string[] = [];
      let failedFiles = 0;
      for (let index = 0; index < analyzeFiles.length; index += 1) {
        const file = analyzeFiles[index]; const context = seatMapContextFromFilename(file.name);
        const progressLabel = `${t("analyzingSeatMapBundle", "Analyzing seat-plan bundle with Gemini")} (${index + 1}/${analyzeFiles.length}) — ${file.name}`;
        setProcessing({ phase: "analyzing", completed: index, total: totalSteps, label: progressLabel, startedAt });
        setMessage(progressLabel);
        const query = new URLSearchParams({ event_id: eventId, performance_id: performanceId });
        const response = await apiFetch(`/api/direct-ticketing/seat-map/analyze?${query.toString()}`, { method: "POST", headers: { "Content-Type": file.type }, body: file });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) { failedFiles += 1; warnings.push(`${file.name}: ${data.error || t("couldNotAnalyzeSeatMap", "Could not analyze seat map")}`); setMessage(`${file.name}: ${t("scanFileSkipped", "skipped; continuing with the other images")}`); continue; }
        if (Array.isArray(data.warnings)) warnings.push(...data.warnings.map((warning: unknown) => `${file.name}: ${String(warning)}`));
        if (Array.isArray(data.seats)) data.seats.forEach((row: any) => { const sourceStatus = ["available", "sold", "generated", "blocked", "unknown"].includes(String(row.source_status || "")) ? String(row.source_status) as SeatDraft["source_status"] : "unknown"; combined.push({ zone: String(row.zone || context.zone), section_label: String(row.section_label || context.section_label || ""), row_label: String(row.row_label || ""), seat_label: String(row.seat_label || ""), external_seat_ref: String(row.external_seat_ref || ""), ticket_class: "", face_value: row.face_value == null || Number(row.face_value) === 0 ? (context.price == null ? "" : String(context.price)) : String(row.face_value), x: row.x == null ? "" : String(row.x), y: row.y == null ? "" : String(row.y), allocation_status: row.allocation_status === "not_allocated" ? "not_allocated" : "allocated", source_status: sourceStatus }); });
        if (!Array.isArray(data.seats) || !data.seats.length) { failedFiles += 1; warnings.push(`${file.name}: ${t("scanNoSeats", "no seat rows returned")}`); }
        setProcessing({ phase: "analyzing", completed: index + 1, total: totalSteps, label: `${file.name} ${t("analysisComplete", "analyzed")}`, startedAt });
      }
      setProcessing({ phase: "preparing", completed: analyzeFiles.length, total: totalSteps, label: t("preparingSeatMap", "Preparing seat map and rescan changes"), startedAt });
      setMessage(t("preparingSeatMap", "Preparing seat map and rescan changes"));
      const unique = new Map<string, SeatDraft>();
      combined.filter((row) => row.zone && row.row_label && row.seat_label).forEach((row) => unique.set(seatDraftKey(row), row));
      const detectedRows = Array.from(unique.values());
      if (!detectedRows.length) throw new Error(warnings[0] || t("couldNotAnalyzeSeatMap", "Could not analyze seat map"));
      const scanZones = Array.from(new Set(detectedRows.map((row) => row.zone.trim()).filter(Boolean))).sort(naturalLabelCompare);
      const previous = seatDrafts.filter((row) => row.zone && scanZones.includes(row.zone) && row.row_label && row.seat_label);
      const previousByKey = new Map(previous.map((row) => [seatDraftKey(row), row]));
      const rows = detectedRows.map((row) => ({ ...row, ticket_class: previousByKey.get(seatDraftKey(row))?.ticket_class || row.ticket_class }));
      const nextByKey = new Map(rows.map((row) => [seatDraftKey(row), row]));
      const added = rows.filter((row) => !previousByKey.has(seatDraftKey(row))).length;
      const removed = previous.filter((row) => !nextByKey.has(seatDraftKey(row))).length;
      const changed = rows.filter((row) => { const old = previousByKey.get(seatDraftKey(row)); return old && seatDraftFingerprint(old) !== seatDraftFingerprint(row); }).length;
      const protectedCount = previous.filter((row) => { const current = seats.find((seat) => seatDraftKey({ ...row, section_label: row.section_label || "" }) === seatDraftKey({ zone: seat.zone, section_label: seat.section_label || "", row_label: seat.row_label, seat_label: seat.seat_label })); return Boolean(current && ["held", "issued", "checked_in"].includes(current.status)); }).filter((row) => !nextByKey.has(seatDraftKey(row)) || seatDraftFingerprint(row) !== seatDraftFingerprint(nextByKey.get(seatDraftKey(row)) as SeatDraft)).length;
      setSeatMapReview({ rows, zones: scanZones, added, removed, changed, unchanged: rows.length - added - changed, protectedCount, sourceNames: files.map((file) => file.name) });
      setRescanZones(scanZones);
      setRescanPending(true);
      setSeatDrafts(rows.length ? rows : [blankSeatDraft()]); setSeatMapZone(rows[0]?.zone || "");
      setProcessing(null);
      setMessage(`${rows.length} ${t("seatNodesDetected", "seat nodes detected (red seats allocated to Meetrix)")} from ${analyzeFiles.length} ${t("zoneCharts", "zone charts")}${failedFiles ? ` — ${failedFiles} ${t("scanFilesFailed", "image(s) failed; review warnings")}` : warnings.length ? ` — ${warnings.length} ${t("warningsReview", "warnings; review, then click Save all changes")}` : ` — ${t("reviewAndSave", "review then click Save all changes")}`}`);
    } catch (error) { setProcessing(null); setMessage(error instanceof Error ? error.message : t("couldNotAnalyzeSeatMap", "Could not analyze seat map")); } finally { setBusy(false); }
  };
  const analyzeSeatMap = async (file?: File) => { if (file) await analyzeSeatMapBundle([file]); };
  const discardSeatMapDraft = () => {
    if (!rescanPending) return;
    if (!window.confirm(t("discardSeatMapConfirm", "Discard this scan and restore the last saved seat map?"))) return;
    setSeatDrafts(seats.length ? seats.map((seat) => ({ zone: seat.zone, section_label: seat.section_label || "", row_label: seat.row_label, seat_label: seat.seat_label, external_seat_ref: seat.external_seat_ref || "", ticket_class: seat.ticket_class || "", face_value: seat.face_value == null ? "" : String(seat.face_value), x: seat.x == null ? "" : String(seat.x), y: seat.y == null ? "" : String(seat.y), allocation_status: seat.allocation_status === "not_allocated" ? "not_allocated" : "allocated", source_status: seat.source_status || "unknown" })) : [blankSeatDraft()]);
    setSeatMapReview(null); setRescanPending(false); setRescanZones([]); setSeatMapFile(null); setSeatMapSourceNames([]); setSeatMapImageUrl(selectedPerformance?.seat_plan_image_url || "");
    setMessage(t("scanDiscarded", "Scan discarded. The last saved seat map is restored."));
  };
  const importDrafts = async () => { if (!performanceId) return; const rows = normalizeSeatDrafts(seatDrafts); if (!rows.length) { setMessage(t("addSeatRow", "Add at least one row with zone, row, and seat")); return; } const data = await submit("/api/direct-ticketing/seats/import", { event_id: eventId, performance_id: performanceId, seats: rows, replace_layout: true }); if (data) setMessage(`${rows.length} ${t("seatsImported", "seats imported")}`); };
  const exportDrafts = () => { const blob = new Blob([seatDraftCsv(seatDrafts)], { type: "text/csv;charset=utf-8" }); const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = "direct-seats.csv"; link.click(); URL.revokeObjectURL(url); };
  const createTicket = async (event: React.FormEvent) => {
    event.preventDefault(); if (!performanceId) return;
    const seatIds = selectedSeatIds.length ? selectedSeatIds : ticketForm.seat_id ? [ticketForm.seat_id] : [];
    if (!seatIds.length) { setMessage(t("chooseSeat", "Choose at least one available seat")); return; }
    setBusy(true); setMessage(""); setTicketCreationProgress({ completed: 0, total: seatIds.length }); let created = 0;
    try {
      for (const seatId of seatIds) {
        const response = await apiFetch("/api/direct-ticketing/tickets", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ event_id: eventId, performance_id: performanceId, ...ticketForm, seat_id: seatId, price_amount: Number(ticketForm.price_amount || 0), hold_minutes: Number(ticketForm.hold_minutes || 15) }) });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(`${data.error || "Request failed"} (${created}/${seatIds.length} created)`);
        created += 1; setTicketCreationProgress({ completed: created, total: seatIds.length });
      }
      await load();
      const refreshed = await apiFetch(`/api/direct-ticketing/seats?event_id=${encodeURIComponent(eventId)}&performance_id=${encodeURIComponent(performanceId)}`);
      setSeats(await refreshed.json());
      setSelectedSeatIds([]);
      setTicketForm((form) => ({ ...form, seat_id: "", holder_name: "", buyer_name: "", phone: "", email: "", price_amount: "" }));
      setMessage(`${ticketForm.payment_required ? t("held", "Held") : t("issued", "Issued")} ${created} ${t(created === 1 ? "ticket" : "tickets", created === 1 ? "ticket" : "tickets")} ${t("for", "for")} ${ticketForm.holder_name}`);
    } catch (error) {
      await load();
      const refreshed = await apiFetch(`/api/direct-ticketing/seats?event_id=${encodeURIComponent(eventId)}&performance_id=${encodeURIComponent(performanceId)}`);
      setSeats(await refreshed.json()); setSelectedSeatIds([]);
      setMessage(error instanceof Error ? error.message : `${t("created", "Created")} ${created}/${seatIds.length} ${t("tickets", "tickets")}`);
    } finally { setTicketCreationProgress(null); setBusy(false); }
  };
  const updatePayment = async (ticket: Ticket, payment_status: "verified" | "rejected") => { const payment_reference = payment_status === "verified" ? window.prompt(t("paymentReferencePrompt", "Bank transaction/reference (required)")) : null; if (payment_status === "verified" && !payment_reference?.trim()) return; const rejection_reason = payment_status === "rejected" ? window.prompt(t("rejectionReasonPrompt", "Reason shown to the buyer")) : null; if (payment_status === "rejected" && rejection_reason === null) return; const data = await submit(`/api/direct-ticketing/tickets/${encodeURIComponent(ticket.id)}/payment`, { event_id: eventId, payment_status, payment_reference, rejection_reason }); if (data) setMessage(payment_status === "verified" ? t("paymentVerified", "Payment verified and ticket issued") : t("paymentRejected", "Payment rejected and seat released")); };
  const updateOrderPayment = async (order: Order, payment_status: "verified" | "rejected") => { const payment_reference = payment_status === "verified" ? window.prompt("Bank transaction/reference (required)") : null; if (payment_status === "verified" && !payment_reference?.trim()) return; const rejection_reason = payment_status === "rejected" ? window.prompt("Reason shown to the buyer") : null; if (payment_status === "rejected" && rejection_reason === null) return; const data = await submit(`/api/direct-ticketing/orders/${encodeURIComponent(order.id)}/payment`, { event_id: eventId, payment_status, payment_reference, rejection_reason }); if (data) setMessage(payment_status === "verified" ? "Order payment verified and tickets issued" : "Order payment rejected and seats released"); };
  const voidTicket = async (ticket: Ticket) => { if (!window.confirm(ticket.status === "held" ? t("cancelReservationConfirm", "Cancel this reservation and release the seat?") : t("voidTicketConfirm", "Void this ticket and release the seat?"))) return; const data = await submit(`/api/direct-ticketing/tickets/${encodeURIComponent(ticket.id)}/void`, { event_id: eventId, release_seat: true }); if (data) setMessage(ticket.status === "held" ? t("reservationCancelled", "Reservation cancelled and seat released") : t("ticketVoided", "Ticket voided and seat released")); };
  const reissueTicket = async (ticket: Ticket) => { if (!window.confirm(t("reissueConfirm", "Invalidate the old QR and issue a replacement for the same seat?"))) return; const data = await submit(`/api/direct-ticketing/tickets/${encodeURIComponent(ticket.id)}/reissue`, { event_id: eventId }); if (data) setMessage(t("replacementIssued", "Replacement issued; the old QR is now invalid")); };
  const sendRecipientDelivery = async (method: "email" | "manual") => {
    if (!canManage || busy || !recipientDeliveryTickets.length) return;
    const confirmation = method === "email" ? t("deliveryEmailConfirm", "Send the unsent tickets by email?") : t("deliveryManualConfirm", "Mark this batch as sent manually?");
    if (!window.confirm(confirmation)) return;
    const data = await submit("/api/direct-ticketing/tickets/delivery/batch", { event_id: eventId, ticket_ids: recipientDeliveryTickets.map((ticket) => ticket.id), method });
    if (data) setMessage(`${method === "email" ? t("deliveryBatchSent", "New ticket batch sent") : t("deliveryBatchMarked", "Ticket batch marked as sent")} · ${formatNumber(Number(data.sent || 0))}`);
  };
  const copyRecipientDelivery = async () => {
    if (!canManage || !recipientDeliveryTickets.length) return;
    const absoluteUrl = (url: string) => {
      try { return new URL(url, window.location.origin).toString(); } catch { return url; }
    };
    const lines = recipientDeliveryTickets.flatMap((ticket, index) => {
      const delivery = ticket.share_delivery;
      const prefix = `${index + 1}. ${ticket.performance_title || "Performance"} · ${ticket.zone || ""} ${ticket.row_label || ""}-${ticket.seat_label || ""}`.trim();
      return [prefix, delivery ? `PNG: ${absoluteUrl(delivery.png_url)}` : "", delivery ? `PDF (A4 print): ${absoluteUrl(delivery.email_pdf_url || delivery.pdf_url)}` : "", ""].filter(Boolean);
    });
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      setMessage(t("deliveryCopySuccess", "Copied this ticket batch's links"));
    } catch {
      setMessage(t("deliveryCopyFailed", "Could not copy the ticket links"));
    }
  };
  const uploadSeatMap = async () => {
    if (!seatMapFile) return selectedPerformance?.seat_plan_image_url || null;
    const response = await apiFetch(`/api/public-page/media-upload?event_id=${encodeURIComponent(eventId)}&kind=seat_map`, { method: "POST", headers: { "Content-Type": seatMapFile.type, "X-Upload-Filename": encodeURIComponent(seatMapFile.name) }, body: seatMapFile });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || t("couldNotSaveSeatMap", "Could not save seat map image"));
    const url = String(data.asset_url || "");
    if (!url) throw new Error(t("seatMapMissingUrl", "Seat map image was uploaded without a URL"));
    return url;
  };
  const saveAll = async () => {
    if (!canManage || busy) return;
    if (rescanPending && seatMapReview?.removed && !window.confirm(`${t("rescanRemovedConfirm", "This rescan is missing") } ${seatMapReview.removed} ${t("seats", "seats")}. ${t("rescanRemovedWarning", "Saving will make those seats unavailable to Meetrix. Continue only if the source bundle is complete.")}`)) return;
    const startedAt = Date.now();
    setBusy(true); setProcessing({ phase: "saving", completed: 0, total: 3, label: t("savingDesign", "Saving ticket design"), startedAt }); setMessage(t("savingDesign", "Saving ticket design"));
    try {
      const seatMapUrl = (await uploadSeatMap()) || performanceForm.seat_plan_image_url.trim() || null;
      const { event_name: _eventName, ...designPayload } = design;
      const settingsResponse = await apiFetch("/api/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ event_id: eventId, ...designPayload, direct_ticket_classes_json: JSON.stringify(ticketClasses) }) });
      const settingsData = await settingsResponse.json().catch(() => ({}));
      if (!settingsResponse.ok) throw new Error(settingsData.error || t("couldNotSaveSettings", "Could not save page settings"));
      setProcessing({ phase: "saving", completed: 1, total: 3, label: t("savingPerformance", "Saving performance"), startedAt });

      let targetPerformanceId = performanceId;
      const hasPerformanceDraft = Object.values(performanceForm).some((value) => value.trim());
      if (hasPerformanceDraft && !(performanceForm.code.trim() && performanceForm.title.trim() && performanceForm.starts_at)) throw new Error(t("performanceNeedsFields", "Performance needs Code, Title, and start time before saving"));
      const draftPerformance = editingPerformanceId === selectedPerformance?.id ? performanceForm : selectedPerformance || (performanceForm.code.trim() && performanceForm.title.trim() && performanceForm.starts_at ? performanceForm : null);
      if (draftPerformance) {
        const performanceResponse = await apiFetch("/api/direct-ticketing/performances", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ event_id: eventId, code: draftPerformance.code, title: draftPerformance.title, starts_at: draftPerformance.starts_at, seat_plan_image_url: seatMapUrl }) });
        const performanceData = await performanceResponse.json().catch(() => ({}));
        if (!performanceResponse.ok) throw new Error(performanceData.error || t("couldNotSavePerformance", "Could not save performance"));
        targetPerformanceId = String(performanceData.id || targetPerformanceId);
        setPerformanceId(targetPerformanceId);
      }
      setProcessing({ phase: "saving", completed: 2, total: 3, label: t("savingSeats", "Saving seat map"), startedAt });
      const rows = normalizeSeatDrafts(seatDrafts);
      if (targetPerformanceId && rows.length) {
        const seatsResponse = await apiFetch("/api/direct-ticketing/seats/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ event_id: eventId, performance_id: targetPerformanceId, seats: rows, replace_missing: rescanPending, replace_layout: !rescanPending, replace_zones: rescanPending ? rescanZones : undefined }) });
        const seatsData = await seatsResponse.json().catch(() => ({}));
        if (!seatsResponse.ok) throw new Error(seatsData.error || t("couldNotSaveSeats", "Could not save seats"));
      }
      setSeatMapFile(null);
      setSeatMapReview(null); setRescanPending(false); setRescanZones([]);
      setProcessing(null);
      await load();
      if (targetPerformanceId) {
        const refreshed = await apiFetch(`/api/direct-ticketing/seats?event_id=${encodeURIComponent(eventId)}&performance_id=${encodeURIComponent(targetPerformanceId)}`);
        setSeats(await refreshed.json());
      }
      setMessage(`${t("savedAllChanges", "Saved all changes")}${rows.length ? ` — ${rows.length} ${t("seats", "seats")}` : ""}`);
    } catch (error) { setProcessing(null); setMessage(error instanceof Error ? error.message : t("couldNotSaveAllChanges", "Could not save all changes")); }
    finally { setBusy(false); }
  };
  const addTicketClass = () => {
    const name = newClass.name.trim(); if (!name || ticketClasses.some((item) => item.name.toLowerCase() === name.toLowerCase())) return;
    const next = [...ticketClasses, { id: `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "class"}-${Date.now()}`, name, price_amount: Math.max(0, Number(newClass.price_amount) || 0), payment_required: newClass.payment_required, primary_color: newClass.primary_color, accent_color: newClass.accent_color }];
    setTicketClasses(next); setPreviewTicketClass(name); setNewClass({ name: "", price_amount: "", payment_required: true, primary_color: "#1d4ed8", accent_color: "#bfdbfe" });
  };
  const uploadArtwork = async (file?: File) => {
    if (!file) return;
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size > 4 * 1024 * 1024) { setMessage(t("graphicFileInvalid", "Graphic must be PNG, JPG, or WebP and no larger than 4 MB")); return; }
    setBusy(true); setMessage("");
    try {
      const response = await apiFetch(`/api/public-page/media-upload?event_id=${encodeURIComponent(eventId)}&kind=ticket_artwork`, { method: "POST", headers: { "Content-Type": file.type, "X-Upload-Filename": encodeURIComponent(file.name) }, body: file });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || t("couldNotUploadGraphic", "Could not upload graphic"));
      const nextDesign = { ...design, direct_ticket_artwork_url: String(data.asset_url || "") };
      const saveResponse = await apiFetch("/api/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ event_id: eventId, direct_ticket_artwork_url: nextDesign.direct_ticket_artwork_url }) });
      if (!saveResponse.ok) throw new Error(t("graphicUploadedNotSaved", "Graphic uploaded but could not be saved to this ticket design"));
      setDesign(nextDesign); setMessage(t("graphicUploaded", "Ticket graphic uploaded and saved"));
    } catch (error) { setMessage(error instanceof Error ? error.message : t("couldNotUploadGraphic", "Could not upload graphic")); }
    finally { setBusy(false); }
  };
  const batchPricingPanel = canManage && seatDrafts.some((row) => row.zone && row.row_label && row.seat_label) ? <section className="direct-ticketing-settings-section direct-ticketing-batch-pricing rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5"><div className="flex flex-wrap items-center justify-between gap-2"><div><p className="text-xs font-bold uppercase tracking-[.16em] text-violet-600">{t("batchPricing", "Zone sales setup")}</p><h3 className="mt-1 text-lg font-bold text-slate-900">{t("batchPricingTitle", "Set ticket class and price for a zone")}</h3><p className="mt-1 text-sm text-slate-500">{t("batchPricingHint", "The public checkout uses this class and price. Admin can still override the issued ticket as VIP or Complimentary.")}</p></div></div><div className="mt-3 grid gap-2 sm:grid-cols-[1fr_1fr_140px_auto] sm:items-end"><label className="text-xs font-bold text-slate-600">{t("zone", "Zone")} / {t("section", "Section")}<select value={batchPriceSection} onChange={(event) => { const section = event.target.value; setBatchPriceSection(section); setBatchTicketClass(batchClassValueFor(section)); setBatchPrice(batchPriceValueFor(section)); }} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"><option value="">{t("allScannedSeats", "All scanned seats")}</option>{batchPriceOptions.map((key) => { const price = batchPriceValueFor(key); const ticketClass = batchClassValueFor(key); return <option key={key} value={key}>{key}{ticketClass ? ` · ${ticketClass}` : ""}{price ? ` · ${formatNumber(Number(price))} THB` : ""}</option>; })}</select></label><label className="text-xs font-bold text-slate-600">{t("ticketClass", "Ticket class")}<select value={batchTicketClass} onChange={(event) => { const ticketClass = event.target.value; const preset = ticketClasses.find((item) => item.name === ticketClass); setBatchTicketClass(ticketClass); if (preset) setBatchPrice(String(preset.price_amount)); }} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"><option value="">{t("chooseClass", "Choose class")}</option>{ticketClasses.map((item) => <option key={item.id} value={item.name}>{item.name}</option>)}</select></label><label className="text-xs font-bold text-slate-600">{t("price", "Price")} (THB)<input type="number" min="0" value={batchPrice} onChange={(event) => setBatchPrice(event.target.value)} placeholder="1500" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" /></label><button type="button" onClick={applyBatchPrice} className="rounded-lg bg-violet-700 px-3 py-2 text-sm font-bold text-white">{t("applyToZone", "Apply to zone")}</button></div><p className="mt-2 text-xs text-slate-500">{t("batchPriceSaveNote", "Not saved until Save all changes")}</p></section> : null;
  const seatMapLegend = seatDrafts.some((row) => row.zone && row.row_label && row.seat_label) ? <div className="direct-ticketing-manage-section flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-xs font-semibold text-slate-600"><span>{t("mapLegend", "Seat map legend")}</span><span className="inline-flex items-center gap-1.5"><i className="h-3 w-3 rounded-full bg-rose-600" />{t("blockedAllocation", "Red / Blocked = Meetrix allocation")}</span><span className="inline-flex items-center gap-1.5"><i className="h-3 w-3 rounded-full bg-violet-700 ring-2 ring-violet-200" />{t("directIssuedSeat", "Purple = direct ticket issued")}</span><span className="inline-flex items-center gap-1.5"><i className="h-3 w-3 rounded-full bg-sky-500" />{t("soldSource", "Blue = Ticketmelon sold/generated")}</span><span className="inline-flex items-center gap-1.5"><i className="h-3 w-3 rounded-full border-2 border-emerald-500" />{t("availableSource", "Green outline = Ticketmelon available, not ours")}</span></div> : null;
  const seatMapReviewPanel = seatMapReview ? <section className="direct-ticketing-import-section rounded-2xl border border-amber-300 bg-amber-50 p-4 shadow-sm sm:p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-[.16em] text-amber-800">{t("rescanReview", "Rescan review")}</p><h3 className="mt-1 text-lg font-bold text-amber-950">{t("rescanReviewTitle", "Review the new seat map before saving")}</h3><p className="mt-1 text-sm text-amber-900">{seatMapReview.sourceNames.length} {t("sourceImages", "source images")} · {t("rescanSafeNote", "Existing held or issued tickets are protected during import.")}</p></div><button type="button" onClick={() => setSeatMapReview(null)} className="rounded-lg border border-amber-400 px-3 py-2 text-xs font-bold text-amber-900">{t("dismissReview", "Dismiss review")}</button></div><div className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-5"><span><strong className="block text-lg text-emerald-800">{seatMapReview.added}</strong>{t("added", "Added")}</span><span><strong className="block text-lg text-rose-800">{seatMapReview.removed}</strong>{t("removed", "Removed")}</span><span><strong className="block text-lg text-amber-800">{seatMapReview.changed}</strong>{t("changed", "Changed")}</span><span><strong className="block text-lg text-slate-800">{seatMapReview.unchanged}</strong>{t("unchanged", "Unchanged")}</span><span><strong className="block text-lg text-violet-800">{seatMapReview.protectedCount}</strong>{t("protected", "Protected")}</span></div><p className="mt-3 text-xs font-semibold text-amber-900">{t("rescanSaveNote", "The scan is in the editor now. Click Save all changes to commit it; dismissing this notice does not discard the editor changes.")}</p></section> : null;
  const processingPanel = processing ? (() => { const percent = processing.total ? Math.min(100, Math.max(processing.completed ? 0 : 4, Math.round((processing.completed / processing.total) * 100))) : 0; const title = processing.phase === "analyzing" ? t("processingAnalysis", "Scanning seat-plan images") : processing.phase === "preparing" ? t("processingPrepare", "Preparing seat map") : t("processingSave", "Saving changes"); return <section role="status" aria-live="polite" className="rounded-xl border border-violet-300 bg-violet-50 p-4 shadow-sm"><div className="flex items-start gap-3"><span aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 animate-spin rounded-full border-2 border-violet-200 border-t-violet-700" /><div className="min-w-0 flex-1"><div className="flex flex-wrap items-baseline justify-between gap-2"><h3 className="font-bold text-violet-950">{title}</h3><span className="text-xs font-bold tabular-nums text-violet-800">{percent}% · {processingElapsed}s</span></div><div className="mt-2 h-2 overflow-hidden rounded-full bg-violet-200"><div className="h-full rounded-full bg-violet-700 transition-[width] duration-500" style={{ width: `${percent}%` }} /></div><p className="mt-2 truncate text-sm text-violet-900">{processing.label}</p><p className="mt-1 text-xs text-violet-700">{processing.completed}/{processing.total} {t("processingSteps", "steps complete")} · {t("processingWait", "Please keep this page open while Gemini responds.")}</p></div></div></section>; })() : null;
  const pendingScanNotice = rescanPending ? <section className="direct-ticketing-import-section rounded-xl border border-rose-300 bg-rose-50 p-4 shadow-sm"><div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-bold text-rose-950">{t("pendingScanTitle", "Seat map scan is still a draft")}</h3><p className="mt-1 text-sm text-rose-900">{t("pendingScanHint", "Red / Blocked seats are Meetrix allocation. They are shown for review now, but ticket issue and reservation start only after Save all changes commits this scan. White, green, and blue seats stay unavailable to Meetrix.")}</p></div><button type="button" disabled={busy} onClick={discardSeatMapDraft} className="rounded-lg border border-rose-400 px-3 py-2 text-xs font-bold text-rose-900 disabled:opacity-50">{t("discardScan", "Discard scan")}</button></div></section> : null;
  const renderZoneOverviewCard = (item: (typeof zoneSummary)[number]) => {
    const colors = zoneColor(item.zone, item.section_label);
    const details = `${item.available} ${t("available", "available")} · ${item.held} ${t("held", "held")} · ${item.issued} ${t("issued", "issued")}`;
    return <button type="button" key={`${item.zone}-${item.section_label}`} title={details} onClick={() => { const key = `${item.zone} · ${item.section_label}`; setSeatMapZone(item.zone); setBatchPriceSection(key); setBatchTicketClass(batchClassValueFor(key)); setBatchPrice(batchPriceValueFor(key)); }} className="direct-ticketing-zone-overview-card h-full w-full rounded-lg border-2 p-3 text-left transition hover:-translate-y-0.5" style={{ borderColor: colors.border, backgroundColor: colors.fill }}><div className="flex items-start justify-between gap-2"><div className="min-w-0"><p className="direct-ticketing-zone-card-accent break-words text-[13px] font-extrabold leading-tight" style={{ color: colors.text }}>{item.zone}</p>{item.section_label && <p className="direct-ticketing-zone-card-accent break-words text-[11px] font-semibold leading-tight" style={{ color: colors.text }}>{item.section_label}</p>}<p className="mt-1 truncate text-[10px] font-bold uppercase tracking-wide text-slate-600">{item.classLabel || t("classRequired", "Class required")}</p></div><span className="direct-ticketing-zone-card-ratio shrink-0 rounded-full bg-white/80 px-2 py-1 text-xs font-bold tabular-nums" style={{ color: colors.text }}>{item.allocated}/{item.total}</span></div><div className="mt-2 flex items-end justify-between gap-2 text-xs"><span className="font-bold text-emerald-700">{item.available} {t("available", "available")}</span><span className="direct-ticketing-zone-card-accent font-extrabold tabular-nums" style={{ color: colors.text }}>{item.priceLabel || "—"}</span></div></button>;
  };
  const previewClass = ticketClasses.find((item) => item.name === previewTicketClass) || ticketClasses[0];
  const previewPrimaryColor = previewClass?.primary_color || design.direct_ticket_primary_color;
  const previewAccentColor = previewClass?.accent_color || design.direct_ticket_accent_color;
  const previewHasPrice = Number(previewClass?.price_amount || 0) > 0;
  return <div className="direct-ticketing-page space-y-3" data-direct-section={activeSection} data-has-performance={performanceId ? "true" : "false"}>
    <div className="direct-ticketing-page-header sticky top-0 z-30 -mx-2 flex flex-wrap items-center justify-between gap-2 border-b px-2 py-1.5 sm:-mx-4 sm:px-4">
      <h2 className="text-base font-bold leading-tight text-slate-900">{t("title", "VIP & Direct Tickets")}</h2>
      {canManage && <div className="flex flex-wrap items-center gap-1.5"><button type="button" disabled={busy} onClick={() => void saveAll()} className="rounded-lg bg-violet-700 px-3 py-1.5 text-[11px] font-extrabold text-white shadow-md shadow-violet-700/20 disabled:cursor-not-allowed disabled:opacity-50">{t("saveAll", "Save all changes")}</button>{performanceId && <button type="button" disabled={busy} onClick={() => void resetPerformance()} className="rounded-lg border border-rose-300 px-2.5 py-1.5 text-[11px] font-bold text-rose-700 disabled:cursor-not-allowed disabled:opacity-50">{t("resetPerformance", "Reset performance")}</button>}</div>}
    </div>
    <section className="direct-ticketing-performance-context" aria-label={t("performanceContext", "Performance setup")}>
      <div className="direct-ticketing-performance-context-copy">
        <p className="direct-ticketing-performance-context-eyebrow">{t("performanceContextEyebrow", "Performance setup")}</p>
        <h3>{t("choosePerformanceTitle", "Choose a performance")}</h3>
        <p>{selectedPerformance ? `${selectedPerformance.code} — ${selectedPerformance.title}` : t("choosePerformanceHint", "Create a new performance or select an existing round to begin.")}</p>
      </div>
      <div className="direct-ticketing-performance-context-controls">
        <label>
          <span>{t("activePerformance", "Active performance")}</span>
          <select aria-label={t("choosePerformance", "Choose performance")} value={performanceId} onChange={(event) => setActivePerformance(event.target.value)}>
            <option value="">{t("choosePerformance", "Choose performance")}</option>
            {performances.map((item) => <option key={item.id} value={item.id}>{item.code} — {item.title}</option>)}
          </select>
        </label>
        {canManage && <button type="button" onClick={beginNewPerformance} className="direct-ticketing-new-performance-button">+ {t("newPerformance", "New performance")}</button>}
      </div>
      <div className="direct-ticketing-performance-status" aria-live="polite">
        {selectedPerformance ? <><span><strong>{formatNumber(seats.length)}</strong> {t("mappedSeats", "mapped seats")}</span><span><strong>{formatNumber(availableSeats.length)}</strong> {t("available", "available")}</span><span><strong>{formatNumber(seats.filter((seat) => seat.ticket_class?.trim() && Number(seat.face_value) > 0).length)}</strong> {t("pricedSeats", "priced")}</span><span className="direct-ticketing-performance-status-current">{activeSection === "manage" ? t("manageSeatsNext", "Ready to manage seats") : t("importSeatsNext", "Ready to import seats")}</span></> : <span className="direct-ticketing-performance-status-empty">{t("noPerformanceSelected", "No performance selected — the setup form is ready below.")}</span>}
      </div>
    </section>
    <div className="direct-ticketing-section-switcher" role="tablist" aria-label={t("workArea", "Work area")}>
      {(["settings", "import", "manage"] as DirectTicketingSection[]).map((section) => {
        const labels: Record<DirectTicketingSection, [string, string]> = { settings: ["1", t("ticketSettingsTab", "Ticket settings")], import: ["2", t("performanceImportTab", "Performance & import")], manage: ["3", t("seatManagementTab", "Manage seats & tickets")] };
        const disabled = section === "manage" && !performanceId;
        return <button key={section} type="button" role="tab" aria-selected={activeSection === section} disabled={disabled} onClick={() => setActiveSection(section)} className={`direct-ticketing-section-tab ${activeSection === section ? "is-active" : ""} ${disabled ? "is-disabled" : ""}`}><span>{labels[section][0]}</span>{labels[section][1]}</button>;
      })}
    </div>
    {activeSection === "manage" && <div className="flex justify-end"><label className="direct-ticketing-pane-size-control flex items-center gap-1 text-[10px] font-semibold text-slate-500"><span>{t("inspectorWidth", "Inspector")}</span><input aria-label={t("inspectorWidth", "Inspector width")} type="range" min="320" max="560" step="10" value={utilityPaneWidth} onChange={(event) => setUtilityPaneWidth(event.target.value)} /><output className="w-10 text-right tabular-nums">{utilityPaneWidth}px</output></label></div>}
    {message && <div className="rounded-xl bg-slate-100 px-4 py-3 text-sm text-slate-700">{message}</div>}
    {processingPanel}
    {batchPricingPanel}
    {seatMapLegend}
    {seatMapReviewPanel}
    {pendingScanNotice}
    {canManage && !performanceId && <div className="direct-ticketing-import-section rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900"><strong>{t("scanNeedsPerformanceTitle", "Create a performance first")}</strong><p className="mt-1">{t("scanNeedsPerformance", "Create or choose a performance before uploading or scanning seat-plan images. The image scan is stored under the selected performance.")}</p></div>}
    {canManage && <section className="direct-ticketing-import-section direct-ticketing-seat-plan-bundle rounded-2xl border border-violet-200 bg-violet-50 p-4 shadow-sm"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-[.16em] text-violet-700">{t("seatPlanBundle", "Performance seat-plan bundle")}</p><p className="mt-1 text-sm text-violet-950">{t("seatPlanBundleHint", "Upload the overview and Zone charts for a full scan. Red Blocked seats become available to Meetrix. To update one zone, upload only that zone's chart; other zones stay unchanged.")}</p></div><label className={`cursor-pointer rounded-lg bg-violet-700 px-3 py-2 text-xs font-extrabold text-white ${!performanceId || busy ? "pointer-events-none opacity-40" : ""}`}>{t("uploadBundle", "Upload / rescan bundle")}{<input disabled={!performanceId || busy} multiple type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => { void analyzeSeatMapBundle(e.target.files || undefined); e.currentTarget.value = ""; }} className="hidden" />}</label></div>{seatMapSourceNames.length > 0 && <p className="mt-2 text-xs text-violet-800">{seatMapSourceNames.length} {t("sourceImages", "source images selected")} · {seatMapSourceNames.join(" · ")}</p>}</section>}
    <section className="direct-ticketing-settings-section direct-ticketing-section direct-ticketing-designer rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><p className="text-xs font-bold uppercase tracking-[.16em] text-violet-600">{t("designer", "Ticket Designer")}</p><h3 className="mt-1 text-lg font-bold text-slate-900">{t("designerTitle", "VIP Ticket Designer")}</h3><p className="mt-1 text-sm text-slate-500">{t("designerDescription", "This graphic and color treatment is used for issued PNG, A6 PDF, and A4 4-up tickets.")}</p></div>
        {canManage && <span className="text-xs font-semibold text-slate-500">{t("saveHint", "Save with the Save all changes button above")}</span>}
      </div>
      <div className="mt-5 grid min-w-0 gap-5 xl:grid-cols-[minmax(270px,0.8fr)_minmax(420px,1.2fr)]">
        <div className="grid content-start gap-3 sm:grid-cols-2 xl:grid-cols-1">
          <label className="text-sm font-semibold text-slate-700 sm:col-span-2 xl:col-span-1">{t("graphicBackground", "Graphic background")}
            <input disabled={!canManage || busy} type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => { void uploadArtwork(event.target.files?.[0]); event.currentTarget.value = ""; }} className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal" />
            <span className="mt-1 block text-xs font-normal text-slate-500">{t("graphicHint", "PNG/JPG/WebP ≤ 4 MB · recommended 1600 × 900 px")}</span>
          </label>
          <label className="text-sm font-semibold text-slate-700">{t("graphicPlacement", "Graphic placement")}<select disabled={!canManage} value={design.direct_ticket_artwork_mode} onChange={(event) => setDesign({ ...design, direct_ticket_artwork_mode: event.target.value as TicketDesign["direct_ticket_artwork_mode"] })} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal"><option value="panel">{t("imagePanel", "Image panel")}</option><option value="background">{t("fullBackground", "Full background")}</option></select></label>
          {design.direct_ticket_artwork_mode === "background" && <label className="text-sm font-semibold text-slate-700">{t("backgroundStrength", "Background image strength")}<span className="mt-1 flex items-center gap-2"><input disabled={!canManage} type="range" min="0" max="0.6" step="0.02" value={design.direct_ticket_artwork_opacity} onChange={(event) => setDesign({ ...design, direct_ticket_artwork_opacity: event.target.value })} className="w-full" /><span className="w-12 text-right text-xs font-normal text-slate-500">{Math.round(Number(design.direct_ticket_artwork_opacity) * 100)}%</span></span><span className="mt-1 block text-xs font-normal text-slate-500">{t("backgroundStrengthHint", "0% = very faint · 60% = more visible")}</span></label>}
          <label className="text-sm font-semibold text-slate-700">{t("ticketHeading", "Ticket heading")}<input disabled={!canManage} maxLength={60} value={design.direct_ticket_heading} onChange={(event) => setDesign({ ...design, direct_ticket_heading: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal" /></label>
          <label className="text-sm font-semibold text-slate-700">{t("mainColor", "Main color")}<span className="mt-1 flex items-center gap-2 rounded-lg border border-slate-300 px-2 py-1.5"><input disabled={!canManage} type="color" value={design.direct_ticket_primary_color} onChange={(event) => setDesign({ ...design, direct_ticket_primary_color: event.target.value })} className="h-7 w-10 cursor-pointer border-0 bg-transparent" /><span className="font-mono text-xs font-normal">{design.direct_ticket_primary_color}</span></span></label>
          <label className="text-sm font-semibold text-slate-700">{t("accentColor", "Accent color")}<span className="mt-1 flex items-center gap-2 rounded-lg border border-slate-300 px-2 py-1.5"><input disabled={!canManage} type="color" value={design.direct_ticket_accent_color} onChange={(event) => setDesign({ ...design, direct_ticket_accent_color: event.target.value })} className="h-7 w-10 cursor-pointer border-0 bg-transparent" /><span className="font-mono text-xs font-normal">{design.direct_ticket_accent_color}</span></span></label>
          <label className="text-sm font-semibold text-slate-700 sm:col-span-2 xl:col-span-1">{t("footerNote", "Footer note")}<input disabled={!canManage} maxLength={120} value={design.direct_ticket_note} onChange={(event) => setDesign({ ...design, direct_ticket_note: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal" /></label>
          {design.direct_ticket_artwork_url && canManage && <button type="button" onClick={() => setDesign({ ...design, direct_ticket_artwork_url: "" })} className="justify-self-start text-sm font-bold text-rose-600">{t("removeGraphic", "Remove graphic")}</button>}
        </div>
        <div className="min-w-0">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2"><p className="text-xs font-bold uppercase tracking-[.14em] text-slate-500">{t("livePreview", "Live preview")}</p><select value={previewClass?.name || ""} onChange={(event) => setPreviewTicketClass(event.target.value)} className="rounded-md border border-slate-300 px-2 py-1 text-xs font-semibold"><option value="">{t("chooseClass", "Choose class")}</option>{ticketClasses.map((item) => <option key={item.id} value={item.name}>{item.name}</option>)}</select></div>
          <div className="aspect-[1200/850] w-full min-w-0 overflow-hidden rounded-xl bg-slate-950 p-[3%] shadow-inner">
            <div className="relative h-full overflow-hidden rounded-[clamp(8px,2vw,22px)] bg-[#fffaf0]" style={design.direct_ticket_artwork_url && design.direct_ticket_artwork_mode === "background" ? { backgroundImage: `linear-gradient(rgb(255 250 240 / ${100 - Number(design.direct_ticket_artwork_opacity) * 100}%), rgb(255 250 240 / ${100 - Number(design.direct_ticket_artwork_opacity) * 100}%)), url("${design.direct_ticket_artwork_url}")`, backgroundPosition: "center", backgroundSize: "cover" } : undefined}>
              <div className="relative flex h-[35%] items-center justify-between gap-3 overflow-hidden border-b-2 border-dashed px-[5%] text-white" style={{ background: `linear-gradient(135deg, ${previewPrimaryColor}, #160f24)`, borderColor: previewAccentColor }}>
                <div className="min-w-0"><p className="truncate text-[clamp(7px,1vw,13px)] font-bold uppercase tracking-[.22em]" style={{ color: previewAccentColor }}>{previewClass?.name || "VIP"}</p><p className="mt-[2%] line-clamp-2 whitespace-normal text-[clamp(12px,1.8vw,24px)] font-extrabold leading-tight">{design.event_name}</p><p className="truncate text-[clamp(7px,1vw,12px)] opacity-80">{design.direct_ticket_heading}</p></div>
                {design.direct_ticket_artwork_url && design.direct_ticket_artwork_mode === "panel" && <img src={design.direct_ticket_artwork_url} alt={t("ticketArtworkAlt", "Ticket artwork")} className="h-[88%] w-[35%] shrink-0 rounded-xl border border-white/30 object-cover shadow-lg" />}
              </div>
              <div className="grid h-[65%] grid-cols-[1fr_28%] gap-[4%] px-[5%] py-[4%]">
                <div className="min-w-0" style={{ color: "#251b16", WebkitTextFillColor: "#251b16" }}>
                  <div className="space-y-[2%]"><p className="text-[clamp(6px,.8vw,10px)] uppercase" style={{ color: "#7a6f66", WebkitTextFillColor: "#7a6f66" }}>{t("guest", "Guest")}</p><p className="truncate text-[clamp(10px,1.5vw,19px)] font-bold">{t("sampleGuest", "Sample VIP Guest")}</p><p className="text-[clamp(6px,.8vw,10px)] uppercase" style={{ color: "#7a6f66", WebkitTextFillColor: "#7a6f66" }}>{t("performance", "Performance")}</p><p className="truncate text-[clamp(8px,1.2vw,15px)] font-semibold">Manohra Thai Choral Opera - Round 1</p><p className="truncate text-[clamp(7px,1vw,12px)] text-slate-500">22 Aug 2026, 14:00 – 16:30 · Suryadhep Music Sala</p></div>
                  <div className="mt-[3%] flex items-end gap-[4%] border-t border-slate-200 pt-[2%]"><div className="min-w-0 shrink-0"><p className="text-[clamp(5px,.7vw,9px)] uppercase text-slate-500">{t("type", "Type")}</p><p className="truncate text-[clamp(11px,1.8vw,23px)] font-extrabold leading-none">{previewClass?.name || "VIP"}</p></div>{previewHasPrice && <div className="min-w-0 shrink-0"><p className="text-[clamp(5px,.7vw,9px)] uppercase text-slate-500">{t("price", "Price")}</p><p className="truncate text-[clamp(8px,1.15vw,15px)] font-bold">{formatNumber(Number(previewClass?.price_amount || 0))} THB</p></div>}<div className="ml-auto grid min-w-[44%] grid-cols-[.75fr_1.25fr] gap-x-[8%] rounded-lg border-2 px-[4%] py-[2%]" style={{ borderColor: previewPrimaryColor, backgroundColor: `${previewPrimaryColor}14`, color: previewPrimaryColor, WebkitTextFillColor: previewPrimaryColor }}><p className="col-span-2 truncate text-[clamp(6px,.85vw,11px)] font-bold">ZONE 3</p><div><p className="text-[clamp(5px,.65vw,8px)] font-bold text-slate-500" style={{ WebkitTextFillColor: "#7a6f66" }}>ROW</p><p className="text-[clamp(20px,3.7vw,46px)] font-extrabold leading-none">J</p></div><div><p className="text-[clamp(5px,.65vw,8px)] font-bold text-slate-500" style={{ WebkitTextFillColor: "#7a6f66" }}>SEAT</p><p className="text-[clamp(23px,4.2vw,52px)] font-extrabold leading-none">23</p></div></div></div>
                  {design.direct_ticket_note && <p className="mt-[2%] truncate text-[clamp(6px,.75vw,9px)]" style={{ color: "#6b625b", WebkitTextFillColor: "#6b625b" }}>{design.direct_ticket_note}</p>}
                </div>
                <div className="flex min-w-0 flex-col items-center border-l-2 border-dashed pl-[6%]" style={{ borderColor: previewAccentColor, backgroundColor: `${previewAccentColor}12` }}><p className="truncate text-[clamp(6px,.7vw,10px)] font-bold uppercase tracking-[.12em]" style={{ color: previewPrimaryColor, WebkitTextFillColor: previewPrimaryColor }}>{t("checkinArea", "Check-in area")}</p><p className="truncate text-[clamp(5px,.55vw,8px)] text-slate-500">{t("punchMarkUsed", "PUNCH / MARK USED")}</p><div className="mt-[4%] aspect-square w-[78%] rounded bg-white p-[8%] shadow"><div className="h-full w-full" style={{ backgroundImage: "repeating-conic-gradient(#111 0 25%,#fff 0 50%)", backgroundSize: "22% 22%" }} /></div><span className="mt-1 text-[clamp(5px,.6vw,8px)] text-slate-500">{t("qrCheckinSample", "QR CHECK-IN · sample")}</span><p className="mt-[3%] text-[clamp(5px,.6vw,8px)] uppercase text-slate-500">{t("usedCheckedIn", "Used / checked-in")}</p><div className="mt-1 flex gap-1"><i className="h-2 w-2 rounded-full border" style={{ borderColor: previewPrimaryColor }} /><i className="h-2 w-2 rounded-full border" style={{ borderColor: previewPrimaryColor }} /><i className="h-2 w-2 rounded-full border" style={{ borderColor: previewPrimaryColor }} /></div></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
    {canManage && <section className="direct-ticketing-settings-section direct-ticketing-section direct-ticketing-classes rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-[.16em] text-violet-600">{t("ticketClasses", "Ticket classes")}</p><h3 className="mt-1 text-lg font-bold text-slate-900">{t("ticketClassesTitle", "Ticket classes and pricing")}</h3><p className="mt-1 text-sm text-slate-500">{t("ticketClassesDescription", "Set classes once, then choose them when issuing tickets. Each class has its own colors.")}</p></div><span className="text-xs font-semibold text-slate-500">{t("saveHint", "Save with the Save all changes button above")}</span></div><div className="mt-4 space-y-2">{ticketClasses.map((item, index) => <div key={item.id} className="grid gap-2 rounded-lg border border-slate-200 p-2 sm:grid-cols-[minmax(0,1fr)_130px_42px_42px_auto_auto] sm:items-center"><input aria-label={`${item.name} ${t("name", "name")}`} value={item.name} onChange={(event) => setTicketClasses(ticketClasses.map((current, currentIndex) => currentIndex === index ? { ...current, name: event.target.value } : current))} className="rounded-md border border-slate-300 px-2 py-1.5 text-sm" /><input aria-label={`${item.name} ${t("price", "price")}`} type="number" min="0" value={item.price_amount} onChange={(event) => setTicketClasses(ticketClasses.map((current, currentIndex) => currentIndex === index ? { ...current, price_amount: Math.max(0, Number(event.target.value) || 0) } : current))} className="rounded-md border border-slate-300 px-2 py-1.5 text-sm" /><input aria-label={`${item.name} ${t("mainColor", "main color")}`} title={t("mainColor", "Main color")} type="color" value={item.primary_color} onChange={(event) => setTicketClasses(ticketClasses.map((current, currentIndex) => currentIndex === index ? { ...current, primary_color: event.target.value } : current))} className="h-9 w-full cursor-pointer rounded-md border border-slate-300 bg-white p-1" /><input aria-label={`${item.name} ${t("accentColor", "accent color")}`} title={t("accentColor", "Accent color")} type="color" value={item.accent_color} onChange={(event) => setTicketClasses(ticketClasses.map((current, currentIndex) => currentIndex === index ? { ...current, accent_color: event.target.value } : current))} className="h-9 w-full cursor-pointer rounded-md border border-slate-300 bg-white p-1" /><label className="flex items-center gap-1 text-xs text-slate-600"><input type="checkbox" checked={item.payment_required} onChange={(event) => setTicketClasses(ticketClasses.map((current, currentIndex) => currentIndex === index ? { ...current, payment_required: event.target.checked } : current))} /> {t("payment", "Payment")}</label><button type="button" onClick={() => setTicketClasses(ticketClasses.filter((_, currentIndex) => currentIndex !== index))} className="text-sm font-bold text-rose-600">{t("remove", "Remove")}</button></div>)}</div><div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_130px_42px_42px_auto_auto]"><input placeholder={t("newClassPlaceholder", "New class e.g. Sponsor")} value={newClass.name} onChange={(event) => setNewClass({ ...newClass, name: event.target.value })} className="rounded-md border border-slate-300 px-2 py-1.5 text-sm" /><input type="number" min="0" placeholder={t("priceThb", "Price (THB)")} value={newClass.price_amount} onChange={(event) => setNewClass({ ...newClass, price_amount: event.target.value })} className="rounded-md border border-slate-300 px-2 py-1.5 text-sm" /><input aria-label={t("newClassMainColor", "New class main color")} title={t("mainColor", "Main color")} type="color" value={newClass.primary_color} onChange={(event) => setNewClass({ ...newClass, primary_color: event.target.value })} className="h-9 w-full cursor-pointer rounded-md border border-slate-300 bg-white p-1" /><input aria-label={t("newClassAccentColor", "New class accent color")} title={t("accentColor", "Accent color")} type="color" value={newClass.accent_color} onChange={(event) => setNewClass({ ...newClass, accent_color: event.target.value })} className="h-9 w-full cursor-pointer rounded-md border border-slate-300 bg-white p-1" /><label className="flex items-center gap-1 text-xs text-slate-600"><input type="checkbox" checked={newClass.payment_required} onChange={(event) => setNewClass({ ...newClass, payment_required: event.target.checked })} /> {t("payment", "Payment")}</label><button type="button" onClick={addTicketClass} className="rounded-md border border-violet-300 px-3 py-1.5 text-sm font-bold text-violet-700">{t("addClass", "Add class")}</button></div></section>}
    <div className="direct-ticketing-workspace" style={{ "--direct-pane-width": `${utilityPaneWidth}px` } as CSSProperties}>
    {canManage && <div className="direct-ticketing-import-section direct-ticketing-setup-grid grid gap-4">
      <form onSubmit={createPerformance} className="direct-ticketing-section direct-ticketing-performance rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><h3 className="font-bold">{editingPerformanceId ? t("editPerformanceStep", "1. Edit performance") : t("addPerformanceStep", "1. Add performance")}</h3><div className="mt-3 grid gap-3 sm:grid-cols-2"><input required disabled={Boolean(editingPerformanceId)} placeholder={t("code", "Code")} value={performanceForm.code} onChange={(e) => setPerformanceForm({ ...performanceForm, code: e.target.value })} className="rounded-lg border border-slate-300 px-3 py-2 text-sm" /><input required placeholder={t("titleField", "Title")} value={performanceForm.title} onChange={(e) => setPerformanceForm({ ...performanceForm, title: e.target.value })} className="rounded-lg border border-slate-300 px-3 py-2 text-sm" /><input required type="datetime-local" value={performanceForm.starts_at} onChange={(e) => setPerformanceForm({ ...performanceForm, starts_at: e.target.value })} className="rounded-lg border border-slate-300 px-3 py-2 text-sm" /><input placeholder={t("seatPlanUrl", "Seat-plan image URL (optional)")} value={performanceForm.seat_plan_image_url} onChange={(e) => setPerformanceForm({ ...performanceForm, seat_plan_image_url: e.target.value })} className="rounded-lg border border-slate-300 px-3 py-2 text-sm" /></div><button disabled={busy} className="mt-3 rounded-lg bg-violet-700 px-4 py-2 text-sm font-bold text-white">{editingPerformanceId ? t("savePerformanceChanges", "Save performance changes") : t("savePerformance", "Save performance")}</button>{editingPerformanceId && <button type="button" onClick={() => { setEditingPerformanceId(null); setPerformanceForm({ code: "", title: "", starts_at: "", seat_plan_image_url: "" }); }} className="mt-3 ml-2 rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold text-slate-700">{t("cancelEdit", "Cancel edit")}</button>}</form>
      <div className="direct-ticketing-section direct-ticketing-seats rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex flex-wrap items-start justify-between gap-2"><div><h3 className="font-bold">{t("prepareSeatsStep", "2. Prepare & import seats")}</h3><p className="mt-1 text-xs text-slate-500">{t("prepareSeatsHint", "Enter rows in the table or load a CSV, then save all changes above.")}</p></div><div className="flex gap-2"><button type="button" onClick={exportDrafts} className="rounded-md border border-slate-300 px-2 py-1 text-xs font-bold">{t("exportCsv", "Export CSV")}</button><label className="cursor-pointer rounded-md border border-slate-300 px-2 py-1 text-xs font-bold">{t("loadCsv", "Load CSV")}<input type="file" accept=".csv,text/csv" onChange={(e) => { void loadCsv(e.target.files?.[0]); e.currentTarget.value = ""; }} className="hidden" /></label><label className={`cursor-pointer rounded-md border border-violet-300 px-2 py-1 text-xs font-bold text-violet-700 ${!performanceId || busy ? "pointer-events-none opacity-40" : ""}`}>{t("analyzeImage", "Analyze image (Gemini)")}<input disabled={!performanceId || busy} type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => { void analyzeSeatMap(e.target.files?.[0]); e.currentTarget.value = ""; }} className="hidden" /></label></div></div><select value={performanceId} onChange={(e) => { setPerformanceId(e.target.value); setEditingPerformanceId(null); setPerformanceForm({ code: "", title: "", starts_at: "", seat_plan_image_url: "" }); }} className="mt-3 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"><option value="">{t("choosePerformance", "Choose performance")}</option>{performances.map((item) => <option key={item.id} value={item.id}>{item.code} — {item.title}</option>)}</select>{selectedPerformance && canManage && <div className="mt-2 flex gap-2"><button type="button" onClick={startEditingPerformance} className="rounded-md border border-violet-300 px-3 py-1.5 text-xs font-bold text-violet-700">{t("editPerformance", "Edit performance")}</button><button type="button" onClick={() => void deletePerformance()} disabled={busy} className="rounded-md border border-rose-300 px-3 py-1.5 text-xs font-bold text-rose-700 disabled:opacity-50">{t("deletePerformance", "Delete performance")}</button></div>}<p className="mt-3 text-xs text-slate-500"><code>zone,row_label,seat_label,external_seat_ref,face_value,x,y</code></p><div className="mt-2 max-h-52 overflow-auto rounded-lg border border-slate-300 bg-slate-50"><div className="min-w-[720px]"><div className="sticky top-0 z-10 grid grid-cols-[1fr_1fr_1fr_1.4fr_100px_70px_70px_28px] gap-1 border-b border-slate-600 bg-slate-100 p-2 text-center text-[10px] font-bold uppercase text-slate-700"><span>{t("zone", "Zone")}</span><span>{t("row", "Row")}</span><span>{t("seat", "Seat")}</span><span>{t("externalRef", "External ref")}</span><span>{t("faceValue", "Face value")}</span><span>X</span><span>Y</span><span /></div>{seatDrafts.map((row, index) => <div key={index} className="grid grid-cols-[1fr_1fr_1fr_1.4fr_100px_70px_70px_28px] gap-1 border-t border-slate-700 p-2"><input aria-label={t("zone", "Zone")} value={row.zone} onChange={(e) => setSeatDrafts(seatDrafts.map((item, i) => i === index ? { ...item, zone: e.target.value } : item))} className="w-full rounded border border-slate-600 bg-white px-1.5 py-1 text-xs text-slate-900 placeholder:text-slate-500"/><input aria-label={t("row", "Row")} value={row.row_label} onChange={(e) => setSeatDrafts(seatDrafts.map((item, i) => i === index ? { ...item, row_label: e.target.value } : item))} className="w-full rounded border border-slate-600 bg-white px-1.5 py-1 text-xs text-slate-900 placeholder:text-slate-500"/><input aria-label={t("seat", "Seat")} value={row.seat_label} onChange={(e) => setSeatDrafts(seatDrafts.map((item, i) => i === index ? { ...item, seat_label: e.target.value } : item))} className="w-full rounded border border-slate-600 bg-white px-1.5 py-1 text-xs text-slate-900 placeholder:text-slate-500"/><input aria-label={t("externalSeatReference", "External seat reference")} value={row.external_seat_ref} onChange={(e) => setSeatDrafts(seatDrafts.map((item, i) => i === index ? { ...item, external_seat_ref: e.target.value } : item))} className="w-full rounded border border-slate-600 bg-white px-1.5 py-1 text-xs text-slate-900 placeholder:text-slate-500"/><input aria-label={t("faceValue", "Face value")} type="number" min="0" value={row.face_value} onChange={(e) => setSeatDrafts(seatDrafts.map((item, i) => i === index ? { ...item, face_value: e.target.value } : item))} className="w-full rounded border border-slate-600 bg-white px-1.5 py-1 text-xs text-slate-900 placeholder:text-slate-500"/><input aria-label="X" value={row.x} onChange={(e) => setSeatDrafts(seatDrafts.map((item, i) => i === index ? { ...item, x: e.target.value } : item))} className="w-full rounded border border-slate-600 bg-white px-1.5 py-1 text-xs text-slate-900 placeholder:text-slate-500"/><input aria-label="Y" value={row.y} onChange={(e) => setSeatDrafts(seatDrafts.map((item, i) => i === index ? { ...item, y: e.target.value } : item))} className="w-full rounded border border-slate-600 bg-white px-1.5 py-1 text-xs text-slate-900 placeholder:text-slate-500"/><button type="button" aria-label={t("removeRow", "Remove row")} onClick={() => setSeatDrafts(seatDrafts.length > 1 ? seatDrafts.filter((_, i) => i !== index) : [blankSeatDraft()])} className="text-rose-600">×</button></div>)}</div></div><div className="mt-2 flex flex-wrap gap-2"><button type="button" onClick={() => setSeatDrafts([...seatDrafts, blankSeatDraft()])} className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-bold">+ {t("addRow", "Add row")}</button><button type="button" disabled={!performanceId || busy} onClick={() => void importDrafts()} className="rounded-md bg-violet-700 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-40">{t("importSeats", "Import seats")}</button></div></div>
    </div>}
    {zoneSummary.length > 0 && <section className={`direct-ticketing-manage-section direct-ticketing-zone-overview direct-ticketing-section rounded-2xl border border-slate-200 bg-white p-3 shadow-sm sm:p-4 ${zoneOverviewMode === "floating" ? "direct-ticketing-zone-overview-floating" : ""}`} style={zoneOverviewMode === "floating" ? { width: `${zoneOverviewWidth}px`, left: `${zoneOverviewOffset.x}px`, top: `${zoneOverviewOffset.y}px` } : undefined}>
      <div className={`flex flex-wrap items-center justify-between gap-2 ${zoneOverviewMode === "floating" ? "cursor-move" : ""}`} onPointerDown={beginZoneOverviewDrag}><div><p className="text-xs font-bold uppercase tracking-[.14em] text-violet-600">{t("zoneOverview", "Zone overview")}</p><h3 className="text-base font-bold text-slate-900">{t("zoneOverviewTitle", "Seat inventory by zone")}</h3></div><div className="flex flex-wrap items-center justify-end gap-2"><span className="text-xs font-semibold text-slate-500">{seatDrafts.filter((row) => row.zone && row.row_label && row.seat_label).length} {t("mappedSeats", "mapped seats")} · {t("dragToArrange", "drag to arrange")}</span><button type="button" onClick={() => setZoneOverviewMode((mode) => mode === "docked" ? "floating" : "docked")} className="rounded-md border border-slate-300 px-2 py-1 text-xs font-bold text-slate-700">{zoneOverviewMode === "docked" ? t("floatZoneOverview", "Float") : t("dockZoneOverview", "Dock")}</button>{zoneOverviewMode === "floating" && <label className="direct-ticketing-pane-size-control flex items-center gap-1 text-xs font-semibold text-slate-500"><span>{t("panelWidth", "Panel")}</span><input aria-label={t("panelWidth", "Panel width")} type="range" min="280" max="560" step="10" value={zoneOverviewWidth} onChange={(event) => setZoneOverviewWidth(event.target.value)} /><output className="w-10 text-right tabular-nums">{zoneOverviewWidth}px</output></label>}</div></div>
      <div className="direct-ticketing-zone-overview-grid mt-2 grid gap-1.5">
        {Array.from({ length: zoneGridRows * zoneGridColumns }, (_, index) => {
          const row = Math.floor(index / zoneGridColumns); const col = index % zoneGridColumns;
          const group = zoneGroupsByPosition.get(`${row}:${col}`);
          return <div key={`${row}:${col}`} className={`direct-ticketing-zone-grid-cell ${group ? "is-filled" : "is-empty"}`} onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "move"; }} onDrop={(event) => { event.preventDefault(); moveZoneGroup(event.dataTransfer.getData("text/plain"), { row, col }); }}>
            {group ? <div draggable onDragStart={(event) => { event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", group.zone); }} className="direct-ticketing-zone-group cursor-grab rounded-lg active:cursor-grabbing">{group.items.map(renderZoneOverviewCard)}</div> : <span className="direct-ticketing-zone-empty-slot">{t("emptyZoneSlot", "Empty slot")}</span>}
          </div>;
        })}
      </div>
    </section>}
    {(seatMapImageUrl || seatMapGrid.rows.length > 0) && <section className="direct-ticketing-manage-section direct-ticketing-seat-map rounded-2xl border border-slate-300 bg-white p-3 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div><p className="text-[10px] font-bold uppercase tracking-[.14em] text-violet-600">{t("seatMapTable", "Seat map table")}</p><h3 className="text-sm font-bold text-slate-900">{t("seatMapTitle", "Select seats from the table")} <span className="font-semibold text-emerald-700">· {filteredAvailableSeats.length} {t("available", "available")}</span></h3></div>
        <div className="flex flex-wrap items-center gap-2"><select value={seatMapZone} onChange={(e) => setSeatMapZone(e.target.value)} className="rounded-lg border border-slate-300 px-2 py-1 text-xs"><option value="">{t("allZones", "All zones")}</option>{seatMapZones.map((zone) => <option key={zone} value={zone}>{zone}</option>)}</select><div className="direct-ticketing-seat-map-view-toggle flex rounded-md border border-slate-300 p-0.5"><button type="button" aria-pressed={seatMapView === "map"} onClick={() => setSeatMapView("map")} className={`rounded px-2 py-1 text-[10px] font-bold ${seatMapView === "map" ? "bg-violet-700 text-white" : "text-slate-600"}`}>{t("spatialMapView", "Spatial map")}</button><button type="button" aria-pressed={seatMapView === "table"} onClick={() => setSeatMapView("table")} className={`rounded px-2 py-1 text-[10px] font-bold ${seatMapView === "table" ? "bg-violet-700 text-white" : "text-slate-600"}`}>{t("tableView", "Table")}</button></div><label className="flex items-center gap-1 text-[10px] text-slate-600">{t("tableZoom", "Table zoom")} <input type="range" min="0.45" max="1.4" step="0.05" value={seatTableZoom} onChange={(e) => setSeatTableZoom(e.target.value)} /><span className="w-8 text-right tabular-nums">{Math.round(Number(seatTableZoom) * 100)}%</span></label>{seatMapImageUrl && <button type="button" aria-pressed={showSeatMapImage} onClick={() => setShowSeatMapImage((value) => !value)} className="rounded-md border border-slate-300 px-2 py-1 text-[10px] font-bold text-slate-700">{showSeatMapImage ? t("hideSourceImage", "Hide source") : t("showSourceImage", "Show source")}</button>}</div>
      </div>
      {showSeatMapImage && seatMapImageUrl && <section role="dialog" aria-modal="true" aria-label={t("seatMapAlt", "Seat map source image")} className="direct-ticketing-source-map fixed left-1/2 top-16 z-50 w-[min(92vw,720px)] -translate-x-1/2 overflow-hidden rounded-2xl border border-slate-300 bg-slate-100 p-3 shadow-2xl"><div className="flex items-center justify-between gap-2"><div><p className="text-[10px] font-bold uppercase tracking-[.14em] text-violet-600">{t("sourceMap", "Source map")}</p><p className="text-xs text-slate-600">{t("sourceMapHint", "Fit the full plan here, then close it to keep working in the table.")}</p></div><div className="flex items-center gap-1"><button type="button" onClick={() => setSeatMapZoom("1")} className="rounded-md border border-slate-300 px-2 py-1 text-[10px] font-bold text-slate-700">{t("fitMap", "Fit map")}</button><button type="button" aria-label={t("hideSourceImage", "Hide source")} onClick={() => setShowSeatMapImage(false)} className="rounded-md border border-slate-300 px-2 py-1 text-sm font-bold leading-none text-slate-700">×</button></div></div><div className="mt-2 flex items-center justify-end"><label className="flex items-center gap-1 text-[10px] text-slate-600">{t("imageZoom", "Image zoom")} <input type="range" min="0.5" max="2.5" step="0.1" value={seatMapZoom} onChange={(e) => setSeatMapZoom(e.target.value)} /><span className="w-8 text-right tabular-nums">{Math.round(Number(seatMapZoom) * 100)}%</span></label></div><div className="direct-ticketing-source-map-canvas mt-1 overflow-auto rounded-xl border border-slate-300 bg-white p-2"><div className="mx-auto" style={{ width: String(Number(seatMapZoom) * 100) + "%", minWidth: "320px" }}><img src={seatMapImageUrl} alt={t("seatMapAlt", "Seat map source image")} className="mx-auto block h-auto max-h-[calc(100vh-12rem)] max-w-full object-contain" /></div></div></section>}
      {seatMapView === "map" && <div className="direct-ticketing-spatial-map-panel mt-2 rounded-xl border border-slate-300 bg-slate-50 p-2">{spatialMapAvailable ? <><div className="flex flex-wrap items-center justify-between gap-2 px-1 pb-2 text-[10px] text-slate-600"><span>{t("spatialMapHint", "Positions follow the imported X/Y coordinates; gaps are intentional.")}</span><span className="font-semibold">{spatialSeatMap.positioned.length} / {seatMapGrid.rows.reduce((count, row) => count + row.seats.size, 0)} {t("mappedSeats", "mapped seats")}</span></div><div className="direct-ticketing-spatial-map-scroll overflow-auto rounded-lg border border-slate-300 bg-white"><div className="direct-ticketing-spatial-map" style={{ aspectRatio: String(spatialSeatMap.aspectRatio), zoom: Number(seatTableZoom) }}>{spatialSeatMap.positioned.map((seat) => { const existing = seatByKey.get(seatDraftKey({ zone: seat.zone, section_label: seat.section_label || "", row_label: seat.row_label, seat_label: seat.seat_label })); const selected = Boolean(existing && selectedSeatIds.includes(existing.id)); const sourceStatus = existing?.source_status || "unknown"; const directIssued = ["issued", "checked_in"].includes(existing?.status || ""); const unavailable = !existing || existing.status !== "available" || existing.allocation_status === "not_allocated"; const buttonClass = selected ? "direct-ticketing-spatial-seat is-selected" : directIssued ? "direct-ticketing-spatial-seat is-direct-issued" : sourceStatus === "blocked" && !unavailable ? "direct-ticketing-spatial-seat is-blocked" : sourceStatus === "sold" || sourceStatus === "generated" ? "direct-ticketing-spatial-seat is-sold" : sourceStatus === "available" ? "direct-ticketing-spatial-seat is-available" : "direct-ticketing-spatial-seat is-unknown"; return <button key={`${seat.zone}-${seat.row_label}-${seat.seat_label}`} type="button" disabled={unavailable} title={`${seat.zone} ${seat.row_label}-${seat.seat_label}`} aria-label={`${seat.zone} ${seat.row_label}-${seat.seat_label}`} onClick={() => { if (existing) toggleSeatSelection(existing); }} className={buttonClass} style={{ left: `${seat.left}%`, top: `${seat.top}%` }}>{seat.row_label}{seat.seat_label}</button>; })}</div></div></> : <p className="p-3 text-xs text-amber-800">{t("spatialMapUnavailable", "This zone does not have enough X/Y coordinates yet. Use Table view or import a reviewed layout.")}</p>}</div>}
      <div className={seatMapView === "map" && spatialMapAvailable ? "hidden" : "mt-2"}><div className="flex items-center justify-between gap-2"><h4 className="text-xs font-bold text-slate-900">{t("zoneRowSeat", "Zone / Row / Seat")}</h4><span className="text-[10px] text-slate-500">{t("seatSelectionHint", "Click red seats to select multiple · selected")} {selectedSeatIds.length} {t("seats", "seats")}</span></div><div className="mt-1 max-h-[56vh] overflow-auto rounded-xl border border-slate-300 bg-slate-50"><div className="min-w-max origin-top-left" style={{ zoom: Number(seatTableZoom) }}>{seatMapGrid.rows.length ? <table className="w-full border-collapse text-xs"><thead className="sticky top-0 z-10 bg-slate-100 text-slate-700"><tr><th className="sticky left-0 z-20 border-b border-r border-slate-300 bg-slate-100 px-3 py-2 text-left">{t("zoneRow", "Zone / Row")}</th>{seatMapGrid.seatLabels.map((label) => <th key={label} className="border-b border-slate-300 px-2 py-2 text-center">{label}</th>)}</tr></thead><tbody>{seatMapGrid.rows.map((row) => <tr key={row.zone + row.rowLabel} className="border-b border-slate-200"><th className="sticky left-0 z-10 whitespace-nowrap border-r border-slate-300 bg-slate-50 px-3 py-2 text-left font-bold text-slate-700">{row.zone} · {row.rowLabel}</th>{seatMapGrid.seatLabels.map((label) => { const seat = row.seats.get(label); if (!seat) return <td key={label} className="h-12 w-14 border-r border-slate-200" />; const existing = seats.find((item) => item.zone === seat.zone && (item.section_label || "") === (seat.section_label || "") && item.row_label === seat.row_label && item.seat_label === seat.seat_label); const selected = Boolean(existing && selectedSeatIds.includes(existing.id)); const sourceStatus = existing?.source_status || seat.source_status; const directIssued = ["issued", "checked_in"].includes(existing?.status || ""); const unavailable = !existing || existing.status !== "available" || existing.allocation_status === "not_allocated"; const buttonClass = sourceStatus === "blocked" && !unavailable ? "flex h-9 w-full items-center justify-center rounded-lg border border-rose-600 bg-rose-600 text-[10px] font-bold text-white hover:bg-rose-700" : sourceStatus === "sold" || sourceStatus === "generated" ? "flex h-9 w-full items-center justify-center rounded-lg border border-sky-500 bg-sky-500 text-[10px] font-bold text-white" : sourceStatus === "available" ? "flex h-9 w-full items-center justify-center rounded-lg border border-emerald-500 bg-white text-[10px] font-bold text-emerald-700" : "flex h-9 w-full items-center justify-center rounded-lg border border-slate-400 bg-slate-200 text-[10px] font-bold text-slate-600"; return <td key={label} className="h-12 w-14 border-r border-slate-200 p-1 text-center"><button type="button" disabled={unavailable} title={seat.zone + " " + seat.row_label + "-" + seat.seat_label} onClick={() => { if (existing) toggleSeatSelection(existing); }} className={selected ? "flex h-9 w-full items-center justify-center rounded-lg border-2 border-violet-700 bg-violet-600 text-[10px] font-bold text-white" : directIssued ? "direct-ticketing-table-seat is-direct-issued flex h-9 w-full items-center justify-center rounded-lg text-[10px] font-bold text-white" : buttonClass}>{seat.seat_label}</button></td>; })}</tr>)}</tbody></table> : <p className="p-4 text-sm text-slate-500">{t("noRowsForZone", "No row/seat data for this zone yet.")}</p>}</div></div></div>
    </section>}
    {performanceId && <div className="direct-ticketing-manage-section direct-ticketing-availability grid gap-3">
      <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm"><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-bold">{t("availableSeats", "3. Available seats")}</h3><div className="flex items-center gap-2"><select value={seatMapZone} onChange={(event) => setSeatMapZone(event.target.value)} className="rounded-lg border border-slate-300 px-2 py-1 text-xs"><option value="">{t("allZones", "All zones")}</option>{seatMapZones.map((zone) => <option key={zone} value={zone}>{zone}</option>)}</select><span className="text-xs font-bold text-emerald-700">{filteredAvailableSeats.length} {t("available", "available")}</span><button type="button" disabled={!canManage || filteredAvailableSeats.length === 0} onClick={selectAllAvailableSeats} className="rounded-lg border border-violet-300 px-2 py-1 text-xs font-bold text-violet-700 disabled:opacity-40">{t("selectAllAvailable", "Select all available")}</button></div></div>{seats.length === 0 ? <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">{t("noSeatsInPerformance", "No seats in this performance yet — load a CSV in step 2 to import locked seats first.")}</p> : filteredAvailableSeats.length === 0 ? <p className="mt-2 rounded-lg bg-slate-100 px-3 py-2 text-xs text-slate-600">{t("noAvailableSeats", "No available seats left in this filter.")}</p> : null}<p className="mt-2 text-[11px] font-semibold text-violet-700">{t("seatSelectionHint", "Click seats to select multiple · selected")} {selectedSeatIds.length} {t("seats", "seats")}</p><div className="mt-2 max-h-48 overflow-auto"><div className="flex flex-wrap gap-1.5">{filteredAvailableSeats.map((seat) => <button type="button" key={seat.id} disabled={!canManage || seat.status !== "available" || seat.allocation_status === "not_allocated"} onClick={() => toggleSeatSelection(seat)} className={`rounded-lg border px-2 py-1.5 text-[11px] font-bold ${selectedSeatIds.includes(seat.id) ? "border-violet-600 bg-violet-100" : "border-emerald-300 bg-emerald-50"}`}>{seat.row_label}-{seat.seat_label}</button>)}</div></div></div>
      {canManage && <form onSubmit={createTicket} className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm"><h3 className="text-sm font-bold">{t("issueHoldTicket", "4. Issue or hold ticket")}</h3><p className="mt-1 text-xs text-slate-500">{selectedSeatIds.length ? `${t("selectedSeats", "Selected")} ${selectedSeatIds.length} ${t("seatsEach", "seats — each seat gets one ticket for this guest")}` : t("chooseSeats", "Choose one or more available seats")}</p>{selectedSeatIds.length > 1 && <p className="mt-1 text-[11px] font-semibold text-violet-700">{t("totalPrice", "Total price")} {formatNumber((Number(ticketForm.price_amount) || 0) * selectedSeatIds.length)} THB</p>}<div className="mt-2 grid gap-2 sm:grid-cols-2"><input required placeholder={t("guestNamePlaceholder", "Guest name (same name on every ticket)")} value={ticketForm.holder_name} onChange={(e) => setTicketForm({ ...ticketForm, holder_name: e.target.value })} className="min-w-0 rounded-lg border border-slate-300 px-2 py-1.5 text-xs"/><input placeholder={t("buyerName", "Buyer name")} value={ticketForm.buyer_name} onChange={(e) => setTicketForm({ ...ticketForm, buyer_name: e.target.value })} className="min-w-0 rounded-lg border border-slate-300 px-2 py-1.5 text-xs"/><select required value={ticketClasses.some((item) => item.name === ticketForm.ticket_class) ? ticketForm.ticket_class : "__custom"} onChange={(e) => { const selected = ticketClasses.find((item) => item.name === e.target.value); setTicketForm({ ...ticketForm, ticket_class: e.target.value, price_amount: selected ? String(selected.price_amount) : ticketForm.price_amount, payment_required: selected ? selected.payment_required : ticketForm.payment_required }); }} className="min-w-0 rounded-lg border border-slate-300 px-2 py-1.5 text-xs">{ticketClasses.map((item) => <option key={item.id} value={item.name}>{item.name}</option>)}<option value="__custom">{t("customClass", "Custom class…")}</option></select>{!ticketClasses.some((item) => item.name === ticketForm.ticket_class) && <input required placeholder={t("customTicketClass", "Custom ticket class")} value={ticketForm.ticket_class === "__custom" ? "" : ticketForm.ticket_class} onChange={(e) => setTicketForm({ ...ticketForm, ticket_class: e.target.value })} className="min-w-0 rounded-lg border border-slate-300 px-2 py-1.5 text-xs"/>}<input type="number" min="0" placeholder={t("priceThb", "Price (THB)")} value={ticketForm.price_amount} onChange={(e) => setTicketForm({ ...ticketForm, price_amount: e.target.value })} className="min-w-0 rounded-lg border border-slate-300 px-2 py-1.5 text-xs"/>{ticketForm.payment_required && <input type="number" min="5" max="120" placeholder={t("holdMinutes", "Hold minutes")} value={ticketForm.hold_minutes} onChange={(e) => setTicketForm({ ...ticketForm, hold_minutes: e.target.value })} className="min-w-0 rounded-lg border border-slate-300 px-2 py-1.5 text-xs"/>}</div><label className="mt-2 flex gap-2 text-xs"><input type="checkbox" checked={ticketForm.payment_required} onChange={(e) => setTicketForm({ ...ticketForm, payment_required: e.target.checked })}/> {t("paymentRequired", "Payment required (untick for complimentary)")}</label><button disabled={busy || !selectedSeatIds.length && !ticketForm.seat_id} className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-violet-700 px-3 py-1.5 text-xs font-bold text-white disabled:cursor-wait disabled:opacity-70">{ticketCreationProgress ? <><span aria-hidden="true" className="h-3 w-3 animate-spin rounded-full border-2 border-white/35 border-t-white" />{t("creatingTickets", "Creating tickets")} {ticketCreationProgress.completed}/{ticketCreationProgress.total}</> : selectedSeatIds.length > 1 ? `${t("create", "Create")} ${selectedSeatIds.length} ${t("tickets", "tickets")}` : t("createTicket", "Create ticket")}</button></form>}
    </div>}
    </div>
    {canManage && orders.filter((order) => ["pending_payment", "payment_submitted"].includes(order.status)).length > 0 && <section className="direct-ticketing-section rounded-2xl border border-amber-200 bg-amber-50 p-5 shadow-sm"><div className="flex flex-wrap items-center justify-between gap-2"><div><p className="text-xs font-bold uppercase tracking-[.16em] text-amber-700">Customer checkout</p><h3 className="mt-1 font-bold text-amber-950">Order payment review</h3></div><span className="text-xs font-semibold text-amber-800">{orders.filter((order) => ["pending_payment", "payment_submitted"].includes(order.status)).length} awaiting review</span></div><div className="mt-3 space-y-2">{orders.filter((order) => ["pending_payment", "payment_submitted"].includes(order.status)).map((order) => <div key={order.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-white px-3 py-3 text-sm"><div><p className="font-semibold text-slate-900">{order.id} · {order.buyer_name || "Buyer"} · {new Intl.NumberFormat(language === "th" ? "th-TH" : "en-US", { style: "currency", currency: order.currency || "THB" }).format(Number(order.total_amount || 0))}</p><p className="mt-1 text-xs text-slate-500">{order.status.replaceAll("_", " ")}{order.payment_proof_submitted_at ? " · proof submitted" : " · waiting for proof"}</p></div><div className="flex flex-wrap items-center gap-2">{order.payment_proof_submitted_at && order.tickets[0]?.id && <a href={`/api/direct-ticketing/tickets/${encodeURIComponent(order.tickets[0].id)}/payment-proof?event_id=${encodeURIComponent(eventId)}`} target="_blank" rel="noreferrer" className="font-bold text-amber-700">View proof</a>}<button type="button" onClick={() => void updateOrderPayment(order, "verified")} className="font-bold text-emerald-700">Verify order</button><button type="button" onClick={() => void updateOrderPayment(order, "rejected")} className="font-bold text-rose-700">Reject order</button></div></div>)}</div></section>}
    <div className="direct-ticketing-section direct-ticketing-tickets rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="font-bold">{t("directTickets", "Direct tickets")}</h3>
          <p className="mt-1 text-xs text-slate-500">{formatNumber(filteredTickets.length)} {t("matchingTickets", "matching tickets")} · {formatNumber(printableTicketIds.length)} {t("printableTickets", "ready to print")}</p>
        </div>
        <div className="flex flex-wrap gap-3">
          <a href={printableTicketIds.length ? printA4Href : undefined} aria-disabled={!printableTicketIds.length} target="_blank" rel="noreferrer" className={"text-sm font-bold " + (printableTicketIds.length ? "text-violet-700" : "pointer-events-none text-slate-400")}>{t("printFilteredA4", "Print selected A4")} ({formatNumber(printableTicketIds.length)})</a>
          {ticketRecipientFilter !== "all" && printableTicketIds.length > 0 && <><a href={batchPngHref} className="text-sm font-bold text-violet-700">{t("exportIndividualPng", "Export individual PNGs (ZIP)")} ({formatNumber(printableTicketIds.length)})</a><a href={batchPdfHref} className="text-sm font-bold text-violet-700">{t("exportIndividualPdf", "Export individual PDFs (ZIP)")} ({formatNumber(printableTicketIds.length)})</a></>}
          <a href={"/api/direct-ticketing/tickets/print-a4.pdf?event_id=" + encodeURIComponent(eventId)} target="_blank" rel="noreferrer" className="text-sm font-bold text-violet-700">{t("printA4", "Print all A4")}</a>
          <a href={"/api/direct-ticketing/inventory/export?event_id=" + encodeURIComponent(eventId)} className="text-sm font-bold text-violet-700">{t("reconcileSeats", "Reconcile seats")}</a>
          <a href={ticketExportHref} className="text-sm font-bold text-violet-700">{t("salesCsv", "Sales CSV")} ({t("selectedExportGroup", "selected group")})</a>
        </div>
      </div>
      <div className="mt-3 grid gap-2 md:grid-cols-[minmax(0,1fr)_180px_220px_180px_220px_auto]">
        <input aria-label={t("searchTickets", "Search tickets")} placeholder={t("searchTicketsPlaceholder", "Search recipient, buyer, ticket ID, seat…")} value={ticketSearch} onChange={(event) => setTicketSearch(event.target.value)} className="min-w-0 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        <select aria-label={t("filterStatus", "Filter status")} value={ticketStatusFilter} onChange={(event) => setTicketStatusFilter(event.target.value)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
          <option value="all">{t("allStatuses", "All statuses")}</option>
          <option value="issued">{statusLabel("issued")}</option>
          <option value="held">{statusLabel("held")}</option>
          <option value="checked_in">{statusLabel("checked_in")}</option>
          <option value="voided">{statusLabel("voided")}</option>
        </select>
        <select aria-label={t("filterPerformance", "Filter performance")} value={ticketPerformanceFilter} onChange={(event) => setTicketPerformanceFilter(event.target.value)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
          <option value="all">{t("allPerformances", "All performances")}</option>
          {performances.map((performance) => <option key={performance.id} value={performance.id}>{performance.code} — {performance.title}</option>)}
        </select>
        <select aria-label={t("filterZone", "Filter zone")} value={ticketZoneFilter} onChange={(event) => setTicketZoneFilter(event.target.value)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
          <option value="all">{t("allZones", "All zones")}</option>
          {ticketZones.map((zone) => <option key={zone} value={zone}>{zone}</option>)}
        </select>
        <select aria-label={t("filterBuyer", "Filter buyer")} value={ticketBuyerFilter} onChange={(event) => setTicketBuyerFilter(event.target.value)} className="rounded-lg border border-violet-300 bg-violet-50 px-3 py-2 text-sm font-semibold text-violet-900">
          <option value="all">{t("allBuyers", "All buyers")}</option>
          {ticketBuyers.map((buyer) => <option key={buyer} value={buyer}>{buyer}</option>)}
        </select>
        <select aria-label={t("exportZones", "Export zones")} value={ticketExportZoneGroup} onChange={(event) => setTicketExportZoneGroup(event.target.value)} className="rounded-lg border border-violet-300 bg-violet-50 px-3 py-2 text-sm font-semibold text-violet-900">
          <option value="all">{t("allZoneGroup", "All zones")}</option>
          <option value="zones-1-6">{t("zones1to6", "Zones 1–6")}</option>
          <option value="zones-7-9">{t("zones7to9", "Zones 7–9")}</option>
        </select>
        <button type="button" onClick={() => { setTicketSearch(""); setTicketStatusFilter("all"); setTicketPerformanceFilter("all"); setTicketZoneFilter("all"); setTicketBuyerFilter("all"); setTicketRecipientFilter("all"); setTicketExportZoneGroup("all"); }} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-bold text-slate-700">{t("clearTicketFilters", "Clear")}</button>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
        <div className="rounded-lg bg-slate-100 px-3 py-2"><p className="text-[10px] font-bold uppercase text-slate-500">{t("totalTickets", "Total")}</p><p className="text-lg font-extrabold text-slate-900">{formatNumber(filteredTickets.length)}</p></div>
        <div className="rounded-lg bg-emerald-50 px-3 py-2"><p className="text-[10px] font-bold uppercase text-emerald-700">{statusLabel("issued")}</p><p className="text-lg font-extrabold text-emerald-800">{formatNumber(ticketStatusCounts.issued || 0)}</p></div>
        <div className="rounded-lg bg-amber-50 px-3 py-2"><p className="text-[10px] font-bold uppercase text-amber-700">{statusLabel("held")}</p><p className="text-lg font-extrabold text-amber-800">{formatNumber(ticketStatusCounts.held || 0)}</p></div>
        <div className="rounded-lg bg-sky-50 px-3 py-2"><p className="text-[10px] font-bold uppercase text-sky-700">{statusLabel("checked_in")}</p><p className="text-lg font-extrabold text-sky-800">{formatNumber(ticketStatusCounts.checked_in || 0)}</p></div>
        <div className="rounded-lg bg-rose-50 px-3 py-2"><p className="text-[10px] font-bold uppercase text-rose-700">{statusLabel("voided")}</p><p className="text-lg font-extrabold text-rose-800">{formatNumber(ticketStatusCounts.voided || 0)}</p></div>
      </div>
      {ticketRecipientSummary.length > 0 && <div className="mt-3 rounded-xl border border-violet-200 bg-violet-50 p-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2"><h4 className="text-sm font-bold text-slate-900">{t("recipientReport", "Recipient report")}</h4><span className="text-xs text-violet-800">{t("recipientReportHint", "Filter first to see how many tickets each person received")}</span></div>
        <div className="mt-2 grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
          {ticketRecipientSummary.map((group) => <div key={group.name} className="grid min-w-0 gap-0.5 rounded-lg bg-slate-50 px-3 py-2 text-sm"><div className="flex min-w-0 items-start justify-between gap-2"><button type="button" aria-pressed={ticketRecipientFilter === group.name} onClick={() => setTicketRecipientFilter(ticketRecipientFilter === group.name ? "all" : group.name)} className={"min-w-0 flex-1 whitespace-normal break-words rounded px-1 text-left font-semibold leading-tight text-slate-800 transition hover:bg-violet-100 " + (ticketRecipientFilter === group.name ? "bg-violet-100 ring-1 ring-violet-400" : "")} title={group.name}>{group.name}</button><span className="shrink-0 text-right text-xs font-bold text-violet-800">{formatNumber(group.total)} {t("tickets", "tickets")}</span></div><span className="text-right text-xs font-normal leading-tight text-slate-500">{formatNumber(group.issued)} {statusLabel("issued")} · {formatNumber(group.held)} {statusLabel("held")} · {formatNumber(group.checked_in)} {statusLabel("checked_in")} · {formatNumber(group.voided)} {statusLabel("voided")}</span><span className="text-right text-xs font-semibold leading-tight text-violet-700">{formatNumber(group.sent)} {t("deliverySent", "sent")} · {formatNumber(group.unsent)} {t("deliveryUnsent", "unsent")}</span></div>)}
        </div>
        {canManage && ticketRecipientFilter !== "all" && <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-violet-200 bg-white px-3 py-3"><div><p className="text-sm font-bold text-slate-900">{t("deliveryBatchTitle", "This ticket batch")}</p><p className="mt-1 text-xs text-slate-500">{recipientDeliveryTickets.length ? `${formatNumber(recipientDeliveryTickets.length)} ${t("deliveryUnsent", "unsent")}` : t("deliveryAllSent", "All issued tickets for this recipient have been sent")}</p></div>{recipientDeliveryTickets.length > 0 && <div className="flex flex-wrap items-center gap-2"><button type="button" disabled={busy} onClick={() => void copyRecipientDelivery()} className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold text-slate-700 disabled:cursor-wait disabled:opacity-40">{t("copyDeliveryLinks", "Copy batch links")}</button><button type="button" disabled={busy || recipientEmailTicketCount === 0} onClick={() => void sendRecipientDelivery("email")} className="rounded-lg bg-violet-700 px-3 py-2 text-xs font-bold text-white disabled:cursor-not-allowed disabled:opacity-40">{t("sendByEmail", "Send email")} ({formatNumber(recipientEmailTicketCount)})</button><button type="button" disabled={busy} onClick={() => void sendRecipientDelivery("manual")} className="rounded-lg border border-violet-300 px-3 py-2 text-xs font-bold text-violet-700 disabled:cursor-wait disabled:opacity-40">{t("markSentManually", "Mark sent manually")} ({formatNumber(recipientDeliveryTickets.length)})</button></div>}{recipientDeliveryTickets.length > 0 && recipientEmailTicketCount === 0 && <p className="basis-full text-xs font-semibold text-amber-700">{t("deliveryNoEmail", "This batch has no recipient email")}</p>}</div>}
      </div>}
      <div className="mt-3 overflow-auto">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="border-b text-xs uppercase text-slate-500"><tr><th className="py-2">{t("guest", "Guest")}</th><th>{t("seat", "Seat")}</th><th>{t("performance", "Performance")}</th><th>{t("payment", "Payment")}</th><th>{t("status", "Status")}</th><th>{t("deliveryStatus", "Delivery")}</th><th /></tr></thead>
          <tbody>{filteredTickets.map((ticket) => <tr key={ticket.id} className="border-b border-slate-100"><td className="py-3 font-medium" title={ticket.buyer_name && ticket.buyer_name !== ticket.holder_name ? t("buyerName", "Buyer") + ": " + ticket.buyer_name : undefined}>{ticket.holder_name || ticket.buyer_name || "—"}</td><td>{ticket.zone} {ticket.row_label}-{ticket.seat_label}</td><td>{ticket.performance_title || "—"}</td><td>{paymentLabel(ticket.payment_status)}{ticket.has_payment_proof && <span className="ml-1 text-amber-700">• {t("proof", "proof")}</span>}</td><td>{statusLabel(ticket.status)}</td><td>{["issued", "checked_in"].includes(ticket.status) ? ticket.delivery_status === "sent" ? <span className="font-semibold text-emerald-700" title={ticket.delivery_sent_at || undefined}>{t("deliverySent", "Sent")} · {ticket.delivery_method === "email" ? t("deliveryMethod.email", "email") : t("deliveryMethod.manual", "manual")}</span> : <span className="font-semibold text-amber-700">{t("deliveryUnsent", "Unsent")}</span> : "—"}</td><td className="space-x-2 whitespace-nowrap">{ticket.status === "held" && canManage && <><a href={"/api/direct-ticketing/payment-qr?event_id=" + encodeURIComponent(eventId) + "&amount=" + encodeURIComponent(ticket.price_amount)} target="_blank" rel="noreferrer" className="font-bold text-violet-700">{t("promptPayQr", "PromptPay QR")}</a>{ticket.has_payment_proof && <a href={"/api/direct-ticketing/tickets/" + encodeURIComponent(ticket.id) + "/payment-proof?event_id=" + encodeURIComponent(eventId)} target="_blank" rel="noreferrer" className="font-bold text-amber-700">{t("viewProof", "View proof")}</a>}<button onClick={() => void updatePayment(ticket, "verified")} className="font-bold text-emerald-700">{t("verify", "Verify")}</button><button onClick={() => void updatePayment(ticket, "rejected")} className="font-bold text-rose-700">{t("reject", "Reject")}</button></>}{["issued", "checked_in"].includes(ticket.status) && <>{ticket.delivery ? <><a href={ticket.delivery.png_url} target="_blank" rel="noreferrer" className="font-bold text-violet-700">PNG</a><a href={ticket.delivery.pdf_url} target="_blank" rel="noreferrer" className="font-bold text-violet-700">A6 PDF</a>{ticket.delivery.email_pdf_url && <a href={ticket.delivery.email_pdf_url} target="_blank" rel="noreferrer" className="font-bold text-violet-700">A4 PDF</a>}</> : <span className="font-semibold text-rose-600">{t("printUnavailable", "Print unavailable")}</span>}{canManage && <><button onClick={() => void reissueTicket(ticket)} className="font-bold text-amber-700">{t("reissue", "Reissue")}</button><button onClick={() => void voidTicket(ticket)} className="font-bold text-rose-700">{t("void", "Void")}</button></>}</>}</td></tr>)}</tbody>
        </table>
        {filteredTickets.length === 0 && <p className="py-5 text-sm text-slate-500">{tickets.length ? t("noMatchingTickets", "No tickets match these filters.") : t("noTickets", "No direct tickets yet.")}</p>}
      </div>
    </div>
  </div>;
}

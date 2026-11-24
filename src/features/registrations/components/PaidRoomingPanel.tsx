import { useEffect, useId, useLayoutEffect, useRef, useState, type DragEvent } from "react";
import { BedDouble, BedSingle, Download, Plus, Sofa, GripVertical, Lock, RefreshCw, Save, Unlock, WandSparkles } from "lucide-react";
import { ROOM_BED_COUNTS, draftRoomingPlan, moveRoomingGuest, parseRoomingPlan, type RoomingRoom } from "../../../../backend/roomingPlan";
import type { PaidRoomingPlan } from "../../../../backend/db/paidRegistration";
import { downloadRegistrationCsv } from "./registrationCsv";
import { RegistrationSectionHeader } from "./RegistrationSectionHeader";
import { RegistrationStatusTag, getRosterStatus, rosterStatusLabel } from "./RegistrationStatusTag";

type Props = {
  eventId: string;
  language: "th" | "en";
  apiFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
};

function roomTypeForBeds(beds: number) {
  if (beds === 1) return "single";
  if (beds === 2) return "twin";
  return "suite";
}

const roomIcons = { single: BedSingle, twin: BedDouble, suite: Sofa };
type BedPosition = { roomId: string; slot: number };

export function PaidRoomingPanel({ eventId, language, apiFetch }: Props) {
  const t = (th: string, en: string) => language === "th" ? th : en;
  const roomLabels = {
    single: t("ห้องเดี่ยว", "Single room"),
    twin: t("ห้องคู่", "Twin room"),
    suite: t("ห้องสวีท", "Suite"),
  };
  const request = useRef(apiFetch);
  request.current = apiFetch;
  const path = `/api/events/${encodeURIComponent(eventId)}/paid-registration/rooms`;
  const [open, setOpen] = useState(false);
  const [plan, setPlan] = useState<PaidRoomingPlan | null>();
  const [rooms, setRooms] = useState<RoomingRoom[]>([]);
  const [selected, setSelected] = useState("");
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const draggedGuest = useRef("");
  const [search, setSearch] = useState("");
  const [roomSearch, setRoomSearch] = useState("");
  const [editingRoomNumber, setEditingRoomNumber] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loadRequest, setLoadRequest] = useState<{ replacePlan: boolean } | null>(null);
  const roomList = useRef<HTMLDivElement>(null);
  const pendingRoom = useRef<string | null>(null);
  const guestHeadingId = useId();
  const roomHeadingId = useId();
  const dirty = !!plan && JSON.stringify(plan.rooms) !== JSON.stringify(rooms);
  useEffect(() => {
    if (!loadRequest) return;
    const controller = new AbortController();
    setBusy(true);
    setError("");
    void request.current(path, { signal: controller.signal }).then(async (response) => {
      if (!response.ok) throw new Error("rooming_unavailable");
      const payload = await response.json() as { plan: PaidRoomingPlan | null };
      if (controller.signal.aborted) return;
      if (loadRequest.replacePlan) {
        setPlan(payload.plan);
        setRooms(payload.plan?.rooms ?? []);
        setSelected("");
      } else if (payload.plan) {
        const guests = payload.plan.guests;
        setPlan(current => current && { ...current, guests });
      }
    }).catch(() => {
      if (!controller.signal.aborted) setError("rooming_unavailable");
    }).finally(() => {
      if (!controller.signal.aborted) setBusy(false);
    });
    return () => controller.abort();
  }, [loadRequest, path]);

  const byId = new Map(plan?.guests.map((guest) => [guest.id, guest]));
  const assigned = new Set(rooms.flatMap((room) => room.slots));
  const unassigned = (plan?.guests ?? []).filter((guest) => !assigned.has(guest.id));
  const bookingCounts = new Map<string, number>();
  for (const guest of plan?.guests ?? []) bookingCounts.set(guest.bookingId, (bookingCounts.get(guest.bookingId) ?? 0) + 1);
  const groupNumbers = new Map([...bookingCounts].filter(([, count]) => count > 1).map(([id], index) => [id, index + 1]));
  const searchTerm = search.trim().toLowerCase();
  const visibleGuests = unassigned.filter((guest) => `${guest.name} ${guest.category} ${guest.preference}`.toLowerCase().includes(searchTerm));
  const roomSearchTerm = roomSearch.trim().toLowerCase();
  const visibleRooms = rooms.map((room, index) => ({ room, index })).filter(({ room, index }) =>
    !roomSearchTerm || room.id === editingRoomNumber || (room.number || String(index + 1)).toLowerCase().includes(roomSearchTerm));
  const lockedIds = new Set([...rooms, ...(plan?.rooms ?? [])].filter((room) => room.locked).map((room) => room.id));
  const isLocked = (id: string) => lockedIds.has(id);

  useLayoutEffect(() => {
    const list = roomList.current;
    if (!pendingRoom.current || !list) return;
    const room = list.querySelector<HTMLElement>(`[data-room-id="${pendingRoom.current}"]`);
    pendingRoom.current = null;
    if (!room) return;
    const viewport = list.getBoundingClientRect();
    const bounds = room.getBoundingClientRect();
    if (bounds.top < viewport.top || bounds.bottom > viewport.bottom) {
      list.scrollTop += bounds.top - viewport.top - 8;
    }
  }, [rooms, roomSearch]);

  function moveProblem(id: string, destination?: BedPosition) {
    const source = rooms.find((room) => room.slots.includes(id));
    const target = destination && rooms.find((room) => room.id === destination.roomId);
    if (busy || !id || (source && isLocked(source.id)) ||
        (destination ? !target || isLocked(target.id) || target.slots[destination.slot] === id : !source)) return "blocked";
    if (!byId.has(id) && destination) return "rooming_guest_unavailable";
    const displaced = target && destination ? target.slots[destination.slot] : null;
    if (target && byId.get(id)?.single && target.slots.length !== 1 ||
        displaced && source && source.slots.length !== 1 && byId.get(displaced)?.single) {
      return "rooming_single_only";
    }
    if (displaced && !byId.has(displaced) && source && source.id !== target?.id) {
      return "rooming_guest_unavailable";
    }
  }

  function move(id: string, destination?: BedPosition) {
    const problem = moveProblem(id, destination);
    if (problem) {
      if (problem !== "blocked") setError(problem);
      return;
    }
    setError("");
    setMessage("");
    setRooms((current) => moveRoomingGuest(current, id, destination));
    setSelected("");
  }

  function hoverDrop(event: DragEvent<HTMLElement>, key: string, destination?: BedPosition) {
    if (!draggedGuest.current || moveProblem(draggedGuest.current, destination)) {
      event.dataTransfer.dropEffect = "none";
      setDropTarget(null);
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDropTarget(key);
  }

  function leaveDrop(event: DragEvent<HTMLElement>, key: string) {
    if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
    setDropTarget(current => current === key ? null : current);
  }

  function finishDrop(event: DragEvent<HTMLElement>, destination?: BedPosition) {
    event.preventDefault();
    const id = draggedGuest.current;
    draggedGuest.current = "";
    setDropTarget(null);
    if (id) move(id, destination);
  }

  function addRoom(beds: number) {
    const room: RoomingRoom = { id: crypto.randomUUID(), number: "", locked: false, slots: Array(beds).fill(null) };
    pendingRoom.current = room.id;
    setRoomSearch("");
    setRooms(current => [...current, room]);
  }

  async function save() {
    if (!plan || busy || !dirty) return;
    const nextRooms = parseRoomingPlan(rooms);
    if (!nextRooms) {
      setMessage("");
      setError("rooming_invalid_plan");
      return;
    }
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const options = {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ version: plan.version, rooms: nextRooms }),
      };
      const submit = async () => {
        const response = await request.current(path, options);
        const payload = await response.json().catch(() => null) as { plan?: PaidRoomingPlan; error?: string } | null;
        return { response, payload };
      };
      let { response, payload } = await submit();
      if (response.status === 403 && payload?.error === "CSRF token validation failed") {
        // The server can refresh a missing token in this response, before the save handler ran.
        ({ response, payload } = await submit());
      }
      if (!response.ok || !payload?.plan) {
        const code = payload?.error;
        const statusErrors: Record<number, string> = {
          400: "rooming_invalid_plan", 401: "rooming_session_expired", 403: "rooming_forbidden",
          404: "rooming_unavailable", 409: "rooming_conflict", 413: "rooming_too_large",
        };
        setError(code && Object.hasOwn(errors, code) ? code : statusErrors[response.status] ?? "rooming_save_failed");
        return;
      }
      setPlan(payload.plan);
      setRooms(payload.plan.rooms);
      setMessage(t("บันทึกผังห้องแล้ว", "Room plan saved."));
    } catch {
      setError("rooming_network_error");
    } finally {
      setBusy(false);
    }
  }

  function exportRooms() {
    const label = (room: RoomingRoom, index: number) => room.number || t(`รอเลขห้อง ${index + 1}`, `Pending room number ${index + 1}`);
    const labelStatus = (guest: PaidRoomingPlan["guests"][number]) =>
      rosterStatusLabel(getRosterStatus(guest.bookingState, guest.checkedIn), language);
    const rows = [[t("ห้อง", "Room"), t("เตียง", "Bed"), t("ผู้พัก", "Guest"), t("ประเภทผู้เข้าร่วม", "Attendee category"),
      t("ประเภทห้องที่ขอ", "Room preference"), t("สถานะการจัดห้อง", "Room assignment status"),
      t("สถานะการลงทะเบียน", "Registration status")]];
    rooms.forEach((room, index) => room.slots.forEach((id, slot) => {
      const guest = id ? byId.get(id) : undefined;
      rows.push([label(room, index), String(slot + 1), guest?.name ?? "", guest?.category ?? "", guest?.preference ?? "",
        id && !guest ? t("ตรวจสอบสถานะผู้เข้าร่วม", "Check guest status") : !id ? t("ว่าง", "Vacant")
          : room.locked ? t("ล็อกแล้ว", "Locked") : t("ร่าง", "Draft"), guest ? labelStatus(guest) : ""]);
    }));
    for (const guest of unassigned) rows.push(["", "", guest.name, guest.category, guest.preference, t("ยังไม่ได้จัดห้อง", "Unassigned"), labelStatus(guest)]);
    downloadRegistrationCsv(`rooming-${eventId.replace(/[^\w-]/g, "-")}.csv`, rows);
  }

  const button = "registration-admin-control";
  const errors: Record<string, string> = {
    rooming_version_conflict: t("มีผังใหม่กว่าที่บันทึกไว้แล้ว ส่งออก CSV เพื่อเก็บรายการที่แก้ก่อนกดโหลดใหม่", "A newer room plan has been saved. Export CSV to keep a copy of your changes before reloading."),
    rooming_locked: t("บันทึกการปลดล็อกห้องก่อนย้ายผู้พัก", "Save the unlocked room before moving guests."),
    rooming_invalid_plan: t("ตรวจเลขห้องหรือชื่อผู้พักที่ซ้ำกัน เลขห้องที่ยังไม่ทราบให้เว้นว่างได้", "Check for duplicate room numbers or guests. You can leave pending room numbers blank."),
    rooming_guest_unavailable: t("มีผู้พักที่สถานะเปลี่ยนหรือเลือกประเภทห้องไม่ตรง ส่งออก CSV เพื่อเก็บผังที่กำลังแก้ก่อนโหลดใหม่", "A guest’s registration or room preference changed. Export CSV to keep a copy of your draft before reloading."),
    rooming_single_only: t("ผู้พักคนนี้ขอห้องเดี่ยว", "This guest requested a single room."),
    rooming_unavailable: t("โหลดผังห้องไม่สำเร็จ", "Could not load the room plan."),
    event_not_found: t("ระบบไม่พบอีเวนต์นี้หรือบัญชีไม่มีสิทธิ์เข้าถึง", "The event could not be found or is unavailable to this account."),
    "Role preview is read-only": t("โหมดดูสิทธิ์บันทึกไม่ได้ ให้กลับไปที่ Owner เพื่อแก้ไขผัง", "Role previews are read-only. Switch to Owner to edit the plan."),
    "CSRF validation failed": t("ระบบปฏิเสธการบันทึกจากหน้านี้ ส่งออก CSV เก็บผังไว้ก่อนเปิด Meetrix ใหม่", "Meetrix rejected the save from this page. Export CSV before reopening Meetrix."),
    "CSRF token validation failed": t("เซสชันไม่ผ่านการตรวจสอบ ส่งออก CSV เก็บผังไว้ก่อนเปิด Meetrix ใหม่", "Your session could not be verified. Export CSV before reopening Meetrix."),
    rooming_session_expired: t("เซสชันหมดอายุ กรุณาเข้าสู่ระบบอีกครั้ง", "Your session expired. Sign in again."),
    rooming_forbidden: t("บัญชีนี้ไม่มีสิทธิ์บันทึกผังห้อง", "This account does not have permission to save room plans."),
    rooming_conflict: t("ข้อมูลผังบนเซิร์ฟเวอร์เปลี่ยน ส่งออก CSV เก็บผังไว้ก่อนกดโหลดใหม่", "The server’s room plan changed. Export CSV before reloading."),
    rooming_too_large: t("ผังมีขนาดเกินที่เซิร์ฟเวอร์รับได้", "The room plan exceeds the server’s request size limit."),
    rooming_network_error: t("ขาดการเชื่อมต่อระหว่างบันทึก ผังที่แก้ยังอยู่บนหน้าจอ ลองกดบันทึกอีกครั้ง", "The connection dropped during save. Your changes are still here. Try saving again."),
    rooming_save_failed: t("เซิร์ฟเวอร์บันทึกผังไม่สำเร็จ ผังที่แก้ยังอยู่บนหน้าจอ ลองกดบันทึกอีกครั้ง", "The server could not save the plan. Your changes are still here. Try saving again."),
  };

  function guestButton(id: string, click: () => void, draggable: boolean) {
    const guest = byId.get(id);
    const group = guest && groupNumbers.get(guest.bookingId);
    const status = guest && getRosterStatus(guest.bookingState, guest.checkedIn);
    return <button type="button" onClick={click} disabled={busy || !draggable} draggable={!busy && draggable}
      data-registration-status={status} aria-pressed={selected === id} onDragStart={(event) => {
        draggedGuest.current = id;
        event.dataTransfer.setData("text/plain", id);
        event.dataTransfer.effectAllowed = "move";
        setSelected(id);
      }} onDragEnd={() => {
        draggedGuest.current = "";
        setDropTarget(null);
        setSelected("");
      }}
      className={`registration-status-card flex min-h-10 w-full items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left text-sm ${selected === id
        ? "border-blue-500 bg-blue-50" : "border-slate-200 bg-white"} ${draggable ? "cursor-grab active:cursor-grabbing" : ""}`}>
      {draggable && <GripVertical className="h-4 w-4 shrink-0 text-slate-500" aria-hidden="true" />}
      <span className="min-w-0 wrap-anywhere">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <strong className="text-slate-900">{guest?.name ?? t("ผู้พักไม่อยู่ในรายชื่อปัจจุบัน", "Guest no longer on the roster")}</strong>
          {status && <RegistrationStatusTag status={status} language={language} />}
        </span>
        {guest && <small className="text-slate-600">{[guest.category, guest.preference,
          group ? t(`กลุ่มใบจอง ${group}`, `Booking group ${group}`) : "",
          guest.accommodation === "unknown" ? t("รอยืนยันที่พัก", "Stay unconfirmed") : "",
          guest.needsGuardianReview ? t("ตรวจสอบผู้ปกครอง", "Confirm guardian") : ""].filter(Boolean).join(" · ")}</small>}
      </span>
    </button>;
  }

  return <section className="registration-admin-section">
    <RegistrationSectionHeader tone="rooming" title={t("จัดห้องพัก", "Room assignments")} open={open} onToggle={() => {
      if (busy) return;
      if (!open) setLoadRequest({ replacePlan: !plan });
      setOpen(!open);
    }} />
    <div hidden={!open} className="registration-section-content rooming-workspace space-y-2">
      {plan && <div role="group" aria-label={t("เพิ่มห้อง", "Add room")} className="flex flex-wrap items-center gap-1.5">
        {ROOM_BED_COUNTS.map(beds => {
          const type = roomTypeForBeds(beds);
          const Icon = roomIcons[type];
          return <button type="button" key={beds} className={`${button} room-type-add`} data-room-type={type}
            disabled={busy} onClick={() => addRoom(beds)}
            aria-label={t(`เพิ่ม${roomLabels[type]} ${beds} เตียง`, `Add ${roomLabels[type].toLowerCase()} with ${beds} ${beds === 1 ? "bed" : "beds"}`)}>
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            <Icon className="h-4 w-4" aria-hidden="true" />
            {roomLabels[type]}
            <span className="room-type-count">{beds}</span>
          </button>;
        })}
      </div>}
      <div className="flex flex-wrap items-center gap-2">
        {plan && <>
          <button type="button" className={button} disabled={busy || !unassigned.length} onClick={() => {
            const next = draftRoomingPlan(rooms, plan.guests, () => crypto.randomUUID());
            setRooms(next);
            setMessage(next.length === rooms.length ? t("ยังไม่มีคู่ที่จัดอัตโนมัติได้", "No pairs to draft automatically.")
              : t(`เพิ่มห้องร่าง ${next.length - rooms.length} ห้อง`, `Added ${next.length - rooms.length} draft rooms.`));
          }}><WandSparkles className="h-4 w-4" aria-hidden="true" /> {t("จัดร่างอัตโนมัติ", "Draft rooms")}</button>
          <button type="button" className={button} disabled={busy || (!rooms.length && !unassigned.length)} onClick={exportRooms}><Download className="h-4 w-4" aria-hidden="true" /> {t("ส่งออก CSV", "Export CSV")}</button>
          <button type="button" className={`${button} registration-admin-control-primary`} disabled={busy || !dirty} onClick={() => void save()}><Save className="h-4 w-4" aria-hidden="true" /> {t("บันทึกผัง", "Save plan")}</button>
        </>}
        <button type="button" className={button} disabled={busy} onClick={() => {
          if (!dirty || window.confirm(t("โหลดผังที่บันทึกไว้ และทิ้งการแก้ไขที่ยังไม่ได้บันทึกหรือไม่", "Reload the saved plan and discard unsaved changes?"))) {
            setMessage("");
            setLoadRequest({ replacePlan: true });
          }
        }}><RefreshCw className="h-4 w-4" aria-hidden="true" /> {t("โหลดใหม่", "Reload")}</button>
        {plan && <span aria-hidden={!dirty} className={`text-xs font-semibold text-amber-700 ${dirty ? "" : "invisible"}`}>{t("ยังไม่บันทึก", "Unsaved changes")}</span>}
      </div>
      {busy && <p role="status" className="text-sm text-slate-600">{t("กำลังอัปเดตผัง…", "Updating room plan…")}</p>}
      {message && <p role="status" className="text-sm text-slate-700">{message}</p>}
      {error && <p role="alert" className="text-sm font-medium text-rose-700">{errors[error] ?? errors.rooming_save_failed}</p>}
      {plan === null && !busy && <p className="text-sm text-slate-600">{t("เปิดใช้การลงทะเบียนแบบชำระเงินของงานนี้เพื่อจัดห้อง", "Enable paid registration for this event to assign rooms.")}</p>}
      {plan && <>
        <p className="text-sm text-slate-600">{t("ลากผู้พักไปวางบนเตียง หรือเลือกชื่อแล้วแตะเตียงปลายทางเพื่อย้ายหรือสลับกัน ระบบจัดร่างจากใบจองเดียวกันและประเภทห้องที่ขอ ใบจองที่มีเด็กให้แอดมินตรวจและจัดเอง", "Drag a guest onto a bed, or select a name and tap a bed to move or swap. Drafts use booking groups and room preferences. Review and assign bookings with children manually.")}</p>
        <div className="rooming-board">
          <aside className="rooming-pane rounded-xl border border-slate-200 bg-slate-50"
            data-rooming-drop-active={dropTarget === "unassigned" || undefined}
            onDragEnter={event => hoverDrop(event, "unassigned")} onDragOver={event => hoverDrop(event, "unassigned")}
            onDragLeave={event => leaveDrop(event, "unassigned")} onDrop={event => finishDrop(event)}>
            <div className="space-y-2 border-b border-slate-200 p-2.5">
            <h3 id={guestHeadingId} className="font-semibold text-slate-900">{t("ยังไม่ได้จัดห้อง", "Unassigned")} · {unassigned.length}</h3>
            <input type="search" className="min-h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm text-slate-900"
              value={search} onChange={(event) => setSearch(event.target.value)}
              aria-label={t("ค้นหาผู้พักที่ยังไม่ได้จัดห้อง", "Search unassigned guests")} placeholder={t("ค้นหาชื่อผู้พัก", "Search guests")} />
            </div>
            <div className="rooming-scroll rooming-guest-list grid content-start gap-1.5 p-2.5" role="region" tabIndex={0} aria-labelledby={guestHeadingId}>
              {visibleGuests.map(guest => <div key={guest.id}>{guestButton(guest.id, () => setSelected(selected === guest.id ? "" : guest.id), true)}</div>)}
              {!visibleGuests.length && <p className="text-xs text-slate-600">{searchTerm
                ? t("ไม่พบชื่อที่ค้นหา", "No matching guests.")
                : t("ไม่มีผู้พักที่รอจัดห้อง", "No guests waiting for a room.")}</p>}
            </div>
          </aside>
          <div className="rooming-pane rounded-xl border border-slate-200 bg-slate-50">
            <div className="space-y-2 border-b border-slate-200 p-2.5">
              <h3 id={roomHeadingId} className="font-semibold text-slate-900">{t("ห้องพัก", "Rooms")} · {rooms.length}</h3>
              <input type="search" className="min-h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm text-slate-900"
                value={roomSearch} onChange={event => setRoomSearch(event.target.value)}
                aria-label={t("ค้นหาห้องพัก", "Search rooms")} placeholder={t("ค้นหาเลขห้อง", "Search room number")} />
            </div>
            <div ref={roomList} className="rooming-scroll rooming-room-list p-2.5" role="region" tabIndex={0} aria-labelledby={roomHeadingId}>
            {visibleRooms.map(({ room, index }) => {
              const beds = room.slots.length;
              const type = roomTypeForBeds(beds);
              const Icon = roomIcons[type];
              const occupied = room.slots.filter(Boolean).length;
              return (
                <article key={room.id} data-room-id={room.id} data-room-type={type} className="room-type-card rounded-xl border">
                  <header className="room-type-heading">
                    <h3 className="flex items-center gap-1.5 font-semibold">
                      <Icon className="h-4 w-4 shrink-0" aria-hidden="true" /> {roomLabels[type]}
                    </h3>
                    <span className="room-type-count whitespace-nowrap">{t(`${occupied}/${beds} เตียง`, `${occupied}/${beds} beds`)}</span>
                  </header>
                  <div className="space-y-1.5 p-2">
                    <div className="flex items-center gap-1.5">
                      <input value={room.number} maxLength={40} disabled={busy} aria-label={t(`เลขห้อง ${index + 1}`, `Room number ${index + 1}`)}
                        placeholder={t(`ห้อง ${index + 1} · รอเลขจริง`, `Room ${index + 1} · Number pending`)}
                        className="min-h-9 min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-2 text-sm text-slate-900"
                        onFocus={() => setEditingRoomNumber(room.id)} onBlur={() => setEditingRoomNumber("")}
                        onChange={(event) => setRooms(rooms.map((item) => item.id === room.id ? { ...item, number: event.target.value } : item))} />
                      <button type="button" className={button} disabled={busy} aria-pressed={room.locked} aria-label={room.locked ? t("ปลดล็อกห้อง", "Unlock room") : t("ล็อกห้อง", "Lock room")}
                        onClick={() => { setSelected(""); setRooms(rooms.map((item) => item.id === room.id ? { ...item, locked: !item.locked } : item)); }}>
                        {room.locked ? <Lock className="h-4 w-4" /> : <Unlock className="h-4 w-4" />}
                      </button>
                    </div>
                    {!room.locked && isLocked(room.id) && <p className="text-xs text-amber-700">{t("บันทึกเพื่อปลดล็อกห้อง", "Save to unlock the room.")}</p>}
                    {room.slots.map((id, slot) => {
                      const position = { roomId: room.id, slot };
                      const targetKey = `${room.id}:${slot}`;
                      const choose = () => selected && selected !== id ? move(selected, position) : setSelected(id === selected ? "" : id ?? "");
                      return <div key={slot} className="rounded-lg" data-rooming-drop-active={dropTarget === targetKey || undefined}
                        onDragEnter={event => hoverDrop(event, targetKey, position)} onDragOver={event => hoverDrop(event, targetKey, position)}
                        onDragLeave={event => leaveDrop(event, targetKey)} onDrop={event => finishDrop(event, position)}>
                        {id ? guestButton(id, choose, !isLocked(room.id)) :
                          <button type="button" onClick={choose} disabled={busy || !selected || isLocked(room.id)}
                            className={`min-h-10 w-full rounded-lg border border-dashed px-2 text-left text-xs ${selected && !isLocked(room.id)
                              ? "border-blue-500 bg-blue-50 text-blue-800 hover:bg-blue-100" : "border-slate-300 text-slate-600"}`}>
                            {t(`เตียง ${slot + 1} ว่าง`, `Bed ${slot + 1} vacant`)}
                          </button>}
                      </div>;
                    })}
                    {room.slots.every((id) => !id) && !isLocked(room.id) && <button type="button" className="text-xs text-rose-700 underline" disabled={busy}
                      onClick={() => setRooms(rooms.filter((item) => item.id !== room.id))}>{t("ลบห้องว่าง", "Remove empty room")}</button>}
                  </div>
                </article>
              );
            })}
            {!visibleRooms.length && <p className="text-sm text-slate-600">{roomSearchTerm
              ? t("ไม่พบห้องที่ค้นหา", "No matching rooms.")
              : t("ยังไม่มีห้อง กดเพิ่มห้องด้านบนเพื่อเริ่มจัด", "Add a room above to start assigning guests.")}</p>}
            </div>
          </div>
        </div>
        <div className="flex min-h-8 flex-wrap items-center gap-2 text-sm">
          {selected && <p className="text-blue-700" role="status">{t("เลือกแล้ว", "Selected")} · {byId.get(selected)?.name || t("ผู้พัก", "Guest")}</p>}
          {selected && assigned.has(selected) && <button type="button" className={button} disabled={busy} onClick={() => move(selected)}>{t("ย้ายกลับไปรายชื่อ", "Unassign selected guest")}</button>}
        </div>
      </>}
    </div>
  </section>;
}

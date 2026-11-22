import { useEffect, useRef, useState } from "react";
import { BedDouble, Download, GripVertical, Lock, RefreshCw, Save, Unlock, WandSparkles } from "lucide-react";
import { draftRoomingPlan, moveRoomingGuest, type RoomingRoom } from "../../../../backend/roomingPlan";
import type { PaidRoomingPlan } from "../../../../backend/db/paidRegistration";

type Props = {
  eventId: string;
  language: "th" | "en";
  apiFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
};

function csvCell(value: string) {
  const safe = /^[\s\uFEFF]*[=+@-]|^[\t\r\n]/.test(value) ? "'" + value : value;
  return '"' + safe.replaceAll('"', '""') + '"';
}

export function PaidRoomingPanel({ eventId, language, apiFetch }: Props) {
  const t = (th: string, en: string) => language === "th" ? th : en;
  const request = useRef(apiFetch);
  request.current = apiFetch;
  const path = `/api/events/${encodeURIComponent(eventId)}/paid-registration/rooms`;
  const [open, setOpen] = useState(false);
  const [hasOpened, setHasOpened] = useState(false);
  const [plan, setPlan] = useState<PaidRoomingPlan | null>();
  const [rooms, setRooms] = useState<RoomingRoom[]>([]);
  const [selected, setSelected] = useState("");
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const dirty = !!plan && JSON.stringify(plan.rooms) !== JSON.stringify(rooms);
  useEffect(() => {
    if (!hasOpened) return;
    const controller = new AbortController();
    setBusy(true);
    setError("");
    void request.current(path, { signal: controller.signal }).then(async (response) => {
      if (!response.ok) throw new Error("rooming_unavailable");
      const payload = await response.json() as { plan: PaidRoomingPlan | null };
      if (controller.signal.aborted) return;
      setPlan(payload.plan);
      setRooms(payload.plan?.rooms ?? []);
      setSelected("");
    }).catch(() => {
      if (!controller.signal.aborted) setError("rooming_unavailable");
    }).finally(() => {
      if (!controller.signal.aborted) setBusy(false);
    });
    return () => controller.abort();
  }, [hasOpened, path, reload]);

  const byId = new Map(plan?.guests.map((guest) => [guest.id, guest]));
  const assigned = new Set(rooms.flatMap((room) => room.slots));
  const unassigned = (plan?.guests ?? []).filter((guest) => !assigned.has(guest.id));
  const bookingCounts = new Map<string, number>();
  for (const guest of plan?.guests ?? []) bookingCounts.set(guest.bookingId, (bookingCounts.get(guest.bookingId) ?? 0) + 1);
  const groupNumbers = new Map([...bookingCounts].filter(([, count]) => count > 1).map(([id], index) => [id, index + 1]));
  const searchTerm = search.trim().toLowerCase();
  const visibleGuests = unassigned.filter((guest) => `${guest.name} ${guest.category} ${guest.preference}`.toLowerCase().includes(searchTerm));
  const lockedIds = new Set([...rooms, ...(plan?.rooms ?? [])].filter((room) => room.locked).map((room) => room.id));
  const isLocked = (id: string) => lockedIds.has(id);

  function move(id: string, destination?: { roomId: string; slot: number }) {
    if (busy || !id || rooms.some((room) => isLocked(room.id) && room.slots.includes(id))) return;
    const target = destination && rooms.find((room) => room.id === destination.roomId);
    if (target && isLocked(target.id)) return;
    if (!byId.has(id) && destination) return;
    const source = rooms.find((room) => room.slots.includes(id));
    const displaced = target && destination ? target.slots[destination.slot] : null;
    if (target && byId.get(id)?.single && target.slots.length !== 1 ||
        displaced && source?.slots.length === 2 && byId.get(displaced)?.single) {
      setError("rooming_single_only");
      return;
    }
    if (displaced && !byId.has(displaced) && source && source.id !== target?.id) {
      setError("rooming_guest_unavailable");
      return;
    }
    setError("");
    setMessage("");
    setRooms((current) => moveRoomingGuest(current, id, destination));
    setSelected("");
  }

  async function save() {
    if (!plan || busy || !dirty) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await request.current(path, {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ version: plan.version, rooms }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "rooming_save_failed");
      setPlan(payload.plan);
      setRooms(payload.plan.rooms);
      setMessage(t("บันทึกผังห้องแล้ว", "Room plan saved."));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "rooming_save_failed");
    } finally {
      setBusy(false);
    }
  }

  function exportRooms() {
    const label = (room: RoomingRoom, index: number) => room.number || t(`รอเลขห้อง ${index + 1}`, `Pending room number ${index + 1}`);
    const rows = [[t("ห้อง", "Room"), t("เตียง", "Bed"), t("ผู้พัก", "Guest"), t("ประเภทผู้เข้าร่วม", "Attendee category"),
      t("ประเภทห้องที่ขอ", "Room preference"), t("สถานะ", "Status")]];
    rooms.forEach((room, index) => room.slots.forEach((id, slot) => {
      const guest = id ? byId.get(id) : undefined;
      rows.push([label(room, index), String(slot + 1), guest?.name ?? "", guest?.category ?? "", guest?.preference ?? "",
        id && !guest ? t("ตรวจสอบสถานะผู้เข้าร่วม", "Check guest status") : !id ? t("ว่าง", "Vacant")
          : room.locked ? t("ล็อกแล้ว", "Locked") : t("ร่าง", "Draft")]);
    }));
    for (const guest of unassigned) rows.push(["", "", guest.name, guest.category, guest.preference, t("ยังไม่ได้จัดห้อง", "Unassigned")]);
    const url = URL.createObjectURL(new Blob(["\uFEFF", rows.map(row => row.map(csvCell).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `rooming-${eventId.replace(/[^\w-]/g, "-")}.csv`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const button = "inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 disabled:opacity-50";
  const errors: Record<string, string> = {
    rooming_version_conflict: t("มีการบันทึกจากเครื่องอื่นแล้ว กดโหลดใหม่เพื่อดูผังล่าสุด", "Another session saved a newer plan. Reload to see it."),
    rooming_locked: t("บันทึกการปลดล็อกห้องก่อนย้ายผู้พัก", "Save the unlocked room before moving guests."),
    rooming_invalid_plan: t("ตรวจสอบเลขห้องซ้ำและผังเตียง", "Check for duplicate room numbers or guests."),
    rooming_guest_unavailable: t("ตรวจสอบข้อมูลผู้พักและประเภทห้อง แล้วลองใหม่", "Check the guest’s status and room type."),
    rooming_single_only: t("ผู้พักคนนี้ขอห้องเดี่ยว", "This guest requested a single room."),
    rooming_unavailable: t("โหลดผังห้องไม่สำเร็จ", "Could not load the room plan."),
  };

  function guestButton(id: string, click: () => void, draggable: boolean, accessibleLabel?: string) {
    const guest = byId.get(id);
    const group = guest && groupNumbers.get(guest.bookingId);
    return <button type="button" onClick={click} disabled={busy || !draggable} draggable={!busy && draggable}
      aria-label={accessibleLabel} aria-pressed={selected === id} onDragStart={(event) => {
        event.dataTransfer.setData("text/plain", id);
        event.dataTransfer.effectAllowed = "move";
        setSelected(id);
      }} onDragEnd={() => setSelected("")}
      className={`flex min-h-10 w-full items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left text-sm ${selected === id
        ? "border-blue-500 bg-blue-50" : "border-slate-200 bg-white"} ${draggable ? "cursor-grab active:cursor-grabbing" : ""}`}>
      {draggable && <GripVertical className="h-4 w-4 shrink-0 text-slate-500" aria-hidden="true" />}
      <span className="min-w-0 wrap-anywhere">
        <strong className="block text-slate-900">{guest?.name ?? t("ผู้พักไม่อยู่ในรายชื่อปัจจุบัน", "Guest no longer on the roster")}</strong>
        {guest && <small className="text-slate-600">{[guest.category, guest.preference,
          group ? t(`กลุ่มใบจอง ${group}`, `Booking group ${group}`) : "",
          guest.accommodation === "unknown" ? t("รอยืนยันที่พัก", "Stay unconfirmed") : "",
          guest.needsGuardianReview ? t("ตรวจสอบผู้ปกครอง", "Confirm guardian") : ""].filter(Boolean).join(" · ")}</small>}
      </span>
    </button>;
  }

  return <section className="rounded-2xl border border-slate-200 bg-white">
    <button type="button" aria-expanded={open} onClick={() => {
      if (busy) return;
      setHasOpened(true);
      setOpen(!open);
    }} className="flex w-full items-center gap-2 px-4 py-3 text-left font-bold text-slate-900">
      <BedDouble className="h-5 w-5 text-blue-600" aria-hidden="true" /> {t("จัดห้องพัก", "Room assignments")}
      <span className="ml-auto text-sm font-normal text-slate-600">{open ? t("ซ่อน", "Hide") : t("เปิด", "Open")}</span>
    </button>
    <div hidden={!open} className="space-y-3 border-t border-slate-200 p-4">
      <div className="flex flex-wrap items-center gap-2">
        {plan && <>
          <button type="button" className={button} disabled={busy || !unassigned.length} onClick={() => {
            const next = draftRoomingPlan(rooms, plan.guests, () => crypto.randomUUID());
            setRooms(next);
            setMessage(next.length === rooms.length ? t("ยังไม่มีคู่ที่จัดอัตโนมัติได้", "No pairs to draft automatically.")
              : t(`เพิ่มห้องร่าง ${next.length - rooms.length} ห้อง`, `Added ${next.length - rooms.length} draft rooms.`));
          }}><WandSparkles className="h-4 w-4" aria-hidden="true" /> {t("จัดร่างอัตโนมัติ", "Draft rooms")}</button>
          <button type="button" className={button} disabled={busy} onClick={() => setRooms([...rooms, { id: crypto.randomUUID(), number: "", locked: false, slots: [null, null] }])}>{t("เพิ่มห้องคู่", "Add twin room")}</button>
          <button type="button" className={button} disabled={busy} onClick={() => setRooms([...rooms, { id: crypto.randomUUID(), number: "", locked: false, slots: [null] }])}>{t("เพิ่มห้องเดี่ยว", "Add single room")}</button>
          <button type="button" className={button} disabled={busy || (!rooms.length && !unassigned.length)} onClick={exportRooms}><Download className="h-4 w-4" aria-hidden="true" /> {t("Export CSV", "Export CSV")}</button>
          <button type="button" className={`${button} border-blue-200 bg-blue-50 text-blue-700`} disabled={busy || !dirty} onClick={() => void save()}><Save className="h-4 w-4" aria-hidden="true" /> {t("บันทึกผัง", "Save plan")}</button>
        </>}
        <button type="button" className={button} disabled={busy} onClick={() => {
          if (!dirty || window.confirm(t("โหลดผังที่บันทึกไว้ และทิ้งการแก้ไขที่ยังไม่ได้บันทึกหรือไม่", "Reload the saved plan and discard unsaved changes?"))) {
            setMessage("");
            setReload((value) => value + 1);
          }
        }}><RefreshCw className="h-4 w-4" aria-hidden="true" /> {t("โหลดใหม่", "Reload")}</button>
        {dirty && <span className="text-xs font-semibold text-amber-700">{t("ยังไม่บันทึก", "Unsaved changes")}</span>}
      </div>
      {busy && <p role="status" className="text-sm text-slate-600">{t("กำลังอัปเดตผัง…", "Updating room plan…")}</p>}
      {message && <p role="status" className="text-sm text-slate-700">{message}</p>}
      {error && <p role="alert" className="text-sm text-rose-700">{errors[error] ?? t("บันทึกผังไม่สำเร็จ", "Could not save the room plan.")}</p>}
      {plan === null && !busy && <p className="text-sm text-slate-600">{t("เปิดใช้การลงทะเบียนแบบชำระเงินของงานนี้เพื่อจัดห้อง", "Enable paid registration for this event to assign rooms.")}</p>}
      {plan && <>
        <p className="text-sm text-slate-600">{t("ลากผู้พักไปวางบนเตียง หรือเลือกชื่อแล้วแตะเตียงปลายทางเพื่อย้ายหรือสลับกัน ระบบจัดร่างจากใบจองเดียวกันและประเภทห้องที่ขอ ใบจองที่มีเด็กให้แอดมินตรวจและจัดเอง", "Drag a guest onto a bed, or select a name and tap a bed to move or swap. Drafts use booking groups and room preferences. Review and assign bookings with children manually.")}</p>
        <div className="grid items-start gap-3 lg:grid-cols-[minmax(12rem,1fr)_minmax(0,3fr)]">
          <aside className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-2.5" onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => { event.preventDefault(); move(event.dataTransfer.getData("text/plain")); }}>
            <h3 className="font-semibold text-slate-900">{t("ยังไม่ได้จัดห้อง", "Unassigned")} · {unassigned.length}</h3>
            {unassigned.length > 0 && <input type="search" className="min-h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm text-slate-900"
              value={search} onChange={(event) => setSearch(event.target.value)}
              aria-label={t("ค้นหาผู้พักที่ยังไม่ได้จัดห้อง", "Search unassigned guests")} placeholder={t("ค้นหาชื่อผู้พัก", "Search guests")} />}
            {selected && assigned.has(selected) && <button type="button" className={button} disabled={busy} onClick={() => move(selected)}>{t("ย้ายคนที่เลือกมาที่นี่", "Unassign selected guest")}</button>}
            <div className="grid max-h-80 gap-1.5 overflow-auto lg:max-h-[35rem]">
              {visibleGuests.map(guest => <div key={guest.id}>{guestButton(guest.id, () => setSelected(selected === guest.id ? "" : guest.id), true)}</div>)}
              {searchTerm && !visibleGuests.length && <p className="text-xs text-slate-600">{t("ไม่พบชื่อที่ค้นหา", "No matching guests.")}</p>}
            </div>
          </aside>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {rooms.map((room, index) => (
              <article key={room.id} className="space-y-1.5 rounded-xl border border-slate-200 bg-slate-50 p-2.5">
                <div className="flex items-center gap-1.5">
                  <input value={room.number} maxLength={40} disabled={busy} aria-label={t(`เลขห้อง ${index + 1}`, `Room number ${index + 1}`)}
                    placeholder={t(`ห้อง ${index + 1} · รอเลขจริง`, `Room ${index + 1} · Number pending`)}
                    className="min-h-9 min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-2 text-sm text-slate-900"
                    onChange={(event) => setRooms(rooms.map((item) => item.id === room.id ? { ...item, number: event.target.value } : item))} />
                  <button type="button" className={button} disabled={busy} aria-pressed={room.locked} aria-label={room.locked ? t("ปลดล็อกห้อง", "Unlock room") : t("ล็อกห้อง", "Lock room")}
                    onClick={() => { setSelected(""); setRooms(rooms.map((item) => item.id === room.id ? { ...item, locked: !item.locked } : item)); }}>
                    {room.locked ? <Lock className="h-4 w-4" /> : <Unlock className="h-4 w-4" />}
                  </button>
                </div>
                {!room.locked && isLocked(room.id) && <p className="text-xs text-amber-700">{t("บันทึกเพื่อปลดล็อกห้อง", "Save to unlock the room.")}</p>}
                {room.slots.map((id, slot) => {
                  const position = { roomId: room.id, slot };
                  const choose = () => selected && selected !== id ? move(selected, position) : setSelected(id === selected ? "" : id ?? "");
                  return <div key={slot} onDragOver={(event) => { if (!isLocked(room.id)) event.preventDefault(); }} onDrop={(event) => {
                    event.preventDefault();
                    move(event.dataTransfer.getData("text/plain"), position);
                  }}>
                    {id ? guestButton(id, choose, !isLocked(room.id), byId.get(id)?.name) :
                      <button type="button" onClick={choose} disabled={busy || !selected || isLocked(room.id)}
                        className="min-h-10 w-full rounded-lg border border-dashed border-slate-300 px-2 text-left text-xs text-slate-600">
                        {t(`เตียง ${slot + 1} ว่าง`, `Bed ${slot + 1} vacant`)}
                      </button>}
                  </div>;
                })}
                {room.slots.every((id) => !id) && !isLocked(room.id) && <button type="button" className="text-xs text-rose-700 underline" disabled={busy}
                  onClick={() => setRooms(rooms.filter((item) => item.id !== room.id))}>{t("ลบห้องว่าง", "Remove empty room")}</button>}
              </article>
            ))}
          </div>
        </div>
      </>}
    </div>
  </section>;
}

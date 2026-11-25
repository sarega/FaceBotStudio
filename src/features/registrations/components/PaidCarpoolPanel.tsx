import { useState } from "react";
import { Download, RefreshCw, Save } from "lucide-react";
import {
  attendeeCarpoolRole, carpoolRoles, MAX_CARPOOL_SEATS,
  type CarpoolAttendee, type CarpoolCar, type CarpoolLayout, type CarpoolRole, type PaidCarpoolPlan,
} from "../../../../backend/carpoolPlan";
import { downloadRegistrationCsv } from "./registrationCsv";
import { RegistrationSectionHeader } from "./RegistrationSectionHeader";
import { getRosterStatus, RegistrationStatusTag, rosterStatusLabel } from "./RegistrationStatusTag";

type Props = {
  eventId: string;
  language: "th" | "en";
  apiFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
};

function carpoolLayoutKey({ roles, cars }: CarpoolLayout) {
  // The server trims pickup text. Car and passenger order does not affect assignments.
  const assignments = cars
    .filter(car => car.seats || car.pickup.trim())
    .map(({ driverId, seats, pickup, passengers }) => [driverId, seats, pickup.trim(), [...passengers].sort()] as const)
    .sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify([Object.entries(roles).sort(([a], [b]) => a.localeCompare(b)), assignments]);
}

export function PaidCarpoolPanel({ eventId, language, apiFetch }: Props) {
  const t = (th: string, en: string) => language === "th" ? th : en;
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState<PaidCarpoolPlan | null>();
  const [draft, setDraft] = useState<PaidCarpoolPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [search, setSearch] = useState("");
  const path = `/api/events/${encodeURIComponent(eventId)}/paid-registration/carpool`;
  const dirty = !!saved && !!draft && draft !== saved && carpoolLayoutKey(draft) !== carpoolLayoutKey(saved);
  const control = "registration-admin-control";
  const roleLabels: Record<CarpoolRole, string> = {
    driver: t("มีรถรับคน", "Drivers"),
    passenger: t("ต้องการติดรถ", "Need a ride"),
    independent: t("เดินทางเอง", "Travel independently"),
    unspecified: t("รอระบุ", "Unspecified"),
  };
  const errors: Record<string, string> = {
    carpool_unavailable: t("โหลดข้อมูลการเดินทางไม่สำเร็จ", "Could not load carpool data."),
    carpool_invalid_plan: t("ตรวจสอบจำนวนที่นั่งและรายชื่อผู้โดยสาร", "Check seat counts and passenger assignments."),
    carpool_version_conflict: t("มีคนบันทึกผังใหม่แล้ว กดโหลดใหม่เพื่อเปิดผังล่าสุด", "Someone saved a newer plan. Reload to open it."),
    carpool_attendee_unavailable: t("รายชื่อหรือคำตอบการเดินทางเปลี่ยนแล้ว กดโหลดใหม่เพื่อตรวจสอบ", "The roster or travel preferences changed. Reload to review the latest data."),
  };

  async function request(save = false) {
    if (busy || (save && !draft)) return;
    if (!save && dirty && !window.confirm(t("โหลดใหม่และทิ้งการแก้ไขที่ยังไม่บันทึกหรือไม่?", "Reload and discard unsaved changes?"))) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const payload = draft && { version: draft.version, cars: draft.cars, roles: draft.roles };
      const response = await apiFetch(path, save ? {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      } : undefined);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setSaved(data.plan);
      setDraft(data.plan);
      if (save) setMessage(t("บันทึกแผนการเดินทางแล้ว", "Carpool plan saved."));
    } catch (failure) {
      const code = (failure as Error).message;
      setError(errors[code] || (save ? t("บันทึกไม่สำเร็จ", "Could not save the carpool plan.") : errors.carpool_unavailable));
    } finally {
      setBusy(false);
    }
  }

  const groups: Record<CarpoolRole, CarpoolAttendee[]> = { driver: [], passenger: [], independent: [], unspecified: [] };
  const byId = new Map(draft?.attendees.map(attendee => [attendee.id, attendee]));
  for (const attendee of draft?.attendees ?? []) groups[attendeeCarpoolRole(attendee, draft!.roles)].push(attendee);
  const carByDriver = new Map(draft?.cars.map(car => [car.driverId, car]));
  const assignments = new Map(draft?.cars.flatMap(car => car.passengers.map(id => [id, car.driverId] as const)));
  const freeSeats = (draft?.cars ?? []).reduce((total, car) => total + car.seats - car.passengers.length, 0);
  const searchTerm = search.toLowerCase().trim();
  function matches(attendee: CarpoolAttendee) {
    return `${attendee.name} ${attendee.reference} ${attendee.answer}`.toLowerCase().includes(searchTerm);
  }

  function changeRole(attendee: CarpoolAttendee, role: CarpoolRole) {
    if (!draft || assignments.has(attendee.id) || carByDriver.get(attendee.id)?.passengers.length) return;
    const roles = { ...draft.roles };
    if (role === attendee.defaultRole) delete roles[attendee.id];
    else roles[attendee.id] = role;
    setDraft({ ...draft, roles, cars: role === "driver" ? draft.cars : draft.cars.filter(car => car.driverId !== attendee.id) });
    setMessage("");
  }

  function changeCar(car: CarpoolCar) {
    if (!draft || car.seats < car.passengers.length) return;
    const cars = draft.cars.filter(previous => previous.driverId !== car.driverId);
    if (car.seats || car.pickup) cars.push(car);
    setDraft({ ...draft, cars });
    setMessage("");
  }

  function assign(attendeeId: string, driverId: string) {
    if (!draft || assignments.get(attendeeId) === driverId) return;
    const target = carByDriver.get(driverId);
    if (driverId && (!target || target.passengers.length >= target.seats)) return;
    const previousDriver = assignments.get(attendeeId);
    const cars = draft.cars.map(car => {
      if (car.driverId === driverId) return { ...car, passengers: [...car.passengers, attendeeId] };
      if (car.driverId === previousDriver) return { ...car, passengers: car.passengers.filter(id => id !== attendeeId) };
      return car;
    });
    setDraft({ ...draft, cars });
    setMessage("");
  }

  function exportCsv() {
    const rows = [[t("ชื่อผู้ลงทะเบียน", "Attendee"), t("เลขใบจอง", "Booking reference"),
      t("สถานะลงทะเบียน", "Registration status"), t("การเดินทาง", "Transport"),
      t("คนขับ", "Driver"), t("จุดนัดพบ", "Pickup"), t("ที่นั่งว่างในรถ", "Open seats")]];
    for (const role of carpoolRoles) {
      for (const attendee of groups[role]) {
        const driverId = role === "driver" ? attendee.id : assignments.get(attendee.id);
        const car = driverId ? carByDriver.get(driverId) : undefined;
        rows.push([attendee.name, attendee.reference,
          rosterStatusLabel(getRosterStatus(attendee.bookingState, attendee.checkedIn), language), roleLabels[role],
          driverId ? byId.get(driverId)?.name ?? "" : "", car?.pickup ?? "",
          role === "driver" ? String(car ? car.seats - car.passengers.length : 0) : ""]);
      }
    }
    downloadRegistrationCsv(`carpool-${eventId.replace(/[^\w-]/g, "-")}.csv`, rows);
  }

  function attendeeLabel(attendee: CarpoolAttendee) {
    return <div className="min-w-0 wrap-anywhere" title={[attendee.reference, attendee.answer].filter(Boolean).join(" · ")}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
        <strong>{attendee.name}</strong>
        <RegistrationStatusTag language={language} status={getRosterStatus(attendee.bookingState, attendee.checkedIn)} />
      </div>
      {attendee.answer && <small className="block opacity-75">{attendee.answer}</small>}
    </div>;
  }

  function rolePicker(attendee: CarpoolAttendee, role: CarpoolRole) {
    const locked = assignments.has(attendee.id) || !!carByDriver.get(attendee.id)?.passengers.length;
    const label = t(`การเดินทางของ ${attendee.name}`, `Travel mode for ${attendee.name}`);
    return <select className={control} aria-label={label} value={role} disabled={busy || locked}
      title={locked ? t("นำผู้โดยสารออกจากรถก่อนเปลี่ยนประเภท", "Unassign passengers before changing travel mode.") : label}
      onChange={event => changeRole(attendee, event.target.value as CarpoolRole)}>
      {carpoolRoles.map(value => <option key={value} value={value}>{roleLabels[value]}</option>)}
    </select>;
  }

  return <section className="registration-admin-section registration-admin-carpool">
    <RegistrationSectionHeader tone="carpool" title={t("จัดรถร่วมเดินทาง", "Carpool")}
      subtitle={draft ? t(`${freeSeats} ที่นั่งว่าง · ${groups.passenger.length - assignments.size} คนรอรถ`,
        `${freeSeats} open seats · ${groups.passenger.length - assignments.size} waiting`) : undefined}
      open={open} onToggle={() => {
        setOpen(!open);
        if (!open && saved === undefined && !busy) void request();
      }} actions={<>
        <button type="button" className={control} disabled={busy} onClick={() => void request()}>
          <RefreshCw size={14} aria-hidden="true" />{t("โหลดใหม่", "Reload")}
        </button>
        <button type="button" className={control} disabled={busy || dirty || !draft?.attendees.length} onClick={exportCsv}>
          <Download size={14} aria-hidden="true" /> CSV
        </button>
        <button type="button" className={`${control} registration-admin-control-primary`} disabled={busy || !dirty} onClick={() => void request(true)}>
          <Save size={14} aria-hidden="true" />{t("บันทึก", "Save")}
        </button>
      </>} />
    {open && <div className="registration-section-content space-y-3 p-3" aria-busy={busy}>
      {error && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{error}</p>}
      {message && <p role="status" className="text-sm">{message}</p>}
      {busy && !draft && <p role="status">{t("กำลังโหลดรายชื่อ…", "Loading attendees…")}</p>}
      {saved === null && <p>{t("ยังไม่ได้เปิดระบบลงทะเบียนแบบชำระเงินสำหรับงานนี้", "Paid registration is not configured for this event.")}</p>}
      {draft && !draft.attendees.length && <p>{t("ยังไม่มีรายชื่อผู้ลงทะเบียน", "No attendees yet.")}</p>}
      {!!draft?.attendees.length && <>
        <input type="search" className={`${control} w-full sm:max-w-xs`} value={search} onChange={event => setSearch(event.target.value)}
          aria-label={t("ค้นหาผู้ลงทะเบียน", "Find an attendee")} placeholder={t("ค้นหาชื่อหรือเลขใบจอง", "Search name or booking reference")} />
        <div className="grid items-start gap-3 lg:grid-cols-2">
          {carpoolRoles.map(role => <section key={role} data-carpool-role={role} className="carpool-group min-w-0 rounded-xl border">
            <h3 className="carpool-group-heading rounded-t-xl px-3 py-2 font-semibold">{roleLabels[role]} · {groups[role].length}</h3>
            {groups[role].filter(matches).map(attendee => {
              const car = carByDriver.get(attendee.id) ?? { driverId: attendee.id, seats: 0, pickup: "", passengers: [] };
              return <div key={attendee.id} className="carpool-attendee space-y-2 border-t px-3 py-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  {attendeeLabel(attendee)}
                  {rolePicker(attendee, role)}
                </div>
                {role === "driver" && <>
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="flex items-center gap-2 text-xs">{t("ที่นั่งผู้โดยสาร", "Passenger seats")}
                      <select className={control} value={car.seats} disabled={busy}
                        onChange={event => changeCar({ ...car, seats: Number(event.target.value) })}>
                        {Array.from({ length: MAX_CARPOOL_SEATS + 1 - car.passengers.length }, (_, index) => index + car.passengers.length)
                          .map(seats => <option key={seats}>{seats}</option>)}
                      </select>
                    </label>
                    <span className="text-xs">{t(`ว่าง ${car.seats - car.passengers.length}`, `${car.seats - car.passengers.length} open`)}</span>
                    <input className={`${control} min-w-32 flex-1`} value={car.pickup} disabled={busy} maxLength={200}
                      onChange={event => changeCar({ ...car, pickup: event.target.value })}
                      aria-label={t("จุดนัดพบ", "Pickup point")} placeholder={t("จุดนัดพบ", "Pickup point")} />
                  </div>
                  {!!car.passengers.length && <ul className="flex flex-wrap gap-1.5">
                    {car.passengers.map(id => <li key={id}>
                      <button type="button" className={control} disabled={busy} onClick={() => assign(id, "")}
                        aria-label={t(`นำ ${byId.get(id)?.name} ออกจากรถ`, `Unassign ${byId.get(id)?.name}`)}>
                        {byId.get(id)?.name} ×
                      </button>
                    </li>)}
                  </ul>}
                </>}
                {role === "passenger" && <label className="flex flex-wrap items-center gap-2 text-xs">
                  {t("จัดขึ้นรถ", "Assign to car")}
                  <select className={`${control} min-w-0 max-w-full`} value={assignments.get(attendee.id) ?? ""} disabled={busy}
                    onChange={event => assign(attendee.id, event.target.value)}>
                    <option value="">{t("ยังไม่จัดรถ", "Unassigned")}</option>
                    {groups.driver.map(driver => {
                      const option = carByDriver.get(driver.id);
                      const available = option ? option.seats - option.passengers.length : 0;
                      return <option key={driver.id} value={driver.id} disabled={!available && assignments.get(attendee.id) !== driver.id}>
                        {driver.name} · {driver.reference} · {t(`ว่าง ${available}`, `${available} open`)}
                      </option>;
                    })}
                  </select>
                </label>}
              </div>;
            })}
            {!groups[role].some(matches) && <p className="carpool-attendee border-t px-3 py-2 text-sm opacity-75">
              {t("ไม่มีรายชื่อ", "No attendees")}
            </p>}
          </section>)}
        </div>
      </>}
    </div>}
  </section>;
}

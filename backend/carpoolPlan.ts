export const carpoolRoles = ["driver", "passenger", "independent", "unspecified"] as const;
export type CarpoolRole = typeof carpoolRoles[number];
export const MAX_CARPOOL_SEATS = 50;

export type CarpoolAttendee = {
  id: string;
  name: string;
  reference: string;
  bookingState: string;
  checkedIn: boolean;
  answer: string;
  defaultRole: CarpoolRole;
};

export type CarpoolCar = {
  driverId: string;
  kind?: "shared";
  label?: string;
  driverName?: string;
  departure?: string;
  note?: string;
  seats: number;
  pickup: string;
  passengers: string[];
};

export type CarpoolLayout = {
  roles: Record<string, CarpoolRole>;
  cars: CarpoolCar[];
};

export type PaidCarpoolPlan = CarpoolLayout & { version: number; attendees: CarpoolAttendee[] };
export type PaidCarpoolUpdate = CarpoolLayout & { version: number };

export function carpoolRoleFromAnswer(answer: string): CarpoolRole {
  if (/ไม่ต้องการ(?:รถ|ติดรถ)|เดินทางเอง|ไปเอง|รถส่วนตัว|self[ -]arranged|own transport|independent/i.test(answer)) return "independent";
  if (/ให้ติดรถ|รับผู้โดยสาร|offering seats|offer a ride/i.test(answer)) return "driver";
  if (/ไม่มีรถ|ติดรถ|อาศัยรถ|ขอรถ|ขอที่นั่ง|ต้องการ(?:รถ|ที่นั่ง)|need (?:a )?(?:ride|seat|transport)|passenger/i.test(answer)) return "passenger";
  if (/มีรถ|ขับรถ|\bdriver\b|can drive|have a car/i.test(answer)) return "driver";
  return "unspecified";
}

export function attendeeCarpoolRole(attendee: CarpoolAttendee, roles: CarpoolLayout["roles"]): CarpoolRole {
  return Object.hasOwn(roles, attendee.id) ? roles[attendee.id] : attendee.defaultRole;
}

function isId(value: unknown): value is string {
  return typeof value === "string" && /^[a-zA-Z0-9_-]{1,100}$/.test(value);
}

export function parseCarpoolUpdate(input: Record<string, unknown>): PaidCarpoolUpdate | null {
  const { version, roles, cars } = input;
  if (typeof version !== "number" || !Number.isSafeInteger(version) || version < 0 ||
      !roles || typeof roles !== "object" || Array.isArray(roles) ||
      !Array.isArray(cars) || cars.length > 10000) return null;
  const entries = Object.entries(roles);
  if (entries.length > 10000 || entries.some(([id, role]) => !isId(id) || !carpoolRoles.includes(role))) return null;
  const drivers = new Set<string>();
  const passengers = new Set<string>();
  const parsed: CarpoolCar[] = [];
  for (const car of cars) {
    if (!car || !isId(car.driverId) || drivers.has(car.driverId) ||
        !Number.isInteger(car.seats) || car.seats < 0 || car.seats > MAX_CARPOOL_SEATS ||
        typeof car.pickup !== "string" || car.pickup.length > 200 ||
        !Array.isArray(car.passengers) || car.passengers.length > car.seats) return null;
    if (car.kind !== undefined && car.kind !== "shared") return null;
    if (car.kind === "shared" && (!car.driverId.startsWith("shared-") || typeof car.label !== "string" || !car.label.trim())) return null;
    if (car.kind !== "shared" && car.driverId.startsWith("shared-")) return null;
    for (const [field,max] of [["label",120],["driverName",120],["departure",120],["note",1000]] as const) {
      if (car[field] !== undefined && (typeof car[field] !== "string" || car[field].length > max)) return null;
    }
    for (const id of car.passengers) {
      if (!isId(id) || id === car.driverId || passengers.has(id)) return null;
      passengers.add(id);
    }
    drivers.add(car.driverId);
    parsed.push({ driverId: car.driverId, seats: car.seats, pickup: car.pickup.trim(), passengers: car.passengers,
      ...(car.kind==="shared"?{kind:"shared" as const,label:car.label.trim(),driverName:(car.driverName||"").trim()}:{}),
      ...(car.departure?.trim()?{departure:car.departure.trim()}:{}),
      ...(car.note?.trim()?{note:car.note.trim()}:{}),
    });
  }
  return { version, roles: Object.fromEntries(entries), cars: parsed };
}

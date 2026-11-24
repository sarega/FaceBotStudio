export type RoomingGuest = {
  id: string;
  name: string;
  bookingId: string;
  bookingState: string;
  checkedIn: boolean;
  category: string;
  accommodation: "yes" | "unknown";
  preference: string;
  single: boolean;
  needsGuardianReview: boolean;
};

export const ROOM_BED_COUNTS = [1, 2, 3, 4] as const;
export const MAX_ROOM_BEDS = 50;

export function isRoomBedCount(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= MAX_ROOM_BEDS;
}

export type RoomingRoom = {
  id: string;
  number: string;
  locked: boolean;
  slots: (string | null)[];
};

export function moveRoomingGuest(rooms: RoomingRoom[], guestId: string, destination?: { roomId: string; slot: number }) {
  const source = rooms.find((room) => room.slots.includes(guestId));
  const target = destination && rooms.find((room) => room.id === destination.roomId);
  if (source?.locked || (destination && (!target || target.locked || destination.slot < 0 || destination.slot >= target.slots.length))) return rooms;
  const displaced = target && destination ? target.slots[destination.slot] : null;
  if (displaced === guestId) return rooms;
  return rooms.map(room => {
    if (room !== source && room !== target) return room;
    const slots = room.slots.map((id, index) => {
      if (room === target && index === destination?.slot) return guestId;
      return room === source && id === guestId ? displaced ?? null : id;
    });
    return { ...room, slots };
  });
}

export function draftRoomingPlan(rooms: RoomingRoom[], guests: RoomingGuest[], makeId: () => string): RoomingRoom[] {
  const assigned = new Set(rooms.flatMap((room) => room.slots));
  const familyBookings = new Set(guests.filter((guest) => guest.needsGuardianReview).map((guest) => guest.bookingId));
  const groups = new Map<string, RoomingGuest[]>();
  const additions: RoomingRoom[] = [];
  for (const guest of guests) {
    if (guest.bookingState === "expired" || guest.accommodation !== "yes" || familyBookings.has(guest.bookingId)) continue;
    if (guest.single) {
      if (!assigned.has(guest.id)) additions.push({ id: makeId(), number: "", locked: false, slots: [guest.id] });
      continue;
    }
    const group = groups.get(guest.bookingId) ?? [];
    group.push(guest);
    groups.set(guest.bookingId, group);
  }
  for (const group of groups.values()) {
    if (group.length === 2 && group.every((guest) => !assigned.has(guest.id))) {
      additions.push({ id: makeId(), number: "", locked: false, slots: group.map((guest) => guest.id) });
    }
  }
  return [...rooms, ...additions];
}

export function parseRoomingPlan(input: unknown): RoomingRoom[] | null {
  if (!Array.isArray(input) || input.length > 5000) return null;
  const ids = new Set<string>();
  const numbers = new Set<string>();
  const guests = new Set<string>();
  const result: RoomingRoom[] = [];
  for (const room of input) {
    if (!room || typeof room.id !== "string" || !/^[a-zA-Z0-9-]{1,64}$/.test(room.id) || ids.has(room.id) ||
        typeof room.number !== "string" || room.number.length > 40 || typeof room.locked !== "boolean" ||
        !Array.isArray(room.slots) || !isRoomBedCount(room.slots.length)) return null;
    const number = room.number.trim();
    const numberKey = number.toLowerCase();
    if (number && numbers.has(numberKey)) return null;
    for (const guest of room.slots) {
      if (guest === null) continue;
      if (typeof guest !== "string" || !guest || guest.length > 100 || guests.has(guest)) return null;
      guests.add(guest);
    }
    ids.add(room.id);
    if (number) numbers.add(numberKey);
    result.push({ id: room.id, number, locked: room.locked, slots: room.slots });
  }
  return result;
}

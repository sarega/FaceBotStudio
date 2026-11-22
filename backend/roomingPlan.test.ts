import assert from "node:assert/strict";
import test from "node:test";
import { draftRoomingPlan, moveRoomingGuest, parseRoomingPlan, type RoomingGuest, type RoomingRoom } from "./roomingPlan";

const room = (id: string, slots: (string | null)[], locked = false): RoomingRoom => ({ id, number: "", slots, locked });
const guest = (id: string, bookingId: string, accommodation: RoomingGuest["accommodation"] = "yes", single = false): RoomingGuest =>
  ({ id, bookingId, accommodation, single, name: id, category: "", preference: "", needsGuardianReview: false });

test("a drop swaps occupied beds, moves to an empty bed, and honours locks", () => {
  const rooms = [room("a", ["one", "two"]), room("b", ["three", null]), room("c", ["four"], true)];
  const swap = moveRoomingGuest(rooms, "one", { roomId: "b", slot: 0 });
  assert.deepEqual(swap.map(({ slots }) => slots), [["three", "two"], ["one", null], ["four"]]);
  assert.deepEqual(moveRoomingGuest(swap, "two", { roomId: "b", slot: 1 }).map(({ slots }) => slots),
    [["three", null], ["one", "two"], ["four"]]);
  assert.strictEqual(moveRoomingGuest(rooms, "four", { roomId: "b", slot: 1 }), rooms);
  assert.strictEqual(moveRoomingGuest(rooms, "three", { roomId: "c", slot: 0 }), rooms);
  assert.deepEqual(moveRoomingGuest(rooms, "unassigned", { roomId: "a", slot: 0 })[0].slots, ["unassigned", "two"]);
});

test("auto drafting uses the booking and requested accommodation and preserves existing rooms", () => {
  const existing = room("existing", ["locked"], true);
  const guests = [guest("one", "family"), guest("two", "family"), guest("three", "other"),
    guest("unknown", "family", "unknown"), guest("single", "other", "yes", true), guest("locked", "separate"),
    guest("guardian", "child-booking"), { ...guest("child", "child-booking"), needsGuardianReview: true }];
  let i = 0;
  const drafted = draftRoomingPlan([existing], guests, () => `new-${++i}`);
  assert.deepEqual(drafted.map(({ slots }) => slots), [["locked"], ["single"], ["one", "two"]]);
  assert.deepEqual(draftRoomingPlan(drafted, guests, () => `new-${++i}`), drafted);
});

test("a saved plan rejects duplicate assignments, duplicate room numbers and a third bed", () => {
  assert.equal(parseRoomingPlan([room("a", ["one"]), room("b", ["one"])]), null);
  assert.equal(parseRoomingPlan([room("a", ["one", "two", null])]), null);
  assert.equal(parseRoomingPlan([{ ...room("a", [null]), number: " 101 " }, { ...room("b", [null]), number: "101" }]), null);
});

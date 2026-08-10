import assert from "node:assert/strict";
import test from "node:test";

import { buildCheckoutPriceOptions, isSellableCheckoutSeat } from "./checkoutSelection";

test("checkout options expose only priced, allocated, available seats for the selected performance", () => {
  const seats = [
    { performance_id: "matinee", zone: "ZONE 5", section_label: "Premium", ticket_class: "Premium", face_value: 1500, status: "available", allocation_status: "allocated" },
    { performance_id: "matinee", zone: "ZONE 5", section_label: "Premium", ticket_class: "Premium", face_value: 1500, status: "issued", allocation_status: "allocated" },
    { performance_id: "matinee", zone: "ZONE 4", section_label: null, face_value: null, status: "available", allocation_status: "allocated" },
    { performance_id: "matinee", zone: "ZONE 3", section_label: null, ticket_class: "Standard", face_value: 800, status: "available", allocation_status: "not_allocated" },
    { performance_id: "evening", zone: "ZONE 5", section_label: "Premium", ticket_class: "Premium", face_value: 1500, status: "available", allocation_status: "allocated" },
    { performance_id: "matinee", zone: "ZONE 2", section_label: null, ticket_class: "Standard Plus", face_value: 1000, status: "available", allocation_status: "allocated" },
    { performance_id: "matinee", zone: "BOX", section_label: null, ticket_class: "Sponsor", face_value: 1000, status: "available", allocation_status: "allocated" },
  ];

  assert.deepEqual(buildCheckoutPriceOptions(seats, "matinee"), [
    { ticketClass: "Premium", price: 1500, seatCount: 1, zones: ["ZONE 5 · Premium"] },
    { ticketClass: "Sponsor", price: 1000, seatCount: 1, zones: ["BOX"] },
    { ticketClass: "Standard Plus", price: 1000, seatCount: 1, zones: ["ZONE 2"] },
  ]);
  assert.equal(isSellableCheckoutSeat(seats[0], "matinee", 1500, "Premium"), true);
  assert.equal(isSellableCheckoutSeat(seats[4], "matinee", 1500, "Premium"), false);
});

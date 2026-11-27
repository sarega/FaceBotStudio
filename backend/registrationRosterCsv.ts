import { Parser } from "json2csv";
import { isValidCustomerEmail, isValidCustomerPhone, normalizeCustomerEmail, normalizeCustomerPhone } from "./customerAuth";
import type { PaidRow } from "./db/paidRegistration";
import type { RegistrationRow } from "./db/types";
import type { RosterCsvKind } from "../src/lib/registrationReportKinds";

const states = {
  "checked-in": [6, "เช็กอินแล้ว", "Checked in"],
  confirmed: [5, "ยืนยันแล้ว", "Confirmed"],
  registered: [4, "ลงทะเบียนแล้ว", "Registered"],
  verification_pending: [3, "รอตรวจสลิป", "Slip under review"],
  payment_exception: [2, "ต้องตรวจสอบการชำระ", "Payment needs review"],
  awaiting_payment: [1, "รอชำระ", "Awaiting payment"],
} as const;

type Candidate = {
  state: keyof typeof states;
  paid: boolean;
  updated: number;
  flagged: boolean;
  keys: string[];
  cells: string[];
  booking?: PaidRow;
};

type RosterAmounts = {
  total: number;
  received: number;
  review: number;
  outstanding: number;
};

export const rosterAmountLabels = {
  th: ["ยอดตามใบจอง (บาท)", "ตรวจยืนยันแล้ว (บาท)", "ยอดสลิปรอตรวจ (บาท)", "คงค้างรวมรอตรวจ (บาท)"],
  en: ["Booking value (THB)", "Verified payments (THB)", "Slips under review (THB)", "Outstanding incl. review (THB)"],
} as const;

const amountCells = (amounts: RosterAmounts) =>
  [amounts.total, amounts.received, amounts.review, amounts.outstanding].map(minor => (minor / 100).toFixed(2));

const text = (value: unknown) => String(value ?? "").trim();
const firstValue = (...values: unknown[]) => values.map(text).find(Boolean) ?? "";

function identityKeys(first: unknown, last: unknown, email: string, phone: string, bookingAccount = "") {
  const name = [text(first), text(last)].filter(Boolean).join(" ").normalize("NFC").replace(/\s+/g, " ").toLowerCase();
  if (!name) return [];
  return [
    ...(isValidCustomerEmail(email) ? [JSON.stringify([name, "email", normalizeCustomerEmail(email)])] : []),
    ...(isValidCustomerPhone(phone) ? [JSON.stringify([name, "phone", normalizeCustomerPhone(phone)])] : []),
    ...(bookingAccount ? [JSON.stringify([name, "account", bookingAccount])] : []),
  ];
}

export function buildRegistrationRoster(
  legacy: RegistrationRow[], paid: PaidRow[], kind: RosterCsvKind, language: "th" | "en",
) {
  const candidates: Candidate[] = [];
  const statusLabel = (state: Candidate["state"]) => states[state][language === "th" ? 1 : 2];
  for (const row of legacy) {
    if (row.status !== "registered" && row.status !== "checked-in") continue;
    const email = text(row.email);
    const phone = text(row.phone);
    candidates.push({
      state: row.status, updated: Date.parse(row.timestamp) || 0, paid: false, flagged: false,
      keys: identityKeys(row.first_name, row.last_name, email, phone),
      cells: [text(row.first_name), text(row.last_name), statusLabel(row.status),
        language === "th" ? "ลงทะเบียนทั่วไป" : "General registration", "", "", phone, email],
    });
  }
  for (const row of paid) {
    const bookingState = row.booking_state;
    if ((bookingState !== "confirmed" && bookingState !== "awaiting_payment" &&
        bookingState !== "verification_pending" && bookingState !== "payment_exception") ||
        row.cancelled_ms != null || row.payment_state === "refunded") continue;
    const state = row.checked_in_ms == null ? bookingState : "checked-in";
    const personalEmail = text(row.attendee_email);
    const personalPhone = text(row.attendee_phone);
    const email = firstValue(personalEmail, row.booking_email, row.customer_email);
    const phone = firstValue(personalPhone, row.booking_phone, row.customer_phone);
    const hasPersonalContact = isValidCustomerEmail(personalEmail) || isValidCustomerPhone(personalPhone);
    const food = firstValue((row.answers as PaidRow | undefined)?.food, (row.booking_answers as PaidRow | undefined)?.food);
    const price = row.unit_minor == null ? NaN : Number(row.unit_minor);
    candidates.push({
      state, updated: Number(row.booked_ms) || 0, paid: true, flagged: row.price_flagged === true || row.price_flagged === 1,
      booking: row,
      keys: hasPersonalContact
        ? identityKeys(row.first_name, row.last_name, personalEmail, personalPhone)
        : identityKeys(row.first_name, row.last_name, email, phone, text(row.customer_id)),
      cells: [text(row.first_name), text(row.last_name), statusLabel(state), text(row.category_label),
        Number.isFinite(price) ? (price / 100).toFixed(2) : "", food, personalPhone, personalEmail],
    });
  }

  candidates.sort((a, b) => states[b.state][0] - states[a.state][0] ||
    Number(b.paid) - Number(a.paid) || b.updated - a.updated);
  const seen = new Set<string>();
  const rows: string[][] = [];
  const financialRows: string[][] = [];
  const includedBookings = new Map<string, number>();
  const bookingSizes = new Map<string, number>();
  const totals: RosterAmounts = { total: 0, received: 0, review: 0, outstanding: 0 };
  for (const row of paid) {
    if (row.booking_id && row.cancelled_ms == null && row.booking_state !== "cancelled") {
      const id = text(row.booking_id);
      bookingSizes.set(id, (bookingSizes.get(id) ?? 0) + 1);
    }
  }
  for (const row of candidates) {
    if (row.keys.some(key => seen.has(key))) continue;
    // Pick a single current record before applying filters, so a duplicate
    // pending or older unflagged record cannot reappear in another export.
    for (const key of row.keys) seen.add(key);
    const confirmed = states[row.state][0] >= states.registered[0];
    if (row.flagged || kind === "confirmed" && !confirmed || kind === "pending" && confirmed) continue;
    rows.push(row.cells);
    const id = text(row.booking?.booking_id);
    let money = ["", "", "", ""];
    if (id && row.booking) {
      const included = includedBookings.get(id) ?? 0;
      includedBookings.set(id, included + 1);
      if (included === 0) {
        const total = Math.max(0, Number(row.booking.booking_total_minor) || 0);
        const received = Math.min(total, Math.max(0, Number(row.booking.verified_cash_minor) || 0));
        const review = Math.max(0, Number(row.booking.pending_slip_minor) || 0);
        const amounts = { total, received, review, outstanding: total - received };
        totals.total += amounts.total;
        totals.received += amounts.received;
        totals.review += amounts.review;
        totals.outstanding += amounts.outstanding;
        money = amountCells(amounts);
      }
    }
    financialRows.push([...row.cells, ...money]);
  }

  const fields = language === "th"
    ? ["ชื่อ", "นามสกุล", "สถานะ", "ประเภทบัตร", "ราคาต่อคน (บาท)", "อาหาร", "โทรศัพท์", "อีเมล"]
    : ["First name", "Last name", "Status", "Ticket category", "Price per attendee (THB)", "Meal", "Phone", "Email"];
  const partialBookings = [...includedBookings].filter(([id, count]) => count < (bookingSizes.get(id) ?? count)).length;
  return { fields, rows, financialRows, totals, bookingCount: includedBookings.size, partialBookings };
}

export function buildRegistrationRosterCsv(
  legacy: RegistrationRow[], paid: PaidRow[], kind: RosterCsvKind, language: "th" | "en",
) {
  const { fields, rows, financialRows, totals, bookingCount, partialBookings } = buildRegistrationRoster(legacy, paid, kind, language);
  const exportFields = [...fields, ...rosterAmountLabels[language]];
  const records = financialRows.map(cells => Object.fromEntries(exportFields.map((field, index) => {
    const value = cells[index];
    return [field, /^\s*[=+@-]/.test(value) ? "'" + value : value];
  })));
  if (bookingCount) {
    const label = language === "th" ? "รวมยอดใบจอง" : "Booking totals";
    const detail = language === "th"
      ? `${bookingCount} ใบจอง${partialBookings ? ` (มี ${partialBookings} ใบจองที่แสดงรายชื่อบางส่วน ยอดเป็นของทั้งใบจอง)` : ""}`
      : `${bookingCount} bookings${partialBookings ? ` (${partialBookings} partially listed; amounts cover the whole booking)` : ""}`;
    const summary = [label, "", detail, "", "", "", "", "", ...amountCells(totals)];
    records.push(Object.fromEntries(exportFields.map((field, index) => [field, summary[index]])));
  }
  return { csv: "\uFEFF" + new Parser({ fields: exportFields }).parse(records), count: rows.length };
}

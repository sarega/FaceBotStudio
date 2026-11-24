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
};

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

export function buildRegistrationRosterCsv(
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
      keys: hasPersonalContact
        ? identityKeys(row.first_name, row.last_name, personalEmail, personalPhone)
        : identityKeys(row.first_name, row.last_name, email, phone, text(row.customer_id)),
      cells: [text(row.first_name), text(row.last_name), statusLabel(state), text(row.category_label),
        Number.isFinite(price) ? (price / 100).toFixed(2) : "", food, phone, email],
    });
  }

  candidates.sort((a, b) => states[b.state][0] - states[a.state][0] ||
    Number(b.paid) - Number(a.paid) || b.updated - a.updated);
  const seen = new Set<string>();
  const rows: string[][] = [];
  for (const row of candidates) {
    if (row.keys.some(key => seen.has(key))) continue;
    // Pick a single current record before applying filters, so a duplicate
    // pending or older unflagged record cannot reappear in another export.
    for (const key of row.keys) seen.add(key);
    const confirmed = states[row.state][0] >= states.registered[0];
    if (row.flagged || kind === "confirmed" && !confirmed || kind === "pending" && confirmed) continue;
    rows.push(row.cells);
  }

  const fields = language === "th"
    ? ["ชื่อ", "นามสกุล", "สถานะ", "ประเภทบัตร", "ราคาต่อคน (บาท)", "อาหาร", "โทรศัพท์", "อีเมล"]
    : ["First name", "Last name", "Status", "Ticket category", "Price per attendee (THB)", "Meal", "Phone", "Email"];
  const records = rows.map(cells => Object.fromEntries(fields.map((field, index) => {
    const value = cells[index];
    return [field, /^\s*[=+@-]/.test(value) ? "'" + value : value];
  })));
  return { csv: "\uFEFF" + new Parser({ fields }).parse(records), count: rows.length };
}

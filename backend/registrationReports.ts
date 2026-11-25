import { registrationReportTitles, type ReportKind } from "../src/lib/registrationReportKinds";
import type { PaidRow } from "./db/paidRegistration";
import type { RegistrationRow } from "./db/types";
import { buildRegistrationRoster } from "./registrationRosterCsv";

type Language = "th" | "en";
type Copy = readonly [string, string];

type Booking = { row: PaidRow; people: PaidRow[] };
const number = (value: unknown) => Number(value ?? 0);
const text = (value: unknown) => String(value ?? "").trim();
const fullName = (first: unknown, last: unknown) => [text(first), text(last)].filter(Boolean).join(" ");
const cancelled = (row: PaidRow) => row.cancelled_ms != null;
const vip = (row: PaidRow) =>
  /(?:^|[^a-z])(?:vip|complimentary|invited guest)(?:$|[^a-z])|แขก(?:รับเชิญ|วีไอพี|พิเศษ)/iu.test(
    [row.category_id, row.category_label].map(text).join(" "),
  );

export function buildRegistrationReportHtml({
  kind, language, eventName, generatedAt, paid, legacy, fontCss, escape,
}: {
  kind: ReportKind; language: Language; eventName: string; generatedAt: number;
  paid: PaidRow[]; legacy: RegistrationRow[]; fontCss: string; escape: (value: unknown) => string;
}) {
  const t = (copy: Copy) => copy[language === "th" ? 0 : 1];
  const locale = language === "th" ? "th-TH" : "en-GB";
  const currency = new Intl.NumberFormat(locale, { style: "currency", currency: "THB" });
  const clock = new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Bangkok" });
  const money = (minor: number) => currency.format(minor / 100);
  const date = (ms: unknown) => number(ms) > 0 ? clock.format(number(ms)) : "—";
  const cell = (...lines: unknown[]) => lines.map(text).filter(Boolean).map(escape).join("<br>") || "—";
  const table = (head: Copy[], rows: string[][]) => rows.length
    ? `<table><thead><tr>${head.map(label => `<th>${escape(t(label))}</th>`).join("")}</tr></thead><tbody>${
      rows.map(row => `<tr>${row.map(value => `<td>${value}</td>`).join("")}</tr>`).join("")
    }</tbody></table>`
    : `<p class="empty">${t(["ไม่มีรายการในหมวดนี้", "No matching records"])}</p>`;
  const section = (title: Copy, detail: string, content: string) =>
    `<section><h2>${escape(t(title))}</h2>${detail ? `<p>${escape(detail)}</p>` : ""}${content}</section>`;

  const byId = new Map<string, Booking>();
  for (const row of paid) {
    const id = text(row.booking_id);
    const booking = byId.get(id) ?? { row, people: [] };
    if (!cancelled(row)) booking.people.push(row);
    byId.set(id, booking);
  }
  const bookings = [...byId.values()];
  const active = (row: PaidRow) => !["cancelled", "expired"].includes(text(row.report_booking_state ?? row.booking_state));
  const cash = (row: PaidRow) => number(row.verified_cash_minor);
  const due = (row: PaidRow) => Math.max(0, number(row.booking_total_minor) - cash(row));
  const name = (row: PaidRow) => fullName(row.first_name, row.last_name);
  const customer = (row: PaidRow) => fullName(row.customer_first_name, row.customer_last_name) || text(row.customer_email);
  const confirmation = (state: unknown) => state === "confirmed"
    ? t(["ยืนยันแล้ว", "Confirmed"]) : state === "cancelled" ? t(["ยกเลิก", "Cancelled"])
      : state === "expired" ? t(["หมดอายุ", "Expired"]) : t(["รอยืนยัน", "Not confirmed"]);
  const paymentGroups = {
    pending: ["ส่งสลิปรอตรวจ", "Slip awaiting review"],
    rejected: ["สลิปไม่ผ่าน", "Slip rejected"],
    balance: ["ค้างส่วนต่าง", "Additional amount due"],
    unpaid: ["ยังไม่มีสลิป", "Awaiting payment / no slip"],
    exception: ["ต้องตรวจสอบ", "Needs review"],
    expired: ["เกินกำหนด", "Expired"],
  } as const;
  type PaymentGroup = keyof typeof paymentGroups;
  const paymentGroup = (row: PaidRow): PaymentGroup | undefined => {
    if (row.report_booking_state === "cancelled") return;
    if (row.report_booking_state === "expired") return "expired";
    if (row.payment_state === "underpaid" || row.report_booking_state === "payment_exception") return "exception";
    if (number(row.report_pending_proofs) > 0) return "pending";
    if (row.report_booking_state === "verification_pending") return "exception";
    if (row.payment_state === "rejected") return "rejected";
    if (!due(row)) return;
    return row.report_booking_state === "confirmed" || cash(row) > 0 ? "balance" : "unpaid";
  };
  const payment = (row: PaidRow) => {
    if (row.payment_state === "refunded") return t(["บันทึกคืนเงินแล้ว", "Refunded"]);
    if (row.report_booking_state === "cancelled") return t(["ปิดรายการ", "Closed"]);
    const group = paymentGroup(row);
    if (group) return t(paymentGroups[group]);
    if (number(row.booking_total_minor) === 0 && cash(row) === 0) return t(["ไม่มียอดเรียกเก็บเงิน", "No cash due"]);
    return t(["ตรวจรับยอดแล้ว", "Payment verified"]);
  };
  const labels = {
    reference: ["เลขใบจอง", "Booking reference"],
    customer: ["ผู้จอง / ผู้เข้าร่วม", "Booker / attendees"],
    registered: ["สถานะการเข้าร่วม", "Registration status"],
    payment: ["สถานะการเงิน", "Payment status"],
    person: ["ผู้เข้าร่วม", "Attendee"],
    category: ["ประเภทบัตร", "Ticket category"],
    outstanding: ["ค้างสุทธิ", "Outstanding"],
    coupon: ["ส่วนลดคูปอง", "Coupon discount"],
  } as const;

  let body: string;
  if (kind === "active_roster") {
    const { fields, rows, totals, bookingCount, partialBookings } = buildRegistrationRoster(legacy, paid, "active", language);
    body = `<div class="totals roster-totals">${[
      [t(["ยอดรวมตามใบจอง", "Total booking value"]), money(totals.total)],
      [t(["ตรวจยืนยันแล้ว", "Verified payments"]), money(totals.received)],
      [t(["ยอดตามสลิปรอตรวจ", "Slips under review"]), money(totals.review)],
      [t(["ยอดคงค้างทั้งหมด", "Total outstanding"]), money(totals.outstanding)],
    ].map(([label, value]) => `<div>${escape(label)}<strong>${escape(value)}</strong></div>`).join("")}</div>` +
      `<p>${escape(t(["คำนวณจากใบจองในรายชื่อนี้ โดยนับแต่ละใบจองครั้งเดียว ยอดคงค้างรวมสลิปที่ยังไม่ได้ยืนยัน",
        "Amounts cover bookings in this roster, counted once per booking. Outstanding includes unverified slips."]))} · ${bookingCount} ${t(["ใบจอง", "bookings"])}</p>` +
      (partialBookings ? `<p>${escape(t([
        `${partialBookings} ใบจองแสดงรายชื่อเพียงบางคน ยอดเงินเป็นของทั้งใบจองเนื่องจากชำระเงินร่วมกัน`,
        `${partialBookings} bookings have only some attendees listed; payment amounts cover the whole booking.`,
      ]))}</p>` : "") + section(
      ["รายชื่อผู้เข้าร่วมที่ยังมีใบจอง", "Active attendee roster"],
      `${rows.length} ${t(["คน · รวมยืนยันแล้ว รอชำระ และรอตรวจ", "attendees · confirmed, awaiting payment and under review"])}`,
      table(fields.map(field => [field, field]), rows.map(row => row.map(value => cell(value)))),
    );
  } else if (kind === "accounting") {
    const sum = (read: (row: PaidRow) => number) => bookings.reduce((total, item) => total + read(item.row), 0);
    const discount = (row: PaidRow) => number(row.coupon_discount_minor);
    const credit = (row: PaidRow) => number(row.credit_used_minor);
    const refund = (row: PaidRow) => number(row.refunded_minor);
    const subtotal = (row: PaidRow) => number(row.booking_total_minor) + discount(row) + credit(row);
    const issuedCredit = (row: PaidRow) => number(row.credit_issued_minor);
    body = `<div class="totals">${[
      [t(["ใบจองทั้งหมด", "Bookings"]), bookings.length],
      [t(["ส่วนลดคูปอง", "Coupon discounts"]), money(sum(discount))],
      [t(["เครดิตที่ใช้", "Credits used"]), money(sum(credit))],
      [t(["ยอดรับที่ตรวจแล้ว", "Verified receipts"]), money(sum(cash))],
      [t(["บันทึกคืนเงิน", "Recorded refunds"]), money(sum(refund))],
      [t(["ยอดรับหลังคืนเงิน", "Receipts after refunds"]), money(sum(cash) - sum(refund))],
      [t(["เครดิตที่ออก", "Credits issued"]), money(sum(issuedCredit))],
      [t(["ค้างสุทธิ (ใบจองที่ยังมีผล)", "Outstanding (active bookings)"]), money(sum(row => active(row) ? due(row) : 0))],
    ].map(([label, value]) => `<div>${escape(label)}<strong>${escape(value)}</strong></div>`).join("")}</div>` +
      table([labels.reference, labels.customer, labels.registered, labels.payment, ["ก่อนคูปองและเครดิต", "Before coupon & credit"], labels.coupon,
        ["เครดิตที่ใช้", "Credit used"], ["ยอดเรียกเก็บ", "Cash due"], ["รับแล้ว / คืนแล้ว", "Received / refunded"], labels.outstanding],
      bookings.map(({ row, people }) => [
        cell(row.booking_reference), cell(customer(row), ...people.map(name)), cell(confirmation(row.report_booking_state)), cell(payment(row)),
        cell(money(subtotal(row))), cell(money(discount(row))), cell(money(credit(row))), cell(money(number(row.booking_total_minor))),
        cell(money(cash(row)), money(refund(row))), cell(active(row) ? money(due(row)) : "—"),
      ]));
  } else if (kind === "followup") {
    body = (Object.entries(paymentGroups) as [PaymentGroup, Copy][]).map(([key, label]) => {
      const matches = bookings.filter(({ row }) => paymentGroup(row) === key);
      const total = matches.reduce((sum, { row }) => sum + due(row), 0);
      return section(label, `${matches.length} ${t(["ใบจอง", "bookings"])} · ${t(key === "expired"
        ? ["ยอดตามใบจองที่หมดอายุ", "Unpaid amount on expired holds"] : ["ยอดค้าง", "Outstanding"])} ${money(total)}`,
        table([labels.reference, labels.customer, labels.registered, ["ติดต่อผู้จอง / ผู้เข้าร่วม", "Booker / attendee contact"], ["กำหนดชำระ", "Payment deadline"], labels.outstanding],
          matches.map(({ row, people }) => [
            cell(row.booking_reference), cell(customer(row), ...people.map(name)), cell(confirmation(row.report_booking_state)),
            cell(row.customer_phone, row.customer_email, ...people.filter(person => text(person.attendee_phone))
              .map(person => `${name(person)} · ${text(person.attendee_phone)}`)), cell(date(row.due_ms)), cell(money(due(row))),
          ])));
    }).join("");
  } else if (kind === "coupons") {
    const matches = bookings.filter(({ row, people }) => text(row.coupon_code) || people.some(vip));
    const discount = matches.reduce((sum, { row }) => sum + number(row.coupon_discount_minor), 0);
    body = section(registrationReportTitles.coupons,
      `${matches.length} ${t(["ใบจอง", "bookings"])} · ${t(["ส่วนลดคูปองตามใบจอง", "Recorded booking-level discounts"])} ${money(discount)}`,
      table([labels.reference, ["ผู้จอง", "Booker"], ["ผู้เข้าร่วมและประเภทบัตร", "Attendees & ticket categories"],
        ["คูปองระดับใบจอง", "Booking-level coupon"], ["ก่อนคูปองและเครดิต", "Before coupon & credit"], labels.coupon,
        ["ยอดเรียกเก็บ / รับแล้ว", "Cash due / received"], labels.outstanding, labels.registered],
      matches.map(({ row, people }) => [
        cell(row.booking_reference), cell(customer(row)), cell(...people.map(person =>
          [name(person), text(person.category_label), vip(person) ? "VIP" : ""].filter(Boolean).join(" · "),
        )), cell(row.coupon_code), cell(money(number(row.booking_total_minor) + number(row.coupon_discount_minor) + number(row.credit_used_minor))),
        cell(row.coupon_code ? money(number(row.coupon_discount_minor)) : "—"),
        cell(money(number(row.booking_total_minor)), money(cash(row))), cell(active(row) ? money(due(row)) : "—"), cell(confirmation(row.report_booking_state)),
      ]))) + `<p>${t(["คูปองใช้กับทั้งใบจอง รายชื่อแสดงผู้ร่วมใบจอง ไม่มีการเฉลี่ยส่วนลดอัตโนมัติ แขก VIP อ้างอิงประเภทบัตรที่บันทึกไว้",
        "Coupons apply at booking level. The report lists booking members without allocating the discount. VIP is based on the recorded ticket category."])}</p>`;
  } else {
    const meal = (row: PaidRow) => {
      const value = text((row.answers as Record<string, unknown> | undefined)?.food ||
        (row.booking_answers as Record<string, unknown> | undefined)?.food);
      if (!value) return t(["ยังไม่ระบุ", "Unspecified"]);
      if (/non[ -]?vegetarian|ไม่มังสวิรัติ/i.test(value)) return t(["ไม่มังสวิรัติ", "Non-vegetarian"]);
      if (/^(?:vegetarian|มังสวิรัติ)(?:\s*\/|$)/i.test(value)) return t(["มังสวิรัติ", "Vegetarian"]);
      return value;
    };
    const mealSection = (title: Copy, rows: { cells: string[]; food: string }[]) => {
      const mealCounts = new Map<string, number>();
      for (const { food } of rows) mealCounts.set(food, (mealCounts.get(food) ?? 0) + 1);
      const totals = [...mealCounts].map(([food, count]) => `${food} ${count}`).join(" · ");
      return section(title, `${rows.length} ${t(["คน", "attendees"])}${totals ? ` · ${totals}` : ""}`,
        table([labels.person, labels.category, ["อาหาร", "Meal"], labels.reference], rows.map(row => row.cells)));
    };
    const rows = paid.filter(row => !cancelled(row) && active(row));
    const mapRow = (row: PaidRow) => ({ food: meal(row), cells: [cell(name(row)), cell(row.category_label), cell(meal(row)), cell(row.booking_reference)] });
    body = mealSection(["ยืนยันแล้ว / ลงทะเบียนแล้ว", "Confirmed / registered"], [
      ...rows.filter(row => row.booking_state === "confirmed").map(mapRow),
      ...legacy.filter(row => row.status === "registered" || row.status === "checked-in").map(row => ({
        food: t(["ยังไม่ระบุ", "Unspecified"]),
        cells: [cell(fullName(row.first_name, row.last_name)), cell(t(["ลงทะเบียนทั่วไป", "General registration"])), cell(t(["ยังไม่ระบุ", "Unspecified"])), cell(row.id)],
      })),
    ]) + mealSection(["ยังรอยืนยัน", "Not yet confirmed"], rows.filter(row => row.booking_state !== "confirmed").map(mapRow));
  }

  return `<!doctype html><html lang="${language}"><meta charset="utf-8"><style>
    ${fontCss}
    @page { size: A4 landscape; margin: 13mm; }
    body { font: 11px "Noto Sans Thai", sans-serif; color: #17253a; }
    header { border-bottom: 3px solid #255a91; padding-bottom: 9px; margin-bottom: 14px; }
    h1 { font-size: 22px; margin: 0; } h2 { font-size: 15px; margin: 12px 0 4px; break-after: avoid; }
    p { margin: 5px 0; } table { width: 100%; border-collapse: collapse; margin: 6px 0 14px; table-layout: fixed; }
    th,td { border-bottom: 1px solid #cbd5e1; text-align: left; vertical-align: top; padding: 6px; overflow-wrap: anywhere; }
    th { background: #e4edf7; } tbody tr:nth-child(even) { background: #f4f7fb; }
    tr { break-inside: avoid; } .empty { color: #516079; }
    .totals { display: grid; grid-template-columns: repeat(3, 1fr); gap: 7px; margin-bottom: 12px; }
    .roster-totals { grid-template-columns: repeat(4, 1fr); }
    .totals div { background: #edf3fa; padding: 6px 9px; } .totals strong { display: block; font-size: 15px; }
  </style><header><h1>${escape(t(registrationReportTitles[kind]))}</h1>
    <p>${escape(eventName)}</p><p>${t(["ขอบเขตทั้งอีเวนต์", "Scope: entire event"])} · ${escape(date(generatedAt))} (ICT)</p></header>${body}</html>`;
}

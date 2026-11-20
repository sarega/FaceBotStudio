import { applyCoupon, recordCouponRedemption } from "./paidCoupons";
import { getEffectiveEventStatus, getEventState } from "../datetime";
import { decryptPaidProof, encryptPaidProof, paidProofEncryptionConfigured } from "../paidProofEncryption";
import { roomSurchargeMinor, isEditableSeminarKey, type EditableSeminarKey, normalizePaidSeminarAnswers, parsePaidSeminarFields, type PaidSeminarField } from "../paidSeminarFields";
import { createHash, randomUUID } from "node:crypto";

export type PaidSql = { sql: string; params: (string | number | Buffer | null)[] };
export type PaidRow = Record<string, unknown>;
export type PaidCommand<T> = Generator<PaidSql, T, PaidRow[]>;

export interface PaidBookingInput {
  eventId: string;
  customerId: string;
  key: string;
  pricingVersion: number;
  receiver?: { id: string; name: string; profileVersion: number };
  contact: { name: string; email?: string; phone?: string };
  answers?: unknown;
  couponCode?: string;
  attendees: { categoryId: string; firstName: string; lastName: string; email?: string; phone?: string; answers?: unknown }[];
}

export interface PaidBookingReceipt {
  id: string;
  reference: string;
  state: "awaiting_payment" | "confirmed";
  currency: "THB";
  totalMinor: number;
  dueMs: number;
  version: number;
  subtotalMinor?: number;
  discountMinor?: number;
  couponCode?: string | null;
}

export class PaidBookingError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

function query(sql: string, ...params: PaidSql["params"]): PaidSql {
  return { sql, params };
}

function audit(eventId: string, id: string, actor: string, action: string, previous: string | null, next: string, now: number) {
  return query(
    "INSERT INTO paid_audit_events (id,event_id,booking_id,actor,action,previous_state,next_state,occurred_ms) VALUES (?,?,?,?,?,?,?,?)",
    randomUUID(), eventId, id, actor, action, previous, next, now,
  );
}

function* paidEnrollmentOpen(eventId: string, now: number): PaidCommand<boolean> {
  const [event] = yield query("SELECT status FROM events WHERE id=?", eventId);
  if (!event) return false;
  const rows = yield query(
    "SELECT key,value FROM event_settings WHERE event_id=? AND key IN ('reg_start','reg_end','event_timezone','event_date','event_end_date')",
    eventId,
  );
  const settings = Object.fromEntries(rows.map(({ key, value }) => [String(key), String(value ?? "")]));
  const instant = new Date(now);
  const window = getEventState(settings, instant);
  return window.registrationStatus === "open" && window.eventScheduleStatus === "valid" &&
    getEffectiveEventStatus(String(event.status), settings, instant) === "active";
}

export function* createPaidBooking(eventId: string, organizationId: string, input: PaidBookingInput): PaidCommand<PaidBookingReceipt> {
  const { customerId, key, pricingVersion, contact, attendees } = input;
  if (!key || key.length > 128 || !contact.name.trim() || !attendees.length ||
      attendees.some(({ firstName, lastName }) => !firstName.trim() || !lastName.trim())) {
    throw new PaidBookingError("invalid_booking");
  }
  const canonical = (answers: unknown) =>
    answers && typeof answers === "object" && !Array.isArray(answers)
      ? Object.entries(answers).sort(([a], [b]) => a.localeCompare(b)) : answers;
  const hasAnswers = (answers: unknown) => answers !== undefined &&
    (typeof answers !== "object" || answers === null || Array.isArray(answers) || Object.keys(answers).length > 0);
  const digestData = hasAnswers(input.answers) || attendees.some(({ answers }) => hasAnswers(answers))
    ? [pricingVersion, [contact.name, contact.email, contact.phone], canonical(input.answers),
      attendees.map(({ categoryId, firstName, lastName, email, phone, answers }) => [categoryId, firstName, lastName, email, phone, canonical(answers)])]
    : [pricingVersion, [contact.name, contact.email, contact.phone],
      attendees.map(({ categoryId, firstName, lastName, email, phone }) => [categoryId, firstName, lastName, email, phone])];
  if (input.couponCode) digestData.push(input.couponCode.trim().toUpperCase());
  const digest = createHash("sha256").update(JSON.stringify(digestData)).digest("hex");
  const [replay] = yield query(
    "SELECT digest,result_json FROM paid_command_keys WHERE principal=? AND event_id=? AND operation='create' AND command_key=?",
    customerId, eventId, key,
  );
  if (replay) {
    const previousFormat = createHash("sha256").update(JSON.stringify([
      pricingVersion, [contact.name, contact.email, contact.phone], canonical(input.answers),
      attendees.map(({ categoryId, firstName, lastName, email, phone, answers }) => [categoryId, firstName, lastName, email, phone, canonical(answers)]),
    ])).digest("hex");
    if (replay.digest !== digest && replay.digest !== previousFormat) throw new PaidBookingError("idempotency_conflict");
    return JSON.parse(String(replay.result_json)) as PaidBookingReceipt;
  }
  const receiver = input.receiver;
  const [settings] = yield query("SELECT * FROM paid_event_settings WHERE event_id=? AND published=1", eventId);
  if (!settings) throw new PaidBookingError("registration_unavailable");
  if (settings.payment_mode !== "external_manual" &&
      (!receiver || !/^(?:[0-9]{10}|[0-9]{13}|[0-9]{15})$/.test(receiver.id) ||
       !Number.isSafeInteger(receiver.profileVersion) || receiver.profileVersion < 1)) {
    throw new PaidBookingError("payment_profile_unavailable");
  }
  if (Number(settings.version) !== pricingVersion) throw new PaidBookingError("quote_stale");

  const fields = yield* readPaidSeminarForm(eventId);
  const bookingAnswers = normalizePaidSeminarAnswers(fields, "booking", input.answers);
  if (!bookingAnswers) throw new PaidBookingError("invalid_seminar_answers");
  const now = Date.now();
  if (!(yield* paidEnrollmentOpen(eventId, now))) throw new PaidBookingError("registration_unavailable");
  const dueMs = resolvePaidDeadline(settings, now);
  if (!Number.isSafeInteger(dueMs) || dueMs <= now) throw new PaidBookingError("registration_unavailable");

  const categories = yield query(
    `SELECT c.id,c.label,c.unit_minor,c.accommodation_discount_minor,c.quota,c.enabled,COALESCE(occupied.units,0) AS occupied
     FROM paid_categories c LEFT JOIN (
       SELECT a.category_id,COUNT(*) AS units FROM paid_attendees a
       JOIN paid_bookings b ON b.id=a.booking_id
       WHERE a.event_id=? AND a.cancelled_ms IS NULL
         AND (b.state IN ('confirmed','verification_pending') OR (b.state='awaiting_payment' AND b.due_ms>?))
       GROUP BY a.category_id
     ) occupied ON occupied.category_id=c.id WHERE c.event_id=?`,
    eventId, now, eventId,
  );
  const occupied = categories.reduce((sum, category) => sum + Number(category.occupied), 0);
  if (occupied + attendees.length > Number(settings.capacity)) throw new PaidBookingError("capacity_exhausted");

  const counts = new Map<string, number>();
  let totalMinor = 0;
  const snapshots = attendees.map((attendee) => {
    const category = categories.find((row) => row.id === attendee.categoryId);
    if (!category || Number(category.enabled) !== 1) throw new PaidBookingError("category_unavailable");
    const units = (counts.get(attendee.categoryId) ?? 0) + 1;
    counts.set(attendee.categoryId, units);
    if (category.quota != null && Number(category.occupied) + units > Number(category.quota)) {
      throw new PaidBookingError("capacity_exhausted");
    }
    const answers = normalizePaidSeminarAnswers(fields, "attendee", attendee.answers);
    if (!answers) throw new PaidBookingError("invalid_seminar_answers");
    const baseMinor = Number(category.unit_minor);
    const discountMinor = Number(category.accommodation_discount_minor);
    const accommodationEnabled = fields.some((field) => field.key === "accommodation" && field.scope === "attendee");
    if (discountMinor > 0 && !accommodationEnabled) throw new PaidBookingError("invalid_pricing_config");
    const accommodationChoice = answers.find((answer) => answer.key === "accommodation")?.value;
    if (discountMinor > 0 && accommodationChoice !== "yes" && accommodationChoice !== "no") {
      throw new PaidBookingError("invalid_seminar_answers");
    }
    const surchargeMinor = roomSurchargeMinor(fields, Object.fromEntries(answers.map(({ key, value }) => [key, value])));
    const unitMinor = baseMinor - (accommodationChoice === "no" ? discountMinor : 0) + surchargeMinor;
    if (unitMinor > 2_147_483_647) throw new PaidBookingError("invalid_total");
    totalMinor += unitMinor;
    return { ...attendee, label: String(category.label), unitMinor, baseMinor, surchargeMinor, appliedDiscountMinor: accommodationChoice === "no" ? discountMinor : 0, answers };
  });
  if (!Number.isSafeInteger(totalMinor) || totalMinor < 1 || totalMinor > 2_147_483_647) throw new PaidBookingError("invalid_total");
  const subtotalMinor = totalMinor;
  const applied = input.couponCode ? yield* applyCoupon(eventId,customerId,input.couponCode,subtotalMinor) : null;
  if (applied) totalMinor = applied.total_minor;
  const complimentary = totalMinor === 0;
  const id = randomUUID();
  const reference = randomUUID();
  const receipt: PaidBookingReceipt = { id, reference, state: complimentary ? "confirmed" : "awaiting_payment", currency: "THB", totalMinor, dueMs, version: 1, subtotalMinor, discountMinor: applied?.discount_minor ?? 0, couponCode: applied?.code ?? null };
  yield query(
    `INSERT INTO paid_bookings
      (id,reference,event_id,organization_id,customer_id,contact_json,pricing_version,state,payment_state,total_minor,due_ms,created_ms,updated_ms)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    id, reference, eventId, organizationId, customerId,
    JSON.stringify({ ...contact, answers: bookingAnswers, coupon: applied ?
      { code: applied.code, subtotal_minor: subtotalMinor, discount_minor: applied.discount_minor } : null }),
    pricingVersion, complimentary ? "confirmed" : "awaiting_payment",
    complimentary ? "verified" : "unpaid", totalMinor, dueMs, now, now,
  );
  if (applied) yield* recordCouponRedemption(eventId,applied.code,id,customerId,subtotalMinor,applied.discount_minor);
  if (!complimentary && settings.payment_mode !== "external_manual" && receiver) {
    yield query(
      "INSERT INTO paid_booking_receivers (booking_id,receiver_id,receiver_name,profile_version) VALUES (?,?,?,?)",
      id, receiver.id, receiver.name, receiver.profileVersion,
    );
  }
  for (const [index, attendee] of snapshots.entries()) {
    yield query(
      `INSERT INTO paid_attendees
        (id,event_id,booking_id,ordinal,category_id,category_label,unit_minor,first_name,last_name,contact_json)
        VALUES (?,?,?,?,?,?,?,?,?,?)`,
      randomUUID(), eventId, id, index + 1, attendee.categoryId, attendee.label, attendee.unitMinor,
      attendee.firstName, attendee.lastName, JSON.stringify({ email: attendee.email, phone: attendee.phone, answers: attendee.answers, pricing: { base_minor: attendee.baseMinor, room_surcharge_minor: attendee.surchargeMinor, accommodation_discount_minor: attendee.appliedDiscountMinor } }),
    );
  }
  if (complimentary) {
    for (const attendeeId of (yield query("SELECT id FROM paid_attendees WHERE booking_id=?", id))) {
      yield query("INSERT INTO paid_credentials (id,event_id,booking_id,attendee_id,issued_ms) VALUES (?,?,?,?,?)",
        randomUUID(),eventId,id,String(attendeeId.id),now);
    }
    yield query("INSERT INTO notification_deliveries (id,channel,kind,recipient,related_type,related_id,payload_json,idempotency_key) VALUES (?,'email','paid_booking.confirmed',?,'paid_booking',?,?,?) ON CONFLICT(idempotency_key) DO NOTHING",
      randomUUID(),customerId,id,JSON.stringify({eventId,customerId}),"paid_booking.confirmed:"+id+":email");
  }
  yield audit(eventId, id, customerId, "create", null, complimentary ? "confirmed" : "awaiting_payment", now);
  yield query(
    "INSERT INTO paid_command_keys (principal,event_id,operation,command_key,digest,booking_id,result_json,created_ms) VALUES (?,?,'create',?,?,?,?,?)",
    customerId, eventId, key, digest, id, JSON.stringify(receipt), now,
  );
  return receipt;
}

export function* expirePaidBookings(eventId: string): PaidCommand<number> {
  const now = Date.now();
  // Optional transactional 24-hour reminder. One semantic delivery key per booking;
  // only long-duration holds are eligible, and a worker checks live state before sending.
  if (process.env.PAID_REGISTRATION_REMINDERS_ENABLED === "1") {
    const upcoming = yield query(
      "SELECT id,customer_id,due_ms FROM paid_bookings WHERE event_id=? AND state='awaiting_payment' " +
      "AND due_ms>? AND due_ms<=? AND due_ms-created_ms>=? ORDER BY due_ms LIMIT 100",
      eventId,now+30*60_000,now+24*60*60_000,24*60*60_000,
    );
    for (const booking of upcoming) {
      yield query(
        "INSERT INTO notification_deliveries (id,channel,kind,recipient,related_type,related_id,payload_json,idempotency_key) " +
        "VALUES (?,'email','paid_booking.payment_reminder',?,'paid_booking',?,?,?) ON CONFLICT(idempotency_key) DO NOTHING",
        randomUUID(),String(booking.customer_id),String(booking.id),
        JSON.stringify({ eventId, customerId:booking.customer_id }),"paid_booking.reminder:"+String(booking.id)+":email",
      );
    }
  }
  const expired = yield query(
    `UPDATE paid_bookings SET state='expired',updated_ms=?,version=version+1 WHERE id IN (
       SELECT id FROM paid_bookings WHERE event_id=? AND state='awaiting_payment' AND due_ms<=?
       ORDER BY due_ms,id LIMIT 100
     ) RETURNING id`,
    now, eventId, now,
  );
  for (const { id } of expired) {
    yield audit(eventId, String(id), "system", "expire", "awaiting_payment", "expired", now);
  }
  return expired.length;
}

function* readPaidSeminarForm(eventId: string): PaidCommand<PaidSeminarField[]> {
  const [form] = yield query("SELECT fields_json FROM paid_event_forms WHERE event_id=?", eventId);
  return form ? parsePaidSeminarFields(JSON.parse(String(form.fields_json))) ?? [] : [];
}

export interface PaidCatalog {
  fields: PaidSeminarField[];
  pricing_version: number;
  categories: { id: string; label: string; unit_minor: number; accommodation_discount_minor: number }[];
}

export function* readPaidCatalog(eventId: string): PaidCommand<PaidCatalog | undefined> {
  const [settings] = yield query("SELECT version FROM paid_event_settings WHERE event_id=? AND published=1", eventId);
  if (!settings || !(yield* paidEnrollmentOpen(eventId, Date.now()))) return undefined;
  const categories = yield query(
    "SELECT id,label,unit_minor,accommodation_discount_minor FROM paid_categories WHERE event_id=? AND enabled=1 ORDER BY label,id", eventId,
  );
  return {
    pricing_version: Number(settings.version),
    fields: yield* readPaidSeminarForm(eventId),
    categories: categories.map(({ id, label, unit_minor, accommodation_discount_minor }) => ({
      id: String(id), label: String(label), unit_minor: Number(unit_minor),
      accommodation_discount_minor: Number(accommodation_discount_minor),
    })),
  };
}

/** Customer self-service recovery for an unpaid, expired hold. No new payment/QR is issued. */
export function* reinstateOwnedPaidBooking(eventId: string, bookingId: string, customerId: string):
  PaidCommand<{ status: "awaiting_payment"; payment_status: "unpaid"; due_at: string; version: number }> {
  const [booking] = yield query(
    "SELECT state,payment_state,due_ms,version FROM paid_bookings WHERE event_id=? AND id=? AND customer_id=?",
    eventId, bookingId, customerId,
  );
  if (!booking) throw new PaidBookingError("booking_not_found");
  const now = Date.now();
  const expired = booking.state === "expired" ||
    (booking.state === "awaiting_payment" && Number(booking.due_ms) <= now);
  if (!expired || booking.payment_state !== "unpaid") throw new PaidBookingError("state_conflict");
  if (!(yield* paidEnrollmentOpen(eventId, now))) throw new PaidBookingError("registration_unavailable");
  const [settings] = yield query(
    "SELECT capacity,hold_minutes,cutoff_ms,published,deadline_mode FROM paid_event_settings WHERE event_id=?", eventId,
  );
  if (!settings || Number(settings.published) !== 1) throw new PaidBookingError("registration_unavailable");
  const due = resolvePaidDeadline(settings, now);
  if (!Number.isSafeInteger(due) || due <= now) throw new PaidBookingError("hold_expired");
  const requested = yield query(
    "SELECT category_id,COUNT(*) AS units FROM paid_attendees WHERE booking_id=? AND cancelled_ms IS NULL GROUP BY category_id",
    bookingId,
  );
  const occupied = yield query(
    "SELECT a.category_id,COUNT(*) AS units FROM paid_attendees a JOIN paid_bookings b ON b.id=a.booking_id " +
    "WHERE a.event_id=? AND a.cancelled_ms IS NULL AND " +
    "(b.state IN ('confirmed','verification_pending') OR (b.state='awaiting_payment' AND b.due_ms>?)) GROUP BY a.category_id",
    eventId,now,
  );
  if (requested.reduce((n,row)=>n+Number(row.units),0)+
      occupied.reduce((n,row)=>n+Number(row.units),0)>Number(settings.capacity)) {
    throw new PaidBookingError("capacity_exhausted");
  }
  const existing=new Map(occupied.map((row)=>[String(row.category_id),Number(row.units)]));
  for (const row of requested) {
    const [category]=yield query("SELECT quota,enabled FROM paid_categories WHERE event_id=? AND id=?",
      eventId,String(row.category_id));
    if (!category || Number(category.enabled)!==1 ||
        (category.quota!=null && (existing.get(String(row.category_id))||0)+Number(row.units)>Number(category.quota))) {
      throw new PaidBookingError("capacity_exhausted");
    }
  }
  // A restored unpaid booking reclaims its original coupon slot only if the
  // promotion is still enabled, valid, and has quota remaining.
  const [originalCoupon] = yield query(
    "SELECT code FROM paid_coupon_redemptions WHERE event_id=? AND booking_id=?",
    eventId,bookingId,
  );
  if (originalCoupon) {
    const [rule] = yield query(
      "SELECT enabled,max_uses,per_customer_limit,starts_ms,ends_ms FROM paid_coupons WHERE event_id=? AND code=?",
      eventId,String(originalCoupon.code),
    );
    if (!rule || Number(rule.enabled)!==1 ||
      (rule.starts_ms!=null && Number(rule.starts_ms)>now) ||
      (rule.ends_ms!=null && Number(rule.ends_ms)<=now))
      throw new PaidBookingError("coupon_unavailable");
    const [usage] = yield query(
      "SELECT COUNT(*) AS uses,COALESCE(SUM(CASE WHEN r.customer_id=? THEN 1 ELSE 0 END),0) AS personal " +
      "FROM paid_coupon_redemptions r JOIN paid_bookings b ON b.id=r.booking_id " +
      "WHERE r.event_id=? AND r.code=? AND (b.state IN ('confirmed','verification_pending') OR " +
      "(b.state='awaiting_payment' AND b.due_ms>?))",
      customerId,eventId,String(originalCoupon.code),now,
    );
    if ((rule.max_uses!=null && Number(usage.uses)>=Number(rule.max_uses)) ||
        (rule.per_customer_limit!=null && Number(usage.personal)>=Number(rule.per_customer_limit)))
      throw new PaidBookingError("coupon_exhausted");
  }
  // Conditional update prevents competing self-service requests from reviving the same hold twice.
  const updated = yield query(
    "UPDATE paid_bookings SET state='awaiting_payment',payment_state='unpaid',due_ms=?,updated_ms=?,version=version+1 " +
    "WHERE event_id=? AND id=? AND customer_id=? AND payment_state='unpaid' " +
    "AND (state='expired' OR (state='awaiting_payment' AND due_ms<=?)) RETURNING version",
    due,now,eventId,bookingId,customerId,now,
  );
  if (!updated.length) throw new PaidBookingError("state_conflict");
  yield audit(eventId,bookingId,customerId,"customer_reinstate","expired","awaiting_payment",now);
  return {status:"awaiting_payment", payment_status:"unpaid", due_at:new Date(due).toISOString(),
    version:Number(updated[0].version)};
}

function editablePreferenceAnswers(answers: unknown): Record<string, string> {
  return Object.fromEntries((Array.isArray(answers) ? answers : [])
    .filter((answer) => isEditableSeminarKey(answer?.key) && typeof answer.value === "string")
    .map((answer) => [answer.key, answer.value]));
}

export type PaidPreferenceEdit = { key: EditableSeminarKey; attendeeId?: string; value: string };

export function* readOwnedPaidBooking(eventId: string, id: string, customerId: string, edit?: PaidPreferenceEdit): PaidCommand<PaidRow | undefined> {
  const [booking] = yield query(
    `SELECT b.id,b.reference,b.state,b.payment_state,b.currency,b.total_minor,b.due_ms,b.version,
      s.payment_mode,b.contact_json,e.status AS event_status,
      (SELECT COUNT(*) FROM paid_payment_attempts a JOIN paid_proofs p ON p.attempt_id=a.id
       WHERE a.booking_id=b.id AND a.event_id=b.event_id) AS submitted_proofs
     FROM paid_bookings b JOIN paid_event_settings s ON s.event_id=b.event_id
     JOIN events e ON e.id=b.event_id
     WHERE b.event_id=? AND b.id=? AND b.customer_id=?`, eventId, id, customerId,
  );
  if (!booking) return undefined;
  const attendees = yield query(
    `SELECT id,category_id,category_label,unit_minor,first_name,last_name,contact_json
     FROM paid_attendees WHERE event_id=? AND booking_id=? AND cancelled_ms IS NULL ORDER BY ordinal`, eventId, id,
  );
  const eventSettings = yield query(
    "SELECT key,value FROM event_settings WHERE event_id=? AND key IN ('event_date','event_timezone')", eventId,
  );
  const eventStart = getEventState(Object.fromEntries(eventSettings.map(({ key, value }) =>
    [String(key), String(value ?? "")]))).eventDate;
  const preferencesEditable = ["awaiting_payment", "verification_pending", "confirmed", "expired"].includes(String(booking.state)) &&
    booking.event_status !== "cancelled" && booking.payment_state !== "refunded" &&
    (!eventStart || Date.now() < eventStart.getTime());
  const fields = yield* readPaidSeminarForm(eventId);
  const roomField = fields.find(({ key }) => key === "room_preference");
  const roomSurcharge = roomField?.surcharge;
  const canRepriceRoom = booking.state === "awaiting_payment" && Number(booking.due_ms) > Date.now() &&
    Number(booking.submitted_proofs) === 0;
  const defaultRoom = roomSurcharge && roomField?.options?.find((option) =>
    option === roomField.defaultValue && option !== roomSurcharge.option) ||
    roomField?.options?.find((option) => option !== roomSurcharge?.option);
  const preferenceFields = fields.filter(({ key }) => isEditableSeminarKey(key) &&
    (key !== "room_preference" || (roomSurcharge ? canRepriceRoom : !attendees.some(({ contact_json }) =>
      Number(JSON.parse(String(contact_json || "{}")).pricing?.room_surcharge_minor) > 0))));
  if (edit) {
    if (!preferencesEditable) throw new PaidBookingError("state_conflict");
    const field = preferenceFields.find(({ key }) => key === edit.key);
    const target = edit.attendeeId ? attendees.find(({ id }) => id === edit.attendeeId) : booking;
    if (!field || !target || field.scope !== (edit.attendeeId ? "attendee" : "booking")) {
      throw new PaidBookingError("invalid_seminar_answers");
    }
    const answers = normalizePaidSeminarAnswers([field], field.scope, { [edit.key]: edit.value });
    if (!answers) throw new PaidBookingError("invalid_seminar_answers");
    const contact = JSON.parse(String(target.contact_json || "{}"));
    contact.answers = [...(Array.isArray(contact.answers) ? contact.answers.filter((answer: { key: string }) => answer.key !== edit.key) : []), ...answers];
    if (edit.key === "room_preference" && roomSurcharge) {
      const accommodation = contact.answers.find((answer: { key: string }) => answer.key === "accommodation")?.value;
      if (accommodation === "no") throw new PaidBookingError("invalid_seminar_answers");
      const previous = Number(contact.pricing?.room_surcharge_minor ?? 0);
      const next = roomSurchargeMinor(fields, { room_preference: edit.value.trim() });
      const delta = next - previous;
      const unit = Number(target.unit_minor) + delta;
      const total = Number(booking.total_minor) + delta;
      if (!Number.isSafeInteger(total) || total < 1 || total > 2_147_483_647 || unit < 0 || unit > 2_147_483_647) {
        throw new PaidBookingError("invalid_total");
      }
      contact.pricing = { ...contact.pricing, room_surcharge_minor: next };
      target.unit_minor = unit;
      yield query("UPDATE paid_attendees SET unit_minor=? WHERE id=? AND booking_id=?", unit, String(target.id), id);
      if (delta) {
        const buyerContact = JSON.parse(String(booking.contact_json || "{}"));
        if (buyerContact.coupon) {
          buyerContact.coupon.subtotal_minor = Number(buyerContact.coupon.subtotal_minor) + delta;
          yield query("UPDATE paid_coupon_redemptions SET subtotal_minor=? WHERE event_id=? AND booking_id=?",
            buyerContact.coupon.subtotal_minor, eventId, id);
        }
        booking.contact_json = JSON.stringify(buyerContact);
        booking.total_minor = total;
        booking.version = Number(booking.version) + 1;
        yield query("UPDATE paid_bookings SET total_minor=?,contact_json=?,version=?,updated_ms=? WHERE id=? AND event_id=?",
          total, String(booking.contact_json), Number(booking.version), Date.now(), id, eventId);
      }
    }
    target.contact_json = JSON.stringify(contact);
    if (edit.attendeeId) {
      yield query("UPDATE paid_attendees SET contact_json=? WHERE id=? AND booking_id=? AND cancelled_ms IS NULL",
        String(target.contact_json), edit.attendeeId, id);
    } else {
      yield query("UPDATE paid_bookings SET contact_json=? WHERE id=? AND customer_id=?", String(target.contact_json), id, customerId);
    }
  }
  const dueMs = Number(booking.due_ms);
  const contact = JSON.parse(String(booking.contact_json ?? "{}"));
  return {
    ...booking, total_minor: Number(booking.total_minor), due_ms: dueMs,
    coupon: contact.coupon ?? null,
    registrant_name: contact.name,
    registrant_email: contact.email,
    registrant_phone: contact.phone,
    registration_answers: Array.isArray(contact.answers) ? contact.answers : [],
    preferences_close_at: eventStart?.toISOString() ?? null,
    preference_fields: preferencesEditable ? preferenceFields : [],
    preference_answers: editablePreferenceAnswers(JSON.parse(String(booking.contact_json ?? "{}")).answers),
    state: booking.state === "awaiting_payment" && dueMs <= Date.now() ? "expired" : booking.state,
    attendees: attendees.map(({ contact_json, ...attendee }) => {
      const info = JSON.parse(String(contact_json || "{}"));
      const pricing = info?.pricing && typeof info.pricing === "object" ? info.pricing : null;
      const answers = Array.isArray(info.answers) ? info.answers : [];
      const assumeShared = roomSurcharge && !canRepriceRoom && defaultRoom &&
        (booking.state === "confirmed" || Number(booking.submitted_proofs) > 0) &&
        !answers.some((answer) => answer.key === "room_preference" || (answer.key === "accommodation" && answer.value === "no"));
      return { ...attendee,
        room_is_default: Boolean(assumeShared),
        preference_answers: editablePreferenceAnswers(info.answers),
        registration_answers: assumeShared ? [...answers, { key: "room_preference", label: "Room preference", value: defaultRoom }] : answers,
        email: info.email, phone: info.phone,
        base_minor: Number(pricing?.base_minor ?? attendee.unit_minor),
        accommodation_discount_minor: Number(pricing?.accommodation_discount_minor ?? 0),
      };
    }),
  };
}

export function resolvePaidDeadline(settings: PaidRow, now: number) {
  const cutoff = settings.cutoff_ms == null ? Infinity : Number(settings.cutoff_ms);
  return settings.deadline_mode === "fixed" ? cutoff : Math.min(now + Number(settings.hold_minutes) * 60_000, cutoff);
}

export interface PaidSettingsInput {
  organizationId: string;
  version: number;
  capacity: number;
  holdMinutes: number;
  cutoffMs: number | null;
  deadlineMode?: "relative" | "fixed";
  published: boolean;
  paymentMode?: "promptpay" | "external_manual";
  categories: { id: string; label: string; unitMinor: number; accommodationDiscountMinor?: number; quota: number | null }[];
  fields?: PaidSeminarField[];
}

export function* readPaidSettings(eventId: string): PaidCommand<PaidRow | undefined> {
  const [settings] = yield query("SELECT * FROM paid_event_settings WHERE event_id=?", eventId);
  if (!settings) return undefined;
  const categories = yield query("SELECT id,label,unit_minor,accommodation_discount_minor,quota FROM paid_categories WHERE event_id=? AND enabled=1 ORDER BY id", eventId);
  return { ...settings, cutoff_ms: settings.cutoff_ms == null ? null : Number(settings.cutoff_ms), categories, fields: yield* readPaidSeminarForm(eventId) };
}

export function* savePaidSettings(eventId: string, organizationId: string, input: PaidSettingsInput): PaidCommand<PaidRow> {
  if (organizationId !== input.organizationId) throw new PaidBookingError("event_not_found");
  const current = yield* readPaidSettings(eventId);
  if (input.paymentMode && !["promptpay","external_manual"].includes(input.paymentMode)) throw new PaidBookingError("invalid_payment_mode");
  if (Number(current?.version ?? 0) !== input.version) throw new PaidBookingError("version_conflict");
  const [legacy] = yield query(
    `SELECT id FROM registrations WHERE event_id=? UNION ALL
     SELECT id FROM event_performances WHERE event_id=? LIMIT 1`, eventId, eventId,
  );
  if (legacy) throw new PaidBookingError("legacy_enrollment_exists");
  const now = Date.now();
  const occupied = yield query(
    `SELECT a.category_id,COUNT(*) AS units FROM paid_attendees a JOIN paid_bookings b ON b.id=a.booking_id
     WHERE a.event_id=? AND a.cancelled_ms IS NULL
       AND (b.state IN ('confirmed','verification_pending') OR (b.state='awaiting_payment' AND b.due_ms>?))
     GROUP BY a.category_id`, eventId, now,
  );
  if (occupied.reduce((count, row) => count + Number(row.units), 0) > input.capacity ||
      occupied.some((row) => {
        const category = input.categories.find(({ id }) => id === row.category_id);
        return !category || (category.quota != null && category.quota < Number(row.units));
      })) throw new PaidBookingError("capacity_in_use");
  if (input.categories.some((category) =>
      !Number.isSafeInteger(category.accommodationDiscountMinor ?? 0) ||
      (category.accommodationDiscountMinor ?? 0) < 0 ||
      (category.accommodationDiscountMinor ?? 0) > category.unitMinor)) {
    throw new PaidBookingError("invalid_accommodation_discount");
  }
  if (input.categories.some((category) => (category.accommodationDiscountMinor ?? 0) > 0) &&
      !(input.fields ?? (yield* readPaidSeminarForm(eventId))).some(
        (field) => field.key === "accommodation" && field.scope === "attendee" && field.required)) {
    throw new PaidBookingError("invalid_pricing_config");
  }
  const deadlineMode = input.deadlineMode ?? (current?.deadline_mode === "fixed" ? "fixed" : "relative");
  if (deadlineMode === "fixed" && input.cutoffMs == null) throw new PaidBookingError("invalid_paid_settings");
  const version = input.version + 1;
  yield query(
    `INSERT INTO paid_event_settings (event_id,capacity,hold_minutes,cutoff_ms,version,published,payment_mode,deadline_mode) VALUES (?,?,?,?,?,?,?,?)
     ON CONFLICT(event_id) DO UPDATE SET capacity=excluded.capacity,hold_minutes=excluded.hold_minutes,
       cutoff_ms=excluded.cutoff_ms,version=excluded.version,published=excluded.published,payment_mode=excluded.payment_mode,deadline_mode=excluded.deadline_mode`,
    eventId, input.capacity, input.holdMinutes, input.cutoffMs, version, Number(input.published), input.paymentMode ?? (current?.payment_mode === "external_manual" ? "external_manual" : "promptpay"), deadlineMode,
  );
  yield query("UPDATE paid_categories SET enabled=0 WHERE event_id=?", eventId);
  for (const category of input.categories) {
    yield query(
      `INSERT INTO paid_categories (event_id,id,label,unit_minor,accommodation_discount_minor,quota) VALUES (?,?,?,?,?,?)
       ON CONFLICT(event_id,id) DO UPDATE SET label=excluded.label,unit_minor=excluded.unit_minor,
         accommodation_discount_minor=excluded.accommodation_discount_minor,quota=excluded.quota,enabled=1`,
      eventId, category.id, category.label, category.unitMinor, category.accommodationDiscountMinor ?? 0, category.quota,
    );
  }
  if (input.fields !== undefined) {
    const fields = parsePaidSeminarFields(input.fields);
    if (!fields) throw new PaidBookingError("invalid_seminar_fields");
    yield query(
      `INSERT INTO paid_event_forms (event_id,fields_json) VALUES (?,?)
       ON CONFLICT(event_id) DO UPDATE SET fields_json=excluded.fields_json`, eventId, JSON.stringify(fields),
    );
  }
  return (yield* readPaidSettings(eventId))!;
}

export const OWNED_BOOKING_LIST_SQL = `
  SELECT b.id,b.event_id,b.reference,e.name AS event_name,e.slug AS event_slug,s.payment_mode,b.currency,b.total_minor AS total_due_minor,
    b.due_ms,CASE WHEN b.state='awaiting_payment' AND b.due_ms<=? THEN 'expired' ELSE b.state END AS status,
    b.payment_state AS payment_status,
    (SELECT COUNT(*) FROM paid_attendees a WHERE a.booking_id=b.id AND a.cancelled_ms IS NULL) AS attendee_count
  FROM paid_bookings b JOIN events e ON e.id=b.event_id JOIN paid_event_settings s ON s.event_id=b.event_id
  WHERE b.customer_id=? AND (b.reference=? OR ?='') AND (?=0 OR b.state='confirmed') ORDER BY b.created_ms DESC,b.id DESC LIMIT ? OFFSET ?
`;

export function serializePaidBookingList(rows: PaidRow[]): PaidRow[] {
  return rows.map(({ due_ms, ...booking }) => ({
    ...booking, attendee_count: Number(booking.attendee_count), total_due_minor: Number(booking.total_due_minor), due_at: new Date(Number(due_ms)).toISOString(),
  }));
}

export interface PaidProofInput {
  eventId: string;
  bookingId: string;
  customerId: string;
  key: string;
  version: number;
  method: "promptpay" | "bank_transfer";
  claimedMinor: number;
  claimedTransferMs: number;
  reference: string | null;
  mime: "image/png" | "image/jpeg" | "image/webp";
  content: Buffer;
}

export interface PaidProofReceipt {
  attempt_id: string;
  status: "verification_pending";
  payment_status: "proof_submitted";
  version: number;
}

export function* submitPaidProof(input: PaidProofInput): PaidCommand<PaidProofReceipt> {
  const { eventId, bookingId, customerId, key, version, method, claimedMinor, claimedTransferMs, reference, mime, content } = input;
  if (!key || key.length > 128 || !Number.isSafeInteger(claimedMinor) || claimedMinor < 1 ||
      !Number.isSafeInteger(claimedTransferMs) || claimedTransferMs < 1 || !content.length || content.length > 4 * 1024 * 1024) {
    throw new PaidBookingError("invalid_proof");
  }
  const [booking] = yield query(
    "SELECT state,due_ms,version FROM paid_bookings WHERE event_id=? AND id=? AND customer_id=?",
    eventId, bookingId, customerId,
  );
  if (!booking) throw new PaidBookingError("booking_not_found");
  const checksum = createHash("sha256").update(content).digest("hex");
  const digest = createHash("sha256").update(JSON.stringify([
    bookingId, version, method, claimedMinor, claimedTransferMs, reference, mime, checksum,
  ])).digest("hex");
  const [replay] = yield query(
    "SELECT digest,result_json FROM paid_command_keys WHERE principal=? AND event_id=? AND operation='proof' AND command_key=?",
    customerId, eventId, key,
  );
  if (replay) {
    if (replay.digest !== digest) throw new PaidBookingError("idempotency_conflict");
    return JSON.parse(String(replay.result_json)) as PaidProofReceipt;
  }
  const now = Date.now();
  if (booking.state === "expired" || (booking.state === "awaiting_payment" && Number(booking.due_ms) <= now)) {
    throw new PaidBookingError("hold_expired");
  }
  if (booking.state !== "awaiting_payment") throw new PaidBookingError("state_conflict");
  if (Number(booking.version) !== version) throw new PaidBookingError("version_conflict");
  if (!paidProofEncryptionConfigured()) throw new PaidBookingError("proof_storage_unavailable");
  const attemptId = randomUUID();
  const encrypted = encryptPaidProof(content, JSON.stringify([eventId, bookingId, attemptId, mime]));
  yield query(
    `INSERT INTO paid_payment_attempts
       (id,event_id,booking_id,sequence,method,status,claimed_minor,claimed_transfer_ms,claimed_reference,created_ms)
     VALUES (?,?,?,(SELECT COALESCE(MAX(sequence),0)+1 FROM paid_payment_attempts WHERE booking_id=?),
       ?,'proof_submitted',?,?,?,?)`,
    attemptId,eventId,bookingId,bookingId,method,claimedMinor,claimedTransferMs,reference,now,
  );
  yield query(
    "INSERT INTO paid_proofs (id,attempt_id,mime,byte_length,content,checksum,uploader_id,created_ms) VALUES (?,?,?,?,?,?,?,?)",
    randomUUID(),attemptId,mime,content.length,encrypted,checksum,customerId,now,
  );
  yield query(
    "UPDATE paid_bookings SET state='verification_pending',payment_state='proof_submitted',updated_ms=?,version=version+1 WHERE event_id=? AND id=?",
    now,eventId,bookingId,
  );
  yield audit(eventId,bookingId,customerId,"submit_proof","awaiting_payment","verification_pending",now);
  const receipt: PaidProofReceipt = {
    attempt_id: attemptId, status: "verification_pending", payment_status: "proof_submitted", version: version + 1,
  };
  yield query(
    "INSERT INTO paid_command_keys (principal,event_id,operation,command_key,digest,booking_id,result_json,created_ms) VALUES (?,?,'proof',?,?,?,?,?)",
    customerId,eventId,key,digest,bookingId,JSON.stringify(receipt),now,
  );
  return receipt;
}

export function* readPaidProof(eventId: string, bookingId: string, attemptId: string): PaidCommand<{ mime: string; content: Buffer } | undefined> {
  const [proof] = yield query(
    `SELECT p.mime,p.content FROM paid_proofs p JOIN paid_payment_attempts a ON a.id=p.attempt_id
     WHERE a.event_id=? AND a.booking_id=? AND a.id=? AND p.deleted_ms IS NULL`,
    eventId, bookingId, attemptId,
  );
  if (!proof || typeof proof.mime !== "string" || !Buffer.isBuffer(proof.content)) return undefined;
  return { mime: proof.mime, content: decryptPaidProof(proof.content, JSON.stringify([eventId, bookingId, attemptId, proof.mime])) };
}

export interface PaidReviewInput {
  eventId: string;
  bookingId: string;
  attemptId?: string;
  organizationId: string;
  reviewerId: string;
  key: string;
  version: number;
  decision: "approve" | "reject" | "flag";
  reason: string;
  observed?: { amountMinor: number; transferMs: number; reference: string; receiverNamespace: string };
}

export interface PaidReviewReceipt {
  status: "confirmed" | "verification_pending" | "awaiting_payment" | "expired";
  payment_status: "verified" | "rejected" | "underpaid" | "proof_submitted";
  version: number;
}

export function* reviewPaidProof(input: PaidReviewInput): PaidCommand<PaidReviewReceipt> {
  const { eventId, bookingId, attemptId, organizationId, reviewerId, key, version, decision, reason, observed } = input;
  const now = Date.now();
  const reference = observed?.reference.trim().normalize("NFKC").toUpperCase();
  const namespace = observed?.receiverNamespace === "EXTERNAL_MANUAL"
    ? "EXTERNAL_MANUAL" : observed?.receiverNamespace.replace(/[^0-9]/g, "");
  if ((!attemptId && decision !== "approve") || !key || key.length > 128 || !reason.trim() || reason.length > 1000 ||
      (decision === "approve" && (!observed || !reference || !namespace || reference.length > 255 || namespace.length > 255 ||
        !Number.isSafeInteger(observed.amountMinor) || observed.amountMinor <= 0 ||
        !Number.isSafeInteger(observed.transferMs) || observed.transferMs <= 0 || observed.transferMs > now))) {
    throw new PaidBookingError("invalid_review");
  }
  const [booking] = yield query(
    "SELECT state,total_minor,created_ms,due_ms,version,customer_id FROM paid_bookings WHERE event_id=? AND id=? AND organization_id=?",
    eventId, bookingId, organizationId,
  );
  if (!booking) throw new PaidBookingError("booking_not_found");
  const principal = `staff:${reviewerId}`;
  const digest = createHash("sha256").update(JSON.stringify([
    bookingId, attemptId, version, decision, reason, observed?.amountMinor, observed?.transferMs, reference, namespace,
  ])).digest("hex");
  const [replay] = yield query(
    "SELECT digest,result_json FROM paid_command_keys WHERE principal=? AND event_id=? AND operation='review' AND command_key=?",
    principal, eventId, key,
  );
  if (replay) {
    if (replay.digest !== digest) throw new PaidBookingError("idempotency_conflict");
    return JSON.parse(String(replay.result_json)) as PaidReviewReceipt;
  }
  const manual = !attemptId;
  if (manual && booking.state === "awaiting_payment" && Number(booking.due_ms) <= now) {
    throw new PaidBookingError("hold_expired");
  }
  if (booking.state !== (manual ? "awaiting_payment" : "verification_pending")) throw new PaidBookingError("state_conflict");
  if (Number(booking.version) !== version) throw new PaidBookingError("version_conflict");
  let paymentAttemptId = attemptId;
  let checksum: string | null = null;
  if (paymentAttemptId) {
    const [attempt] = yield query(
      `SELECT a.id,p.checksum FROM paid_payment_attempts a LEFT JOIN paid_proofs p ON p.attempt_id=a.id
       WHERE a.event_id=? AND a.booking_id=? AND a.id=? AND a.status IN ('proof_submitted','exception')`,
      eventId, bookingId, paymentAttemptId,
    );
    if (!attempt) throw new PaidBookingError("attempt_not_found");
    checksum = typeof attempt.checksum === "string" ? attempt.checksum : null;
  } else {
    paymentAttemptId = randomUUID();
    yield query(
      `INSERT INTO paid_payment_attempts (id,event_id,booking_id,sequence,method,status,created_ms)
       VALUES (?,?,?,(SELECT COALESCE(MAX(sequence),0)+1 FROM paid_payment_attempts WHERE booking_id=?),'manual','exception',?)`,
      paymentAttemptId,eventId,bookingId,bookingId,now,
    );
  }

  let status: PaidReviewReceipt["status"] = "verification_pending";
  let paymentStatus: PaidReviewReceipt["payment_status"] = "proof_submitted";
  let attemptStatus = "exception";
  if (decision === "approve" && observed) {
    // Receiver snapshots are immutable per booking even if an event switches payment mode later.
    const [receiver] = yield query("SELECT receiver_id FROM paid_booking_receivers WHERE booking_id=?", bookingId);
    if (receiver ? receiver.receiver_id !== namespace : namespace !== "EXTERNAL_MANUAL") {
      throw new PaidBookingError("receiver_mismatch");
    }
    if (observed.transferMs < Number(booking.created_ms) || observed.transferMs >= Number(booking.due_ms)) {
      throw new PaidBookingError("transfer_outside_hold");
    }
    if (observed.amountMinor === Number(booking.total_minor)) {
      const [duplicate] = yield query(
        `SELECT id FROM paid_payment_attempts WHERE receiver_namespace=? AND trusted_reference=?
         UNION ALL SELECT a.id FROM paid_payment_attempts a JOIN paid_proofs p ON p.attempt_id=a.id
         WHERE a.status='verified' AND p.checksum=?
         UNION ALL SELECT id FROM payment_attempts WHERE status='verified' AND UPPER(TRIM(transaction_reference))=?
         UNION ALL SELECT id FROM direct_tickets WHERE payment_status='verified' AND UPPER(TRIM(payment_reference))=?
         LIMIT 1`,
        namespace!, reference!, checksum, reference!, reference!,
      );
      if (duplicate) throw new PaidBookingError("duplicate_reference_or_proof");
      if (checksum) {
        const [claim] = yield query(
          "INSERT INTO paid_verified_proof_checksums (checksum,attempt_id) VALUES (?,?) ON CONFLICT DO NOTHING RETURNING checksum",
          checksum, paymentAttemptId,
        );
        if (!claim) throw new PaidBookingError("duplicate_reference_or_proof");
      }
      status = "confirmed";
      paymentStatus = "verified";
      attemptStatus = "verified";
    } else if (observed.amountMinor < Number(booking.total_minor)) {
      paymentStatus = "underpaid";
    }
  } else if (decision === "reject") {
    status = Number(booking.due_ms) > now ? "awaiting_payment" : "expired";
    paymentStatus = "rejected";
    attemptStatus = "rejected";
  }

  yield query(
    `UPDATE paid_payment_attempts SET status=?,observed_minor=?,observed_transfer_ms=?,trusted_reference=?,
       receiver_namespace=?,reviewed_by=?,reviewed_ms=?,reason=? WHERE id=?`,
    attemptStatus, observed?.amountMinor ?? null, observed?.transferMs ?? null,
    status === "confirmed" ? reference! : null, status === "confirmed" ? namespace! : null,
    reviewerId, now, reason, paymentAttemptId,
  );
  yield query("UPDATE paid_bookings SET state=?,payment_state=?,updated_ms=?,version=version+1 WHERE id=?",
    status, paymentStatus, now, bookingId);
  if (status === "confirmed") {
    const attendees = yield query("SELECT id FROM paid_attendees WHERE event_id=? AND booking_id=? AND cancelled_ms IS NULL", eventId, bookingId);
    for (const { id } of attendees) {
      yield query("INSERT INTO paid_credentials (id,event_id,booking_id,attendee_id,issued_ms) VALUES (?,?,?,?,?)",
        randomUUID(), eventId, bookingId, String(id), now);
    }
    const customerId = String(booking.customer_id);
    yield query(
      `INSERT INTO notification_deliveries (id,channel,kind,recipient,related_type,related_id,payload_json,idempotency_key)
       VALUES (?,'email','paid_booking.confirmed',?,'paid_booking',?,?,?) ON CONFLICT(idempotency_key) DO NOTHING`,
      randomUUID(), customerId, bookingId,
      JSON.stringify({ eventId, customerId }), `paid_booking.confirmed:${bookingId}:email`,
    );
    const [origin] = yield query(
      `SELECT o.page_id,o.sender_id,o.language,o.inbound_ms FROM paid_messenger_booking_origins o
       JOIN paid_messenger_links l ON l.event_id=? AND l.page_id=o.page_id AND l.sender_id=o.sender_id AND l.customer_id=?
       WHERE o.booking_id=? AND o.inbound_ms>?`, eventId, customerId, bookingId, now - 24 * 60 * 60_000,
    );
    if (origin) {
      yield query(
        `INSERT INTO notification_deliveries (id,channel,kind,recipient,related_type,related_id,payload_json,idempotency_key)
         VALUES (?,'facebook','paid_booking.messenger_confirmed',?,'paid_booking',?,?,?) ON CONFLICT(idempotency_key) DO NOTHING`,
        randomUUID(), String(origin.sender_id), bookingId, JSON.stringify({
          eventId, customerId, pageId: origin.page_id, senderId: origin.sender_id, language: origin.language, inboundMs: Number(origin.inbound_ms),
        }), `paid_booking.confirmed:${bookingId}:facebook`,
      );
    }
  }
  yield query(
    `INSERT INTO paid_audit_events (id,event_id,booking_id,actor,action,previous_state,next_state,reason,occurred_ms)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    randomUUID(), eventId, bookingId, principal, `review_${attemptStatus}`, String(booking.state), status, reason, now,
  );
  const receipt = { status, payment_status: paymentStatus, version: version + 1 };
  yield query(
    "INSERT INTO paid_command_keys (principal,event_id,operation,command_key,digest,booking_id,result_json,created_ms) VALUES (?,?,'review',?,?,?,?,?)",
    principal,eventId,key,digest,bookingId,JSON.stringify(receipt),now,
  );
  return receipt;
}


export function* readPaidPaymentInstructions(eventId: string, bookingId: string, customerId: string): PaidCommand<{ receiverId: string; receiverName: string; totalMinor: number } | undefined> {
  const [row] = yield query(
    `SELECT r.receiver_id,r.receiver_name,b.total_minor FROM paid_booking_receivers r
     JOIN paid_bookings b ON b.id=r.booking_id
     WHERE b.event_id=? AND b.id=? AND b.customer_id=? AND b.state='awaiting_payment' AND b.due_ms>?`,
    eventId, bookingId, customerId, Date.now(),
  );
  return row ? { receiverId: String(row.receiver_id), receiverName: String(row.receiver_name), totalMinor: Number(row.total_minor) } : undefined;
}

export const PAID_CREDENTIAL_PREFIX = "fbs-paid:";

export function* readPaidCredential(eventId: string, bookingId: string, attendeeId: string, customerId: string): PaidCommand<string | undefined> {
  const [credential] = yield query(
    `SELECT c.id FROM paid_credentials c JOIN paid_bookings b ON b.id=c.booking_id
     JOIN paid_attendees a ON a.id=c.attendee_id AND a.booking_id=b.id AND a.event_id=b.event_id
     WHERE c.event_id=? AND c.booking_id=? AND a.id=? AND b.customer_id=?
       AND b.state='confirmed' AND b.payment_state='verified' AND a.cancelled_ms IS NULL AND c.revoked_ms IS NULL
       AND EXISTS (SELECT 1 FROM events e WHERE e.id=c.event_id AND e.status NOT IN ('cancelled','archived'))`,
    eventId, bookingId, attendeeId, customerId,
  );
  return credential ? PAID_CREDENTIAL_PREFIX + String(credential.id) : undefined;
}

export function* checkInPaidCredential(eventId: string, credential: string, actor: string): PaidCommand<PaidRow | undefined> {
  if (!/^fbs-paid:[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(credential)) return;
  const [attendee] = yield query(
    `SELECT a.id,a.booking_id,a.first_name,a.last_name,a.checked_in_ms FROM paid_credentials c
     JOIN paid_bookings b ON b.id=c.booking_id AND b.event_id=c.event_id
     JOIN paid_attendees a ON a.id=c.attendee_id AND a.booking_id=b.id AND a.event_id=b.event_id
     WHERE c.event_id=? AND c.id=? AND c.revoked_ms IS NULL AND a.cancelled_ms IS NULL
       AND b.state='confirmed' AND b.payment_state='verified'
       AND EXISTS (SELECT 1 FROM events e WHERE e.id=c.event_id AND e.status NOT IN ('cancelled','archived'))`,
    eventId, credential.slice(PAID_CREDENTIAL_PREFIX.length),
  );
  if (!attendee) return;
  const alreadyCheckedIn = attendee.checked_in_ms != null;
  const now = Date.now();
  if (!alreadyCheckedIn) {
    yield query("UPDATE paid_attendees SET checked_in_ms=? WHERE id=? AND checked_in_ms IS NULL", now, String(attendee.id));
    yield audit(eventId, String(attendee.booking_id), actor, "checkin", "confirmed", "confirmed", now);
  }
  return {
    already_checked_in: alreadyCheckedIn,
    registration: {
      id: attendee.id, event_id: eventId, first_name: attendee.first_name, last_name: attendee.last_name,
      status: "checked-in", timestamp: new Date(Number(attendee.checked_in_ms ?? now)).toISOString(),
    },
  };
}

export function* listDailyPaidTransfers(eventId: string, start: number, end: number): PaidCommand<PaidRow[]> {
  const transfers = yield query(
    `SELECT b.id AS booking_id,b.reference AS booking_reference,
       c.first_name,c.last_name,a.id AS attempt_id,a.status,a.created_ms AS submitted_ms,
       COALESCE(a.observed_minor,a.claimed_minor) AS amount_minor,
       COALESCE(a.observed_transfer_ms,a.claimed_transfer_ms) AS transfer_ms,
       COALESCE(a.trusted_reference,a.claimed_reference) AS transfer_reference,
       r.receiver_name,r.receiver_id
     FROM paid_payment_attempts a JOIN paid_bookings b ON b.id=a.booking_id AND b.event_id=a.event_id
     JOIN customer_accounts c ON c.id=b.customer_id
     LEFT JOIN paid_booking_receivers r ON r.booking_id=b.id
     WHERE a.event_id=? AND a.status IN ('verified','proof_submitted','exception')
       AND EXISTS (SELECT 1 FROM paid_proofs p WHERE p.attempt_id=a.id)
       AND COALESCE(a.observed_transfer_ms,a.claimed_transfer_ms)>=?
       AND COALESCE(a.observed_transfer_ms,a.claimed_transfer_ms)<?
     ORDER BY COALESCE(a.observed_transfer_ms,a.claimed_transfer_ms),a.id`,
    eventId, start, end,
  );
  const namesByBooking = new Map(transfers.map(({ booking_id }) => [booking_id, [] as string[]]));
  if (transfers.length) {
    const attendees = yield query(
      "SELECT booking_id,first_name,last_name FROM paid_attendees WHERE event_id=? AND cancelled_ms IS NULL ORDER BY ordinal",
      eventId,
    );
    for (const attendee of attendees) {
      namesByBooking.get(attendee.booking_id)?.push([attendee.first_name, attendee.last_name].filter(Boolean).join(" "));
    }
  }
  return transfers.map((row) => ({ ...row, attendee_names: namesByBooking.get(row.booking_id) ?? [] }));

}

export function* listPaidReviewQueue(eventId: string, offset: number, reference?: string): PaidCommand<PaidRow[]> {
  const rows = yield query(
    `SELECT b.id AS booking_id,b.reference AS booking_reference,b.version,b.total_minor,b.payment_state,
       b.event_id,b.customer_id,b.created_ms AS booking_created_ms,b.due_ms,
       e.name AS event_name,c.first_name AS customer_first_name,c.last_name AS customer_last_name,
       c.email AS customer_email,c.phone AS customer_phone,
       a.id AS attempt_id,a.status,a.claimed_minor,a.claimed_transfer_ms,a.claimed_reference,a.created_ms,
       a.observed_minor,a.reason,r.receiver_name,r.receiver_id,es.payment_mode,p.id AS proof_id,
       (SELECT COUNT(*) FROM paid_proofs other WHERE other.checksum=p.checksum AND other.attempt_id<>a.id) AS matching_proofs,
       (SELECT COUNT(*) FROM paid_attendees attendee WHERE attendee.booking_id=b.id AND attendee.cancelled_ms IS NULL) AS attendee_count
     FROM paid_bookings b JOIN events e ON e.id=b.event_id
     JOIN customer_accounts c ON c.id=b.customer_id
     LEFT JOIN paid_payment_attempts a
       ON a.booking_id=b.id AND a.event_id=b.event_id AND a.status IN ('proof_submitted','exception')
     LEFT JOIN paid_proofs p ON p.attempt_id=a.id LEFT JOIN paid_booking_receivers r ON r.booking_id=b.id
     JOIN paid_event_settings es ON es.event_id=b.event_id
     WHERE b.event_id=? AND ${reference ? "b.reference=?" : "1=1"}
       AND ((b.state='verification_pending' AND a.id IS NOT NULL)
         OR (b.state='awaiting_payment' AND b.due_ms>?
           AND (es.payment_mode='external_manual' OR ?)))
     ORDER BY CASE WHEN a.id IS NOT NULL THEN 0 ELSE 1 END,
       COALESCE(a.created_ms,b.created_ms),b.id LIMIT 21 OFFSET ?`,
    eventId, ...(reference ? [reference] : []), Date.now(), reference ? 1 : 0, offset,
  );
  return rows.map(({ receiver_id, ...row }) => ({
    ...row, receiver_last_four: String(receiver_id ?? "").slice(-4), total_minor: Number(row.total_minor),
    attendee_count: Number(row.attendee_count), matching_proofs: Number(row.matching_proofs),
    claimed_minor: row.claimed_minor == null ? null : Number(row.claimed_minor),
    claimed_transfer_ms: row.claimed_transfer_ms == null ? null : Number(row.claimed_transfer_ms),
    booking_created_ms: Number(row.booking_created_ms), due_ms: Number(row.due_ms),
    created_ms: row.created_ms == null ? null : Number(row.created_ms), observed_minor: row.observed_minor == null ? null : Number(row.observed_minor),
  }));
}

export function* createPaidMessengerLinkToken(eventId: string, customerId: string, tokenHash: string): PaidCommand<number> {
  const [mode] = yield query("SELECT event_id FROM paid_event_settings WHERE event_id=?", eventId);
  if (!mode) throw new PaidBookingError("event_not_found");
  const now = Date.now();
  const expiresMs = now + 10 * 60_000;
  yield query(
    "DELETE FROM paid_messenger_link_tokens WHERE event_id=? AND (expires_ms<=? OR (customer_id=? AND consumed_ms IS NULL))",
    eventId, now, customerId,
  );
  yield query("INSERT INTO paid_messenger_link_tokens (token_hash,event_id,customer_id,expires_ms) VALUES (?,?,?,?)",
    tokenHash, eventId, customerId, expiresMs);
  return expiresMs;
}

export function* exchangePaidMessengerLinkToken(eventId: string, pageId: string, senderId: string, tokenHash: string): PaidCommand<boolean> {
  const now = Date.now();
  const [token] = yield query(
    `SELECT t.* FROM paid_messenger_link_tokens t JOIN customer_accounts c ON c.id=t.customer_id
     WHERE t.event_id=? AND t.token_hash=? AND t.expires_ms>? AND c.status='active' AND c.email_verified_at IS NOT NULL`,
    eventId, tokenHash, now,
  );
  if (!token) return false;
  const customerId = String(token.customer_id);
  const [binding] = yield query(
    "SELECT customer_id,sender_id FROM paid_messenger_links WHERE event_id=? AND page_id=? AND (sender_id=? OR customer_id=?)",
    eventId, pageId, senderId, customerId,
  );
  if (token.consumed_ms != null) {
    return token.consumed_page_id === pageId && token.consumed_sender_id === senderId &&
      binding?.customer_id === customerId && binding.sender_id === senderId;
  }
  if (binding && (binding.customer_id !== customerId || binding.sender_id !== senderId)) return false;
  if (!binding) {
    yield query("INSERT INTO paid_messenger_links (event_id,page_id,sender_id,customer_id,linked_ms) VALUES (?,?,?,?,?)",
      eventId, pageId, senderId, customerId, now);
  }
  yield query(
    "UPDATE paid_messenger_link_tokens SET consumed_ms=?,consumed_page_id=?,consumed_sender_id=? WHERE token_hash=?",
    now, pageId, senderId, tokenHash,
  );
  return true;
}

export function* unlinkPaidMessenger(eventId: string, customerId: string): PaidCommand<void> {
  yield query("DELETE FROM paid_messenger_links WHERE event_id=? AND customer_id=?", eventId, customerId);
  yield query("DELETE FROM paid_messenger_link_tokens WHERE event_id=? AND customer_id=?", eventId, customerId);
}

export function* readPaidMessengerCustomer(eventId: string, pageId: string, senderId: string): PaidCommand<string | undefined> {
  const [row] = yield query(
    `SELECT l.customer_id FROM paid_messenger_links l JOIN customer_accounts c ON c.id=l.customer_id
     WHERE l.event_id=? AND l.page_id=? AND l.sender_id=? AND c.status='active' AND c.email_verified_at IS NOT NULL`,
    eventId, pageId, senderId,
  );
  return row ? String(row.customer_id) : undefined;
}

export interface PaidMessengerStatus {
  state: string;
  totalMinor: number;
  dueMs: number;
}

export function* readPaidMessengerStatus(eventId: string, pageId: string, senderId: string, reference: string): PaidCommand<PaidMessengerStatus | undefined> {
  const customerId = yield* readPaidMessengerCustomer(eventId, pageId, senderId);
  if (!customerId) return;
  const [row] = yield query(
    "SELECT state,total_minor,due_ms FROM paid_bookings WHERE event_id=? AND customer_id=? AND reference=?",
    eventId, customerId, reference,
  );
  if (!row) return;
  const dueMs = Number(row.due_ms);
  return {
    state: row.state === "awaiting_payment" && dueMs <= Date.now() ? "expired" : String(row.state),
    totalMinor: Number(row.total_minor), dueMs,
  };
}

export interface PaidMessengerDraftInput {
  eventId: string;
  pageId: string;
  senderId: string;
  messageKey: string;
  attendees: PaidBookingInput["attendees"];
}

export interface PaidMessengerQuote {
  id: string;
  totalMinor: number;
  count: number;
}

export function* createPaidMessengerDraft(input: PaidMessengerDraftInput): PaidCommand<PaidMessengerQuote> {
  const { eventId, pageId, senderId, messageKey, attendees } = input;
  const customerId = yield* readPaidMessengerCustomer(eventId, pageId, senderId);
  if (!customerId) throw new PaidBookingError("messenger_link_required");
  if (attendees.length < 1 || attendees.length > 100 || !messageKey ||
      attendees.some(({ firstName, lastName }) => !firstName.trim() || !lastName.trim() || firstName.length > 180 || lastName.length > 180)) {
    throw new PaidBookingError("invalid_booking");
  }
  const now = Date.now();
  const [previous] = yield query(
    "SELECT * FROM paid_messenger_drafts WHERE event_id=? AND page_id=? AND sender_id=? AND message_key=?",
    eventId, pageId, senderId, messageKey,
  );
  if (previous) {
    if (previous.customer_id !== customerId || Number(previous.expires_ms) <= now) throw new PaidBookingError("draft_expired");
    return { id: String(previous.id), totalMinor: Number(previous.total_minor), count: (JSON.parse(String(previous.attendees_json)) as unknown[]).length };
  }
  const catalog = yield* readPaidCatalog(eventId);
  if (!catalog) throw new PaidBookingError("registration_unavailable");
  if (catalog.fields.some(({ required }) => required)) throw new PaidBookingError("seminar_form_required");
  let totalMinor = 0;
  for (const attendee of attendees) {
    const category = catalog.categories.find(({ id }) => id === attendee.categoryId);
    if (!category) throw new PaidBookingError("category_unavailable");
    totalMinor += category.unit_minor;
  }
  if (!Number.isSafeInteger(totalMinor) || totalMinor < 1) throw new PaidBookingError("invalid_total");
  const id = randomUUID();
  yield query(
    `INSERT INTO paid_messenger_drafts
      (id,event_id,page_id,sender_id,customer_id,message_key,attendees_json,pricing_version,total_minor,expires_ms)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    id,eventId,pageId,senderId,customerId,messageKey,JSON.stringify(attendees),catalog.pricing_version,totalMinor,now + 15 * 60_000,
  );
  return { id, totalMinor, count: attendees.length };
}

export interface PaidMessengerConfirmInput {
  eventId: string;
  pageId: string;
  senderId: string;
  draftId: string;
  language: "th" | "en";
  inboundMs: number;
  receiver?: PaidBookingInput["receiver"];
}

export function* confirmPaidMessengerDraft(input: PaidMessengerConfirmInput, organizationId: string): PaidCommand<PaidBookingReceipt> {
  const { eventId, pageId, senderId, draftId, receiver } = input;
  const customerId = yield* readPaidMessengerCustomer(eventId, pageId, senderId);
  if (!customerId) throw new PaidBookingError("messenger_link_required");
  const [draft] = yield query(
    "SELECT * FROM paid_messenger_drafts WHERE event_id=? AND page_id=? AND sender_id=? AND customer_id=? AND id=?",
    eventId,pageId,senderId,customerId,draftId,
  );
  if (!draft) throw new PaidBookingError("draft_expired");
  if (draft.receipt_json) return JSON.parse(String(draft.receipt_json)) as PaidBookingReceipt;
  if (Number(draft.expires_ms) <= Date.now()) throw new PaidBookingError("draft_expired");
  const [account] = yield query("SELECT first_name,last_name,email FROM customer_accounts WHERE id=?", customerId);
  const receipt = yield* createPaidBooking(eventId, organizationId, {
    eventId, customerId, key: `messenger-draft:${draftId}`, pricingVersion: Number(draft.pricing_version), receiver,
    contact: { name: [account?.first_name, account?.last_name].filter(Boolean).join(" ") || String(account?.email ?? "") },
    attendees: JSON.parse(String(draft.attendees_json)) as PaidBookingInput["attendees"],
  });
  yield query("INSERT INTO paid_messenger_booking_origins (booking_id,page_id,sender_id,language,inbound_ms) VALUES (?,?,?,?,?)",
    receipt.id,pageId,senderId,input.language,Math.min(Date.now(), input.inboundMs));
  yield query("UPDATE paid_messenger_drafts SET receipt_json=? WHERE id=?", JSON.stringify(receipt),draftId);
  return receipt;
}

export interface PaidAdminAction {
  eventId: string; bookingId: string; organizationId: string; actorId: string;
  key: string; version: number; action: "extend" | "cancel" | "reinstate" | "refund";
  reason: string; holdMinutes?: number; refundReference?: string;
}

export function* readPaidAdminBooking(eventId: string, organizationId: string, reference: string): PaidCommand<PaidRow | undefined> {
  const [row] = yield query(
    "SELECT b.id,b.reference,b.state,b.payment_state,b.total_minor,b.version,b.due_ms," +
    "(SELECT COUNT(*) FROM paid_attendees a WHERE a.booking_id=b.id AND a.cancelled_ms IS NULL) AS attendees," +
    "(SELECT COUNT(*) FROM paid_attendees a WHERE a.booking_id=b.id AND a.checked_in_ms IS NOT NULL) AS checked_in " +
    "FROM paid_bookings b WHERE b.event_id=? AND b.organization_id=? AND b.reference=?",
    eventId,organizationId,reference,
  );
  if (!row) return undefined;
  const refunds = yield query("SELECT amount_minor,reference,recorded_ms FROM paid_refunds WHERE booking_id=?", String(row.id));
  return { ...row, total_minor:Number(row.total_minor),version:Number(row.version),due_ms:Number(row.due_ms),
    attendees:Number(row.attendees),checked_in:Number(row.checked_in),refunds };
}

export function* managePaidBooking(input: PaidAdminAction): PaidCommand<{ status:string; payment_status:string; version:number; due_at:string }> {
  const { eventId, bookingId, organizationId, actorId, key, version, action, reason, holdMinutes, refundReference } = input;
  if (!key || key.length>128 || !reason?.trim() || reason.length>1000 || !Number.isSafeInteger(version) || version<1 ||
      !["extend","cancel","reinstate","refund"].includes(action) ||
      (["extend","reinstate"].includes(action) && (!Number.isSafeInteger(holdMinutes) || holdMinutes!<5 || holdMinutes!>43200)) ||
      (action==="refund" && (!refundReference?.trim() || refundReference.length>255))) throw new PaidBookingError("invalid_admin_action");
  const principal="staff:"+actorId;
  const digest=createHash("sha256").update(JSON.stringify([bookingId,version,action,reason,holdMinutes,refundReference])).digest("hex");
  const [replay]=yield query("SELECT digest,result_json FROM paid_command_keys WHERE principal=? AND event_id=? AND operation='admin_booking' AND command_key=?",
    principal,eventId,key);
  if (replay) {
    if (replay.digest!==digest) throw new PaidBookingError("idempotency_conflict");
    return JSON.parse(String(replay.result_json));
  }
  const [booking]=yield query("SELECT state,payment_state,due_ms,total_minor,version FROM paid_bookings WHERE event_id=? AND id=? AND organization_id=?",
    eventId,bookingId,organizationId);
  if (!booking) throw new PaidBookingError("booking_not_found");
  if (Number(booking.version)!==version) throw new PaidBookingError("version_conflict");
  const now=Date.now();
  const previous=String(booking.state);
  let state=previous, payment=String(booking.payment_state), due=Number(booking.due_ms);
  if (action==="extend" || action==="reinstate") {
    if (!(yield* paidEnrollmentOpen(eventId,now))) throw new PaidBookingError("registration_unavailable");
    if (payment==="verified" || (action==="extend" && (previous!=="awaiting_payment" || due<=now)) ||
        (action==="reinstate" && previous!=="expired")) throw new PaidBookingError("state_conflict");
    const [settings]=yield query("SELECT capacity,cutoff_ms FROM paid_event_settings WHERE event_id=?",eventId);
    if (!settings) throw new PaidBookingError("registration_unavailable");
    due=Math.min(now+holdMinutes!*60000,settings.cutoff_ms==null?Infinity:Number(settings.cutoff_ms));
    if (!Number.isSafeInteger(due) || due<=now) throw new PaidBookingError("hold_expired");
    if (action==="reinstate") {
      const requested=yield query("SELECT category_id,COUNT(*) AS units FROM paid_attendees WHERE booking_id=? AND cancelled_ms IS NULL GROUP BY category_id",bookingId);
      const occupied=yield query(
        "SELECT a.category_id,COUNT(*) AS units FROM paid_attendees a JOIN paid_bookings b ON b.id=a.booking_id " +
        "WHERE a.event_id=? AND a.cancelled_ms IS NULL AND " +
        "(b.state IN ('confirmed','verification_pending') OR (b.state='awaiting_payment' AND b.due_ms>?)) GROUP BY a.category_id",
        eventId,now,
      );
      const existing=new Map(occupied.map((row)=>[String(row.category_id),Number(row.units)]));
      if (requested.reduce((n,row)=>n+Number(row.units),0)+occupied.reduce((n,row)=>n+Number(row.units),0)>Number(settings.capacity))
        throw new PaidBookingError("capacity_exhausted");
      for (const row of requested) {
        const [category]=yield query("SELECT quota FROM paid_categories WHERE event_id=? AND id=?",eventId,String(row.category_id));
        if (!category || (category.quota!=null && (existing.get(String(row.category_id))||0)+Number(row.units)>Number(category.quota)))
          throw new PaidBookingError("capacity_exhausted");
      }
      state="awaiting_payment";payment="unpaid";
    }
  } else if (action==="cancel") {
    if (payment==="verified" || !["awaiting_payment","verification_pending","payment_exception"].includes(previous))
      throw new PaidBookingError("state_conflict");
    state="cancelled";
  } else {
    if (previous!=="confirmed" || payment!=="verified") throw new PaidBookingError("state_conflict");
    const [scanned]=yield query("SELECT id FROM paid_attendees WHERE booking_id=? AND checked_in_ms IS NOT NULL LIMIT 1",bookingId);
    if (scanned) throw new PaidBookingError("already_checked_in");
    const reference=refundReference!.trim().normalize("NFKC").toUpperCase();
    if (!reference) throw new PaidBookingError("invalid_admin_action");
    yield query("INSERT INTO paid_refunds (id,event_id,booking_id,amount_minor,reference,recorded_by,reason,recorded_ms) VALUES (?,?,?,?,?,?,?,?)",
      randomUUID(),eventId,bookingId,Number(booking.total_minor),reference,actorId,reason.trim(),now);
    yield query("UPDATE paid_credentials SET revoked_ms=? WHERE booking_id=? AND revoked_ms IS NULL",now,bookingId);
    state="cancelled";payment="refunded";
  }
  yield query("UPDATE paid_bookings SET state=?,payment_state=?,due_ms=?,version=version+1,updated_ms=? WHERE id=? AND event_id=?",
    state,payment,due,now,bookingId,eventId);
  yield query("INSERT INTO paid_audit_events (id,event_id,booking_id,actor,action,previous_state,next_state,reason,occurred_ms) VALUES (?,?,?,?,?,?,?,?,?)",
    randomUUID(),eventId,bookingId,principal,"admin_"+action,previous,state,reason.trim(),now);
  const receipt={status:state,payment_status:payment,version:version+1,due_at:new Date(due).toISOString()};
  yield query("INSERT INTO paid_command_keys (principal,event_id,operation,command_key,digest,booking_id,result_json,created_ms) VALUES (?,?,'admin_booking',?,?,?,?,?)",
    principal,eventId,key,digest,bookingId,JSON.stringify(receipt),now);
  return receipt;
}

/** Read-only view: one row per person, not per booking.
 * Never duplicate paid attendees into legacy registrations storage.
 */
export function* listPaidAttendeeRoster(eventId:string,limit=10000):PaidCommand<PaidRow[]> {
  const safeLimit=Math.min(Math.max(Math.trunc(limit)||10000,1),10000);
  const rows=yield query(
    `SELECT a.id AS attendee_id,a.booking_id,a.event_id,a.ordinal,a.first_name,a.last_name,
       a.category_id,a.category_label,a.unit_minor,a.contact_json AS attendee_contact_json,
       a.checked_in_ms,a.cancelled_ms,
       b.reference AS booking_reference,b.customer_id,b.contact_json AS booking_contact_json,
       b.state AS booking_state,b.payment_state,b.created_ms AS booked_ms,b.due_ms,
       b.total_minor AS booking_total_minor,
       CASE WHEN b.state='verification_pending' THEN (SELECT COALESCE(pa.observed_minor,pa.claimed_minor) FROM paid_payment_attempts pa
         WHERE pa.event_id=b.event_id AND pa.booking_id=b.id AND pa.status IN ('proof_submitted','exception')
         ORDER BY pa.created_ms DESC,pa.id DESC LIMIT 1) END AS pending_slip_minor,
       c.first_name AS customer_first_name,
       c.last_name AS customer_last_name,c.email AS customer_email,c.phone AS customer_phone
     FROM paid_attendees a
     JOIN paid_bookings b ON b.id=a.booking_id AND b.event_id=a.event_id
     JOIN customer_accounts c ON c.id=b.customer_id
     WHERE a.event_id=?
     ORDER BY b.created_ms DESC,b.id,a.ordinal LIMIT ?`,eventId,safeLimit,
  );
  const now=Date.now();
  return rows.map(({attendee_contact_json,booking_contact_json,...row})=>{
    const contact=JSON.parse(String(attendee_contact_json||"{}")) as Record<string,unknown>;
    const bookingContact=JSON.parse(String(booking_contact_json||"{}")) as Record<string,unknown>;
    // The booking engine persists normalized answers as an ARRAY of
    // {key,label,value}, not as the input form's key-value object.
    const answerMap=(value:unknown):Record<string,string>=>{
      if(Array.isArray(value))return Object.fromEntries(value.filter(item=>
        item && typeof item.key==="string" && typeof item.value==="string")
        .map(item=>[item.key,item.value]));
      if(value && typeof value==="object")return Object.fromEntries(
        Object.entries(value).filter((entry)=>typeof entry[1]==="string"));
      return {};
    };
    const answers=answerMap(contact.answers);
    const bookingAnswers=answerMap(bookingContact.answers);
    const expired=row.booking_state==="awaiting_payment" && Number(row.due_ms)<=now;
    const state=row.cancelled_ms!=null?"cancelled":expired?"expired":String(row.booking_state);
    return {...row,booking_state:state,
      ordinal:Number(row.ordinal),unit_minor:Number(row.unit_minor),
      booked_ms:Number(row.booked_ms),due_ms:Number(row.due_ms),
      booking_total_minor:Number(row.booking_total_minor),
      pending_slip_minor:row.pending_slip_minor == null ? null : Number(row.pending_slip_minor),
      checked_in_ms:row.checked_in_ms==null?null:Number(row.checked_in_ms),
      cancelled_ms:row.cancelled_ms==null?null:Number(row.cancelled_ms),
      attendee_email:String(contact.email||""),attendee_phone:String(contact.phone||""),
      answers,booking_answers:bookingAnswers};
  });
}

export function* readPaidEventSummary(
  eventId: string, includeActivity = false, activityLimit = 100, activityOffset = 0,
): PaidCommand<PaidRow | undefined> {
  const [summary] = yield query(
    `WITH occupancy AS (
       SELECT booking_id,COUNT(*) AS attendees,
         SUM(CASE WHEN checked_in_ms IS NOT NULL THEN 1 ELSE 0 END) AS checked_in
       FROM paid_attendees WHERE event_id=? AND cancelled_ms IS NULL GROUP BY booking_id
     ), bookings AS (
       SELECT b.total_minor,b.payment_state,
         CASE WHEN b.state='verification_pending' THEN (SELECT COALESCE(pa.observed_minor,pa.claimed_minor) FROM paid_payment_attempts pa
         WHERE pa.event_id=b.event_id AND pa.booking_id=b.id AND pa.status IN ('proof_submitted','exception')
         ORDER BY pa.created_ms DESC,pa.id DESC LIMIT 1) END AS pending_slip_minor,
         EXISTS (SELECT 1 FROM paid_payment_attempts a JOIN paid_proofs p ON p.attempt_id=a.id
           WHERE a.booking_id=b.id AND a.event_id=b.event_id) AS has_slip,
         CASE WHEN b.state='awaiting_payment' AND b.due_ms<=? THEN 'expired' ELSE b.state END AS state,
         COALESCE(o.attendees,0) AS attendees,COALESCE(o.checked_in,0) AS checked_in
       FROM paid_bookings b LEFT JOIN occupancy o ON o.booking_id=b.id WHERE b.event_id=?
     ), totals AS (
       SELECT COUNT(*) AS bookings,COALESCE(SUM(attendees),0) AS attendees,
         COALESCE(SUM(CASE WHEN state='confirmed' THEN 1 ELSE 0 END),0) AS confirmed_bookings,
         COALESCE(SUM(CASE WHEN state='confirmed' THEN attendees ELSE 0 END),0) AS confirmed_attendees,
         COALESCE(SUM(CASE WHEN state='confirmed' THEN checked_in ELSE 0 END),0) AS checked_in_attendees,
         COALESCE(SUM(CASE WHEN state IN ('awaiting_payment','verification_pending') THEN attendees ELSE 0 END),0) AS held_attendees,
         COALESCE(SUM(CASE WHEN state='expired' THEN 1 ELSE 0 END),0) AS expired_bookings,
         COALESCE(SUM(CASE WHEN state='awaiting_payment' THEN 1 ELSE 0 END),0) AS awaiting_payment_bookings,
         COALESCE(SUM(CASE WHEN state='awaiting_payment' AND NOT has_slip THEN attendees ELSE 0 END),0) AS awaiting_payment_attendees,
         COALESCE(SUM(CASE WHEN state='verification_pending' THEN 1 ELSE 0 END),0) AS pending_review_bookings,
         CAST(COALESCE(SUM(CASE WHEN state='confirmed' AND payment_state='verified' THEN total_minor ELSE 0 END),0) AS TEXT) AS accepted_minor,
         CAST(COALESCE(SUM(CASE WHEN state='awaiting_payment' THEN total_minor ELSE 0 END),0) AS TEXT) AS awaiting_payment_due_minor,
         CAST(COALESCE(SUM(pending_slip_minor),0) AS TEXT) AS pending_slip_minor,
         CAST(COALESCE(SUM(CASE WHEN pending_slip_minor < total_minor
           THEN total_minor - pending_slip_minor ELSE 0 END),0) AS TEXT) AS slip_shortfall_minor,
         CAST(COALESCE(SUM(CASE WHEN state IN ('awaiting_payment','verification_pending') THEN total_minor ELSE 0 END),0) AS TEXT) AS unsettled_due_minor
       FROM bookings
     )
     SELECT totals.*,s.capacity,s.capacity-confirmed_attendees-held_attendees AS available_attendees
     FROM totals CROSS JOIN paid_event_settings s WHERE s.event_id=?`,
    eventId, Date.now(), eventId, eventId,
  );
  if (!summary) return;
  const totals = Object.fromEntries(Object.entries(summary).map(([key, value]) => [
    key, key.endsWith("_minor") ? String(value) : Number(value),
  ]));
  if (!includeActivity) return totals;
  const limit=Math.min(200,Math.max(1,Math.trunc(activityLimit)||100));
  const offset=Math.max(0,Math.trunc(activityOffset)||0);
  const activity = yield query(
    `SELECT a.id,a.action,a.occurred_ms,b.reference,
       CASE WHEN b.state='awaiting_payment' AND b.due_ms<=? THEN 'expired' ELSE b.state END AS booking_state,b.total_minor,
       c.first_name,c.last_name,
       (SELECT COUNT(*) FROM paid_attendees attendee WHERE attendee.booking_id=b.id AND attendee.cancelled_ms IS NULL) AS attendee_count
     FROM paid_audit_events a JOIN paid_bookings b ON b.id=a.booking_id AND b.event_id=a.event_id
     JOIN customer_accounts c ON c.id=b.customer_id
     WHERE a.event_id=? AND a.action IN (
       'create','submit_proof','review_verified','review_rejected','review_exception',
       'customer_reinstate','admin_extend','admin_cancel','admin_reinstate','admin_refund','expire')
     ORDER BY a.occurred_ms DESC,a.id DESC LIMIT ? OFFSET ?`, Date.now(), eventId,limit+1,offset,
  );
  return { ...totals,
    activity: activity.slice(0,limit).map((row) => ({ ...row, occurred_ms: Number(row.occurred_ms) })),
    activity_has_more:activity.length>limit,
    activity_next_offset:offset+Math.min(activity.length,limit),
  };

}

export type CheckoutSeatOption = {
  performance_id: string;
  zone: string;
  section_label?: string | null;
  ticket_class?: string | null;
  face_value: number | null;
  status: string;
  allocation_status: string;
};

export type CheckoutPriceOption = {
  ticketClass: string;
  price: number;
  seatCount: number;
  zones: string[];
};

export function normalizedCheckoutPrice(value: number | null | undefined) {
  const price = Number(value);
  return Number.isFinite(price) && price > 0 ? Math.round(price * 100) / 100 : null;
}

export function isSellableCheckoutSeat(seat: CheckoutSeatOption, performanceId: string, price?: number | null, ticketClass?: string) {
  const seatPrice = normalizedCheckoutPrice(seat.face_value);
  return seat.performance_id === performanceId
    && seat.status === "available"
    && seat.allocation_status === "allocated"
    && Boolean(seat.ticket_class?.trim())
    && seatPrice != null
    && (price == null || seatPrice === normalizedCheckoutPrice(price))
    && (!ticketClass || seat.ticket_class?.trim().toLocaleLowerCase() === ticketClass.trim().toLocaleLowerCase());
}

export function buildCheckoutPriceOptions(seats: CheckoutSeatOption[], performanceId: string): CheckoutPriceOption[] {
  const grouped = new Map<string, { ticketClass: string; price: number; count: number; zones: Set<string> }>();
  seats.forEach((seat) => {
    if (!isSellableCheckoutSeat(seat, performanceId)) return;
    const price = normalizedCheckoutPrice(seat.face_value)!;
    const ticketClass = seat.ticket_class!.trim();
    const key = `${ticketClass.toLocaleLowerCase()}\u0000${price.toFixed(2)}`;
    const group = grouped.get(key) || { ticketClass, price, count: 0, zones: new Set<string>() };
    const zone = [seat.zone, seat.section_label].filter(Boolean).join(" · ");
    group.count += 1;
    if (zone) group.zones.add(zone);
    grouped.set(key, group);
  });
  return Array.from(grouped.values(), (group) => ({ ticketClass: group.ticketClass, price: group.price, seatCount: group.count, zones: Array.from(group.zones).sort() }))
    .sort((left, right) => right.price - left.price || left.ticketClass.localeCompare(right.ticketClass));
}

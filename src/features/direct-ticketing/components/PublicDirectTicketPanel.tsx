/**
 * Direct allocation is intentionally an operator-only workflow for now.
 *
 * Ticketmelon remains the public ticketing channel; the seat map, seat holds,
 * payment proof, and direct-ticket delivery are handled from Operations only.
 * Keep this component as a no-op so an accidental import cannot expose the
 * private allocation inventory on an event page.
 */
export function PublicDirectTicketPanel(_props: { slug: string }) {
  return null;
}

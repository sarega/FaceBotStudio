export type PaidRosterPerson = {
  attendee_id:string;event_id:string;booking_id:string;
  first_name:string;last_name:string;category_label:string;
  customer_first_name:string;customer_last_name:string;customer_email:string;
  booking_reference:string;booking_state:string;payment_state:string;
  checked_in_ms:number|null;
};
export type PaidRosterSummary = {
  capacity:number;bookings:number;attendees:number;confirmed_attendees:number;
  held_attendees:number;checked_in_attendees:number;confirmed_bookings:number;
  awaiting_payment_bookings:number;pending_review_bookings:number;
};

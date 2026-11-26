export type PaidRosterPerson = {
  attendee_id:string;event_id:string;booking_id:string;
  first_name:string;last_name:string;category_label:string;
  attendee_phone?:string;
  price_flagged?:boolean; booking_price_flagged?:boolean; amount_mismatch?:boolean; payment_warning?:boolean;
  customer_first_name:string;customer_last_name:string;customer_email:string;
  booking_reference:string;booking_state:string;payment_state:string;booking_version:number;
  checked_in_ms:number|null;
  unit_minor:number; booking_total_minor:number; pending_slip_minor:number|null;
  answers:Record<string,string>; booking_answers:Record<string,string>;
};
export type PaidRosterSummary = {
  capacity:number;bookings:number;attendees:number;confirmed_attendees:number;
  accepted_minor:string; unsettled_due_minor:string; awaiting_payment_due_minor:string; pending_slip_minor:string; slip_shortfall_minor:string;
  held_attendees:number;checked_in_attendees:number;confirmed_bookings:number;
  awaiting_payment_bookings:number;pending_review_bookings:number;
};

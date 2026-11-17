# Event Coupons & Promotions

## Setup

In the selected Event, open **Registrations > Coupons & Promotions**. Coupons belong to this Event only and do not apply to unrelated events. Choose a code (3–32 ASCII letters/numbers, underscore or hyphen), type, usage limits, optional start/end times, and Active.

- **Percentage**: 20.00% is stored as 2,000 basis points, not 20 THB.
- **Fixed amount**: THB discount against the eligible subtotal, capped at the subtotal.
- **100% Free**: the entire booking total becomes THB 0.
- Set **Maximum uses** and **Uses per account** as needed. Blank = unlimited.
- Edit/disable rules from the coupon list. Rule edits do not recalculate booked invoices.
- A single booking accepts at most one coupon.

## Customer journey

1. Enter attendees, categories, and accommodation choices.
2. Type the code in **Coupon / Discount code** and click **Apply**.
3. The quote displays the subtotal, coupon deduction and final amount.
4. Reserve. The server independently verifies the coupon and calculates pricing under the same transaction that creates the booking.
5. For positive totals, continue to the existing bank-transfer/PromptPay invoice and proof review. For THB 0, credentials are issued automatically and a confirmation email is queued.

## Usage rules

- A reservation counts against the coupon limit while its unpaid hold is active, while proof review is pending, or once confirmed.
- An expired or cancelled unpaid booking releases its slot automatically, including if its due time has elapsed but the expiration worker has not swept it yet.
- **Reactivate booking** checks that the original coupon is still active, within dates, and has enough available quota. Otherwise the customer needs a fresh booking.
- Coupon value, limits and eligibility are validated server-side. Client-side totals are previews only.
- Coupon and subtotal/discount snapshots remain on the booking for audit/invoice display.
- Existing category prices and accommodation discounts are applied **before** coupon deductions.
- A complimentary coupon is not a verified bank transfer. It is explicitly identified as free in the invoice and email.

## Scope and limitations

- This initial version supports one coupon per booking in the paid-registration checkout only.
- Coupons apply to the entire booking, not selected categories; no stacking, referral codes, or automatic early-bird rules.
- Complimentary bookings are confirmed and issued immediately. A configurable manual approval process for complimentary entries is not implemented yet.
- The production Email Provider must be configured separately for actual email delivery.

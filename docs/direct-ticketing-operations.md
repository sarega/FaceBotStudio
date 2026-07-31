# Direct/VIP Ticketing Operations

## Production setup

1. Lock the organizer allocation in Ticketmelon first. A seat must never be available in both systems.
2. Set `DIRECT_TICKET_SECRET` to a long random production secret. Changing it invalidates every direct-ticket view link and QR.
3. Set `PROMPTPAY_ID` to the receiving mobile number or Thai national/tax ID and `PROMPTPAY_RECEIVER_NAME` to the name buyers must see before paying.
4. Run database migration `021_direct_ticket_checkout.sql`.
5. Enable the event public page. The direct-seat panel appears only after at least one active performance and imported seat exist.
6. For each performance, add the date/time and optional seat-plan image URL.
7. Import only the Ticketmelon-locked seats:

   ```csv
   zone,row_label,seat_label,external_seat_ref,face_value,x,y
   VIP,A,01,TM-R1-VIP-A01,2500,25,40
   ```

   `x` and `y` are percentages on the seat-plan image. Leave them blank to use the automatic seat-button grid.

## Manual payment workflow

1. Buyer or operator selects an available direct seat.
2. The system holds it for 15 minutes. Another buyer cannot hold or issue the same seat.
3. Buyer pays the exact PromptPay QR amount and uploads PNG, JPG, or WebP proof.
4. Proof submission does not issue a ticket. It extends the review window to 24 hours.
5. Staff opens **View proof**, checks the receiving bank account, amount, recipient, time, and transaction reference.
6. Staff enters the bank transaction reference and selects **Verify**. A reference cannot be reused.
7. The private PNG/PDF links appear only after approval. If email is configured, the decision is emailed automatically.
8. If rejected, staff records a buyer-facing reason. The seat returns to available.

Late payments after expiry require manual handling. Do not silently move a buyer to another seat.

## Complimentary and VIP issue

- Select a seat, guest, ticket class, and price.
- Untick **Payment required** to issue immediately.
- The event poster becomes the ticket artwork when it is a locally uploaded poster.
- **PNG** is for chat/phone delivery.
- **A6 PDF** includes 3 mm print bleed.
- **Print A4 4-up** prints up to four tickets per landscape A4 page.
- Recommended stock: 250–300 gsm matte. Keep the QR unobstructed and at least 30 mm wide.

## Reissue, void, and check-in

- **Reissue** invalidates the old QR and creates a new ticket for the same seat.
- **Void** invalidates the QR and releases the seat.
- Door staff scan the signed direct-ticket QR using the existing check-in screen or restricted check-in link.
- First scan checks in. A repeated scan is a warning. Altered, voided, or superseded QR values fail.

## Daily reconciliation

1. Export **Reconcile seats**.
2. Confirm every imported seat is `available`, `held`, `issued`, or intentionally `voided`.
3. Compare issued paid tickets and totals with bank transactions.
4. Investigate expired orders that have a late payment before selling that seat again.
5. Keep the CSV as the venue backup list.

## Optional semi-automated verification

Set `DIRECT_PAYMENT_WEBHOOK_SECRET` and have the chosen verification adapter call:

`POST /api/webhook/direct-payments`

Header:

`X-Direct-Payment-Signature: sha256=<HMAC-SHA256 hex of the raw JSON body>`

Body:

```json
{
  "ticket_id": "dtkt_...",
  "status": "verified",
  "amount": 2500,
  "receiver_id": "0812345678",
  "transaction_reference": "BANK-UNIQUE-REFERENCE",
  "paid_at": "2026-08-22T11:15:00.000Z"
}
```

The system auto-approves only when provider status, amount, receiver, transaction time, and unused reference all match. Any mismatch remains manual review. Duplicate webhook delivery is idempotent.

## Ticketmelon collaboration / full payment

Do not scrape Ticketmelon. Before enabling a shared credential or official Ticketmelon QR, obtain written confirmation of:

- an official API/export for locked-seat inventory and manual/complimentary tickets;
- whether Ticketmelon or FaceBotStudio is the check-in authority;
- QR lifecycle rules for cancellation and reissue;
- webhook idempotency and reconciliation support.

Until those are available, Ticketmelon owns its public seats and FaceBotStudio owns only the imported locked allocation. A Dynamic Thai QR/acquirer integration must map each provider order to one direct-ticket order and use the same idempotent payment decision rules above.

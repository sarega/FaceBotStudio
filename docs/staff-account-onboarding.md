# Staff account onboarding

1. Add verified staff email and expiring invitations to both database adapters. Existing staff continue using their username and password and can verify an email from Settings. Gate access keys remain independent.
2. Owner/Admin select a role and event access and send an invitation. The recipient verifies their email and sets a password using a one-time link. Administrators can resend pending invitations. Audit account creation, sending and acceptance without recording tokens.
3. Verify email delivery with a staging mailbox and test replay, expiration, revoked access, role/event scope and existing login before rollout.
4. Follow with TOTP and recovery for Owner/Admin, then sensitive operator/cashier permissions. Self-service password reset, verified-email changes, customer MFA and SMS OTP are later phases.

Invitation links expire after 24 hours. Existing-account verification links expire after 24 hours and also require the matching signed-in account. A failed delivery can be retried after one minute.

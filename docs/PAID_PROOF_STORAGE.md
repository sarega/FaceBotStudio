# Paid registration proof storage

## Image optimization

Every uploaded JPEG, PNG or WebP (max 4 MiB) is fully decoded and validated, then a best-effort optimized representation is chosen before AES-256-GCM encryption and storage in the paid_proofs.content database BLOB.

- PNG/screenshots: 1600px max long edge; **lossless WebP** re-encode, or retain original if smaller.
- JPEG and WebP photographs: 1600px max long edge; JPEG quality 88, or retain original if smaller.
- The stored MIME type follows the actual optimized content; the verified image is returned by the staff proof reader.
- Evidence SHA-256 checksum is recorded for the actual stored image, so duplicate-proof checks remain functional.

## Retention

PAID_PROOF_RETENTION_DAYS defaults to 180; valid range 30–3650. Add it to Railway worker service variables to override.

- The **worker** checks hourly and once on startup.
- Deletes only paid_proofs.content for bookings that are **confirmed, expired, or cancelled**, once BOTH the proof upload and booking's latest update are older than the retention cutoff.
- verification_pending, awaiting_payment, and payment_exception bookings are excluded.
- deleted_ms is populated. Financial history, payment attempts, receipt checksums, review decisions and audit records are preserved.
- Deletes at most 1000 images per hourly sweep, in batches of 200.
- Deletion is not reversible. Database backups may still contain earlier snapshots, and PostgreSQL may only reclaim disk through its vacuum mechanism.
- Verify applicable financial-record retention obligations and backup retention before reducing the default. If a legal hold is required, keep the relevant evidence in an approved secure archive before its retention date.

**Security:** Preserve PAID_PROOF_ENCRYPTION_KEY. Changing it without re-encrypting old images makes them unreadable. Reviewers must still verify the actual bank credit before approval.

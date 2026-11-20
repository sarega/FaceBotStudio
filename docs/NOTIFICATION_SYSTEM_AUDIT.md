# Meetrix notification system audit — 2026-11-20

## Notification sources
- Admin in-app bell/Notifications tab: the selected Event paid booking audit feed, protected by organizer ownership, using the paid-registration summary API.
- Desktop Notifications: a separate browser Notification API poll of registration and public-chat audit logs (approximately every 12 seconds), enabled by Admin Agent settings and browser permission.
- External transactional email, SMS, Facebook and Telegram: delivery queues, workers and/or Admin Agent integrations, with their own independent delivery lifecycle.
- Customer preferences: notification preferences endpoints are not the Admin inbox.

## Issues found and changes
- The original inbox only showed new bookings and uploaded slips, not payment decisions or booking lifecycle updates.
- Older activity was cut off after 40 records, dismiss state was capped to 40, there was no manual refresh or recovery/restore.
- Added per-user-per-Event local inbox state with safe parsing/migration, cross-tab storage synchronization, and independent read/archived states.
- Admin controls: Inbox, Unread, Archived, Mark all read, Archive read, individual Archive and Restore, Restore all, and explicit Refresh/error feedback.
- Added paginated server activity, including review verified/rejected/exception, booking reinstate/extend/cancel/refund and expiry events.
- Loaded older pages are retained when a new server poll arrives; duplicate activity IDs are removed.
- No notification read/archive action deletes source booking, proof, customer or audit data.

## Remaining design limitations
- Team-wide acknowledgements remain separate; per-Admin cross-device state is now implemented in v0.11.7.
- The Admin inbox uses the selected Event, not all organizer Events. A unified multi-Event inbox needs a new aggregated API.
- Legacy registration events, desktop alerts and Telegram/email delivery are not automatically merged into the paid booking inbox.
- In-app polling is approximately every 30 seconds, not instant push. Archive in the inbox does not acknowledge external notifications.
- Offset pagination during concurrent insertions can cause a page boundary shift; activity IDs are deduplicated, but cursor-based paging is preferable.

## Production verification
1. New booking, slip uploaded, approval/rejection should each produce the correct new audit notification.
2. Read all and Archive read should not affect the Booking, slip or counters.
3. An archived item must be restorable, including after page reload and Refresh.
4. Load older should preserve older entries when recent activity updates.
5. User/Event scope should isolate view state; unauthorized cross-organization requests must fail.
6. Refresh failure retains previously loaded entries and permits retry.
7. Check desktop and external delivery separately.


## v0.11.7: cross-device Admin notification state

The new database tables admin_notification_preferences and admin_notification_items
are introduced by migration 056_admin_notification_state.sql. The key scope
is organization_id + user_id + event_id. Original paid audit events, bookings,
slips and credentials are never edited or deleted by acknowledgement actions.

- Authenticated GET/POST /api/events/:eventId/admin-notifications/state reads and
  mutates only the signed-in owner/admin's state for an accessible Event.
- Allowed operations: read, read_all, archive, restore, restore_all, import.
- The first browser with stored read/archive state imports it once; further
  imports are ignored so an older device cannot resurrect previously restored items.
- Mark all read uses the latest Event audit timestamp held on the database.
- Individual read/archive changes are merged transactionally across devices.
- The existing ~30 second polling synchronizes state; network failure is
  reported without affecting original notification source records.
- Team-wide acknowledgements, global multi-Event inbox aggregation and
  Desktop/Telegram/Email read receipts remain separate future work.

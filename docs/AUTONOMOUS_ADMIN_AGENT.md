# Autonomous Admin Agent — first release

## Configuration
Agent Setup → Agent Runtime → Autonomous Admin Agent:
- Autonomous Agent: ON
- Daily Event Summary: ON
- Critical issue alerts: ON
- Include error analysis: ON
- Report time: 08:00 Asia/Bangkok

Reports reuse the existing Admin Agent Telegram bot. The Admin Agent and its Telegram channel must both be enabled; a bot token and authorized chat IDs are required. The embedded worker (APP_RUNTIME=worker or all) must run with reachable Redis. If Redis is unavailable scheduled messages are skipped to avoid duplicates.

## Runtime
- Checks immediately at startup and then every 15 minutes.
- Sends daily reports within the two-hour window after the scheduled Bangkok time. A missed window is not backfilled.
- Reports active, pending and inactive events belonging to the organization of the configured default Event ID, respecting the existing notification scope.
- Shows registration totals, cancellations, check-ins, remaining seats and registration activity dated in UTC.
- Error analysis samples the most recent 500 notification deliveries and 500 audit records from the past 24 hours; these diagnostics are system-wide and are not complete infrastructure monitoring.
- Critical alerts cover invalid registration windows, recorded notification delivery failures and failed Admin Agent actions. Redis deduplicates by date, recipient and issue-category signature.
- Routine checks do not call OpenRouter and cannot modify registrations or event settings. Telegram reports contain aggregates, never attendee personal details.
- Redis deduplication keys expire after 48 hours. If a process stops after acquiring a key but before sending, that message may be lost, prioritizing duplicate prevention.

## Testing and limitations
Run npm run lint, node --import tsx --test backend/adminAgentAutonomous.test.ts, and npm run build. Telegram has not been exercised against a live bot by these tests. Review worker logs (autonomous-agent), enabled flags, allowed chat IDs and Redis if no report arrives. The first version uses deterministic diagnostics rather than AI root-cause investigations; it will not detect unrecorded failures.

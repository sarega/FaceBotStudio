# Visual Hierarchy Change Log

Release: `0.1.2`  
Date: 2026-07-11

## Scope

This update reduces visual fatigue in dense administrative workspaces. It changes presentation only; application behavior, data flows, and controls are unchanged.

## Changes

- Removed equal-strength outer borders from major workspace sections.
- Added blue, cyan, emerald, and violet section surfaces for faster visual scanning.
- Added equivalent darker tonal surfaces for dark mode instead of using one slate color everywhere.
- Softened nested control bands and disclosure panels.
- Removed default borders from unselected event rows while preserving selected-state emphasis.
- Kept clear borders on inputs and actionable controls where an edge communicates interaction.
- Replaced the Event Workspace status-pill cluster with a compact status selector.
- Added a persistent Event Workspace collapse state that expands the active editor when hidden, with an icon-only restore control beside the editor actions.
- Added dark-theme surfaces for the embedded attendee-flow and brand previews.

## Files

- `src/index.css`
- `src/features/agent/components/AgentSetupScreen.tsx`
- `src/features/event/components/EventWorkspaceScreen.tsx`
- `src/features/event-workspace/components/EventWorkspacePanel.tsx`

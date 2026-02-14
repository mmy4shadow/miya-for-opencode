# src/hooks/

This directory exposes the public hook entry points that feature code imports to tap into behavior such as loop guards, phase reminders, slash-command bridging, and post-read nudges.

## Responsibility

It acts as a single entry point that re-exports the factory functions for every hook implementation underneath `src/hooks/`, so other modules can import from `src/hooks` without needing to know subpaths.

## Design

- Aggregator/re-export pattern: `index.ts` consolidates factories (`createLoopGuardHook`, `createPhaseReminderHook`, `createPostReadNudgeHook`, `createSlashCommandBridgeHook`) so the rest of the app depends only on this flat namespace.
- Each hook implementation underneath follows a factory-based design; callers receive a configured hook instance by passing structured options through the exported creator functions.

## Flow

Callers import a factory from `src/hooks`, then the factory wires together each hook’s internal checks and side-effects before returning the hook interface that the feature layer consumes.

## Integration

- Feature modules across the app import everything through `src/hooks/index.ts`; there are no direct relations to deeper hook files, keeping consumers ignorant of the implementation details.
- Hook contracts are exposed through the exported factory APIs in `src/hooks/index.ts`.

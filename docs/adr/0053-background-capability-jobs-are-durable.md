# 0053. Background Capability Jobs are durable

- Status: Accepted
- Date: 2026-07-11

## Context

Some capabilities outlive one Agent tool call and may still be running when the application exits. xAI video generation is the first complete case: CDF submits work, xAI returns a temporary `request_id`, later polling yields a temporary download URL, and CDF must preserve the resulting project-local artifact.

Treating the provider request as the CDF task leaks an adapter-specific identity into IPC and makes restart recovery ambiguous. Keeping polling inside the conversation tool also blocks the Agent run and produces timeline noise.

## Decision

CDF owns a stable Background Capability Job identity. A Job and a Provider Task are separate identities:

- `capability_jobs.id` is the CDF `jobId` exposed in receipts, snapshots, and events.
- `provider_task_id` stores the adapter-private xAI `request_id`; it is never exposed to renderer snapshots.
- `type` identifies the CDF capability (`video.generate`), independently of provider naming.

Submission creates the Provider Task, durably inserts the CDF Job with its Provider Task identity, and then returns a Job Receipt. The background worker polls and changes durable states through `queued`, `running`, `downloading`, and a terminal `completed` or `failed` state.

On startup, CDF resumes non-terminal rows that already have a Provider Task identity. Recovery polls that identity and must not call the provider creation endpoint again.

Every state transition follows **durable write before event**: SQLite is updated before `capability-jobs:changed` is sent. Renderer events are invalidation/state-update hints; `capability-jobs:list` remains the authoritative project-scoped snapshot.

Provider result downloads use a project-local temporary file followed by an atomic rename into `.cdf/artifacts/videos`. A completed Job is persisted only after that rename succeeds.

Conversation history records the tool submission receipt and terminal completion/failure only. Poll attempts and intermediate provider responses are operational details and do not become conversation timeline entries.

## Consequences

- Application restart can continue an existing xAI task without duplicate generation charges.
- Renderer IPC contains no OAuth credentials, provider request identifiers, or temporary provider URLs.
- Project TaskPanel can show durable work independently of the currently selected conversation.
- Adding another background capability requires an adapter that maps its Provider Task lifecycle into the shared CDF Job states.
- Terminal conversation projection needs only one final event; polling frequency does not increase timeline volume.

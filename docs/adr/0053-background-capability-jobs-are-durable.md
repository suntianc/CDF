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

Submission first durably inserts a locally `queued` CDF Job and returns a Job Receipt. A queued Job has not contacted the provider and may be canceled. The runner acquires one atomic slot per frozen Capability Connection before changing the Job to `submission_pending` and making the provider creation request.

Provider creation is automatically attempted at most once. A transport failure, process interruption, missing Provider Task identity, or otherwise ambiguous result becomes `submission_unknown`; recovery never retries it. An explicit `resubmit` creates a new linked CDF Job under the current approval policy so the original possible charge remains explainable.

`auto` route selection resolves before persistence to a concrete Capability Connection. Recovery, resubmission, query, and download never fall back to another provider or account. An unavailable frozen route becomes `blocked`. Disabling new submissions does not prevent minimal query and download work for an already submitted, paid Provider Task.

Submitted Jobs without provider cancellation support expose `stop_tracking`, not “cancel”. Stopping retains the Provider Task identity, and `resume_tracking` queries that same task without another creation request. Safe query and download operations use bounded backoff retries; unsafe creation never does.

On startup, CDF changes interrupted `submission_pending` rows without a Provider Task identity to `submission_unknown`, resumes submitted rows by polling their existing identity, leaves `tracking_stopped` rows stopped, and restores queued work through the connection slot.

Every state transition follows **durable write before event**: SQLite is updated before `capability-jobs:changed` is sent. Renderer events are invalidation/state-update hints; `capability-jobs:list` remains the authoritative project-scoped snapshot.

Provider result downloads use a project-local temporary file followed by an atomic rename into `.cdf/artifacts/videos`. A completed Job is persisted only after that rename succeeds.

Conversation history records the tool submission receipt and terminal completion/failure only. Poll attempts and intermediate provider responses are operational details and do not become conversation timeline entries.

- Each Capability Connection has at most one submitted video Job; additional work remains locally queued and uncharged.
- Unknown creation outcomes are explicit and require a user- or Agent-approved linked resubmission.
- Cancellation means pre-submission cancellation only; stopping local tracking never claims the remote generation was canceled.

## Consequences

- Application restart can continue an existing xAI task without duplicate generation charges.
- Renderer IPC contains no OAuth credentials, provider request identifiers, or temporary provider URLs.
- Project TaskPanel can show durable work independently of the currently selected conversation.
- Adding another background capability requires an adapter that maps its Provider Task lifecycle into the shared CDF Job states.
- Terminal conversation projection needs only one final event; polling frequency does not increase timeline volume.

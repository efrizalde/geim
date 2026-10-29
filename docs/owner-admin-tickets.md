# Owner admin panel tickets

Status: Proposed backlog; these are local planning tickets, not issues in an external tracker.
The owner admin PRD is kept locally and excluded from Git.

## ADM-01 — Configure owner identity and protect admin routes

**Priority:** P0
**Depends on:** none

Implement a server-only owner UUID configuration and an authorization helper using the validated session user ID. Protect all admin loads, actions, and endpoints; show navigation only to the owner. Document how an operator looks up and configures the existing user's UUID, rotates ownership, and recovers from a missing or incorrect value. Never bootstrap the owner from the first registration.

**Acceptance criteria**

- Owner accesses the panel; an anonymous page request reaches login and an anonymous API request gets 401; signed-in non-owners receive 403 for every admin read and mutation, including direct requests.
- Missing, malformed, or nonexistent configured UUID gives nobody owner access; changing the configured UUID takes effect across deployed instances according to deployment configuration.
- Tests cover correct owner, non-owner, unauthenticated, malformed configuration, and attempted direct action access. The client cannot assign ownership.

## ADM-02 — Harden owner sign-in for public deployment

**Priority:** P0, public-release blocker
**Depends on:** ADM-01

Replace the privileged account's reliance on the current four-character password minimum and process-local login limit. Define and implement a stronger owner password policy, safe upgrade for the existing owner, and a shared or edge-enforced rate limiter covering login across instances. Document setup, recovery, key rotation, and the actual guarantees of the selected limiter. Do not lock out existing users or silently weaken their access.

**Acceptance criteria**

- Owner access is not enabled for public rollout until the owner has upgraded to the defined stronger password; upgrade and recovery do not disclose or log credentials.
- Failed attempts from multiple app instances are subject to one effective limit; successful authentication and retry behavior are tested. Failure/unavailability behavior is documented and tested.
- Existing non-owner login remains functional; rollout docs specify how to verify protections and recover owner access. No MFA claim is made unless implemented.

## ADM-03 — Persist registration policy and audit changes

**Priority:** P0
**Depends on:** ADM-01

Create an additive migration for a durable registration-open setting and minimal audit history. Default to open when no setting exists, preserving existing behavior. Implement an owner-only change operation that writes the state and audit entry atomically, including under concurrent requests. Confirm the Neon HTTP driver's transaction capabilities; use one atomic statement or a supported transactional connection.

**Acceptance criteria**

- State changes survive restart and are visible across instances; missing setting defaults open and invalid or unreadable state fails closed for registration.
- One audit entry per actual change records actor, action, old/new values, and timestamp; no-op writes do not create entries. Audit failure rolls back the setting change.
- Concurrent changes produce a correct final setting and audit trail. Tests cover migration/defaults, no-op, write failure, concurrency, and authorization.
- Document the proposed 90-day retention policy and a cleanup procedure; do not store credentials, tokens, session identifiers, or raw provider data.

## ADM-04 — Enforce the registration policy

**Priority:** P0
**Depends on:** ADM-03

Read the centralized policy on the registration page and again on every POST before creating a user. Explain when registration is paused or temporarily unavailable, while preserving login and existing sessions. A registration whose policy check completed before a concurrent pause may finish; later checks must see the stored setting.

**Acceptance criteria**

- Open registration works as before; paused registration blocks both the normal form and a direct POST with a clear message and creates no user or session.
- A settings read failure or invalid value blocks new registration with a recoverable error; login and signed-in access continue.
- Tests cover GET, POST, cross-instance visibility, direct bypass attempts, and the documented in-flight request boundary.

## ADM-05 — Build owner overview and user directory

**Priority:** P1
**Depends on:** ADM-01

Add an owner-only overview with total users, linked accounts by stored connection status, published profile count, and retrieval time. Add a server-paginated username search showing username, creation date, linked-account count, and latest sync date. Select only the required fields; do not join or return raw snapshots or share tokens.

**Acceptance criteria**

- Counts match seeded database fixtures, including zero and unknown status values; query errors display an error rather than zero. No unsupported sync success/failure metrics are shown.
- Search and pagination are bounded, safe, deterministic for tied values, and work for empty results; absent sync dates read “Never synced.”
- Responses contain no passwords, session data, Riot credentials or identities, share tokens, wallets, or raw snapshots. Owner/non-owner access and data minimization are tested.
- Desktop and mobile layouts expose usable search, loading, empty, and error states and work with keyboard navigation.

## ADM-06 — Build registration control and audit history

**Priority:** P1
**Depends on:** ADM-03, ADM-04, ADM-05

Add the registration status, a confirmable pause/resume action, and a paginated audit history to the owner panel. Explain that pausing affects new registrations, not existing accounts. Use the owner-only operation from ADM-03.

**Acceptance criteria**

- The owner can pause and resume registration; the control shows pending, persisted success, and actionable failure states, including after refresh.
- Only real state changes appear in audit history with actor, prior/new values, and time. The UI handles empty history and failed loads.
- Keyboard and screen-reader users can operate the confirmation and receive status feedback; direct non-owner submissions are rejected server-side.

## ADM-07 — Release verification and operator runbook

**Priority:** P0 release gate
**Depends on:** ADM-01 through ADM-06

Verify the complete flow against an isolated migrated database and a representative multi-instance deployment. Document configuration, backup, owner recovery, rate limiting, audit retention, deployment and rollback, especially the risk that older code ignores a paused registration policy.

**Acceptance criteria**

- Run automated authorization, registration, migration, audit atomicity/concurrency, and data-minimization tests; record results. Run project check, tests, and build, documenting any unresolved failures.
- Manually verify owner and normal-user access, direct POST denial, pause/resume across instances, login while paused, and mobile/keyboard states.
- Confirm logs and network responses do not contain the excluded sensitive fields. Confirm backup and rollback procedures, including edge blocking or an explicit decision to reopen registration on rollback.
- Do not release publicly until ADM-02 and all P0 security checks pass.

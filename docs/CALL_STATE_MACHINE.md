# Call state machine

## Authoritative states

`call_requests.state` is the business source of truth and has exactly five values:

| State | Meaning |
|---|---|
| `WAITING` | Proximity passed and the request is queued. |
| `ACTIVE` | Staff answered; this is the branch's current conversation. |
| `ON_HOLD` | Staff temporarily held this conversation. |
| `ENDED` | An answered or held conversation was ended. Terminal. |
| `CANCELLED` | The customer withdrew before answer. Terminal. |

WebRTC presence, track state, socket connectivity, page visibility, or LiveKit room state never changes these states by itself.

## Legal transitions

```text
WAITING ──answer──────────────────────────> ACTIVE
   │                                          │
   └──customer cancels──> CANCELLED           ├──hold──────> ON_HOLD
                                              │                 │
                                              └──end──> ENDED <──┴──end
                                                                │
                                             ACTIVE <──resume───┘
```

`ON_HOLD -> ACTIVE` is allowed only when the branch has no current `ACTIVE` request. If another request is active, staff must end it before resuming the held call. The MVP does not implicitly swap calls on resume.

## Branch invariants

- Zero or one `ACTIVE` request.
- Zero or one `ON_HOLD` request.
- Any number of `WAITING` requests.
- A visitor has zero or one unresolved (`WAITING`, `ACTIVE`, `ON_HOLD`) request per branch.
- Waiting order is ascending database-generated `queue_sequence`. This remains stable even when timestamps are equal; sequence gaps after rollbacks are harmless.
- Every accepted transition and vehicle-description edit appends a `call_events` row in the same transaction.

## Commands and preconditions

| Command | Transactional behavior | Required preconditions |
|---|---|---|
| Enqueue | Validate proximity, create `WAITING`, append event. | Valid branch; within radius; no unresolved request for visitor/branch. |
| **رد** | `WAITING -> ACTIVE`. | No `ACTIVE`; selected request still `WAITING`. |
| **تعليق** | `ACTIVE -> ON_HOLD`. | Selected request is `ACTIVE`; no `ON_HOLD`. |
| **تعليق والرد على التالي** | Current `ACTIVE -> ON_HOLD` and oldest `WAITING -> ACTIVE` in one transaction. | No `ON_HOLD`; current active exists; a waiting request exists. |
| **استئناف** | `ON_HOLD -> ACTIVE`. | Selected request is `ON_HOLD`; no `ACTIVE`. |
| **إنهاء** | `ACTIVE` or `ON_HOLD -> ENDED`. | Selected request is in the stated unresolved state. |
| Customer cancel | `WAITING -> CANCELLED`. | Capability belongs to that visitor/request and request is still `WAITING`. |
| Edit description | Replace trimmed nullable text and append event. | Staff is authorized for the tenant; length at most 100. |

Commands are idempotent where practical. A repeated request with the same idempotency key returns the already-committed result; a stale or conflicting command returns the current state and a conflict code rather than guessing.

## Atomicity and serialization

Every queue-changing database function:

1. authenticates/authorizes the actor;
2. locks the branch row (`SELECT ... FOR UPDATE`) to serialize mutations for that branch;
3. locks the affected call rows;
4. rechecks state and slot preconditions inside the transaction;
5. updates all calls and inserts all events;
6. commits once.

Partial unique indexes provide a second, non-bypassable guard for the active slot, held slot, and per-visitor unresolved request. In the hold-and-answer operation, the next request is selected by FIFO order after the branch lock is acquired. Two workers can therefore never answer the same request or choose two different calls for the single active slot.

## Realtime and reconnection

Realtime messages are notifications, not commands or durable truth. After a message, reconnect, or detected sequence gap, clients refetch their authorized database view. Events include the resulting state/version so old messages can be ignored.

For an `ON_HOLD` request, the application disables the audio path using LiveKit participant permissions/client controls after the database transition commits. If that transport update fails, the call remains `ON_HOLD` and the server retries/reconciles; it does not roll the database back to match LiveKit.

## Terminal-state retention

`ENDED` and `CANCELLED` rows remain immutable operational history for a product-defined retention period. The MVP should use a short, documented retention policy and avoid storing voice, coordinates, or unnecessary device information.

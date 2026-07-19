## ADDED Requirements

### Requirement: New sessions use weighted balancing
The router SHALL select a healthy member for a new session using deterministic smooth weighted round-robin and SHALL skip disabled, unauthorized, exhausted, or cooling members.

#### Scenario: Balance new sessions
- **WHEN** multiple new sessions arrive for a pool with healthy weighted members
- **THEN** the initial assignments follow the configured weights without changing established bindings

### Requirement: Established sessions remain sticky
The router SHALL reuse the bound healthy member for a logical session and SHALL derive affinity from explicit session identifiers, prior response identifiers, stable bounded request content, or the entry account in that order.

#### Scenario: Continue a healthy session
- **WHEN** a follow-up request resolves to an unexpired binding whose member is healthy
- **THEN** the request is sent to the same member even if another member would be next in round-robin order

#### Scenario: Continue from previous response
- **WHEN** a request contains a known previous response identifier
- **THEN** the request is routed to the member that produced that response

### Requirement: Failover is bounded and safe
The router MUST retry only retryable failures, MUST attempt no more than the configured limit capped at one fallback in the first release, and MUST NOT retry after client-visible response bytes have been emitted.

#### Scenario: Retry a rate-limited request
- **WHEN** the selected member returns 429 before any response body is relayed and another member is eligible
- **THEN** the router cools the first member and retries the request once on the fallback member

#### Scenario: Do not retry a validation failure
- **WHEN** the selected member returns a non-retryable 400 or 422 response
- **THEN** the router relays that response unchanged and keeps the session binding unless policy marks the member unhealthy for another reason

#### Scenario: Do not replay partial streaming output
- **WHEN** response bytes have already been relayed and the upstream stream terminates with an error
- **THEN** the router closes the client response, records the failure, and does not issue another upstream request

#### Scenario: Retry the same account before failover
- **WHEN** a member produces retryable pre-response failures fewer times than the configured same-account failure threshold
- **THEN** the router retries that member without cooling it or consuming a cross-account failover

#### Scenario: Switch after the same-account threshold
- **WHEN** a member reaches the configured same-account failure threshold during one logical request
- **THEN** the router applies its health transition and may switch to another eligible member within the configured account failover limit

### Requirement: Member health recovers predictably
The router SHALL track consecutive failures, Retry-After, cooldown deadlines, and last success, and SHALL return members to healthy state after a successful request or elapsed recoverable cooldown.

#### Scenario: All members unavailable
- **WHEN** no member is eligible for dispatch
- **THEN** the router returns a structured 503 response with the earliest known recovery time and does not perform an unbounded retry loop

### Requirement: Upstream credentials remain isolated
The router MUST authorize the local pool route independently from upstream credentials, MUST select and inject only the chosen member credential, and MUST NOT persist upstream credentials in the usage database or logs.

#### Scenario: Forward through a pool
- **WHEN** an authorized local request is assigned to a member
- **THEN** the router replaces the authorization header with that member's in-memory upstream credential before forwarding

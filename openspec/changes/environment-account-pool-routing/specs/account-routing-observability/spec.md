## ADDED Requirements

### Requirement: Logical requests retain failover audit metadata
The system SHALL record the pool, entry account, final account, attempted accounts, attempt count, failover reason, and a non-reversible session-key hash for each pooled logical request.

#### Scenario: Successful failover is recorded
- **WHEN** a request fails on one member and succeeds on another
- **THEN** request details show both attempts, the final account, and the normalized failover reason

### Requirement: Usage is attributed to the actual upstream member
The system SHALL attribute token usage, cost, latency, status, model, and Base URL to the member that produced the final response.

#### Scenario: Pool request succeeds on fallback
- **WHEN** the fallback member returns usage information
- **THEN** aggregates count one logical request and assign its usage to the fallback account and Base URL

### Requirement: Pool health is observable without secrets
The system SHALL expose current member state, cooldown deadline, consecutive failures, last success, and sanitized last error through authenticated admin and desktop bridge APIs.

#### Scenario: View exhausted pool
- **WHEN** all members are cooling or exhausted
- **THEN** the environment UI shows the pool as unavailable and identifies the earliest recovery time without displaying API keys or raw upstream bodies

### Requirement: Request details support pooled routing fields
The request-details page SHALL display and filter pooled requests by pool, selected account, failover occurrence, and normalized failure reason while remaining compatible with legacy request rows.

#### Scenario: View a legacy request
- **WHEN** a usage row predates account-pool audit columns
- **THEN** the page displays the request normally with pool and failover fields shown as unavailable

### Requirement: Request failures expose safe diagnostic details
The system SHALL retain a bounded, credential-redacted error summary for failed requests and a per-attempt routing audit containing account, status, reason, duration, and outcome without persisting complete upstream bodies or authorization data.

#### Scenario: Inspect a failed pooled request
- **WHEN** a pool member fails and the router retries or returns an error
- **THEN** hovering the request status shows the final safe error and hovering routing attempts shows why each attempt failed and what the router did next

### Requirement: API-backed accounts expose recent request health
The account list SHALL show request success rate and request-level cache hit rate over the most recent 60 locally routed requests for API-key accounts and AUTH accounts that have a separately configured API key.

#### Scenario: Inspect recent API request health
- **WHEN** an eligible account has locally recorded requests
- **THEN** its account row shows chronological segmented bars and percentages for request success and cache hits, with pool requests attributed to the final account

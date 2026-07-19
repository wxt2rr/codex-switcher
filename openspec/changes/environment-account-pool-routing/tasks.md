## 1. Routing model and persistence

- [x] 1.1 Add pool, member, binding, health, and audit types with redacted/session-hash-safe serialization helpers
- [x] 1.2 Extend usage SQLite with additive pool configuration, member state, session binding, and request audit migrations
- [x] 1.3 Add authenticated admin CRUD for pools, members, health snapshots, and pool secret hydration without persisting upstream keys
- [x] 1.4 Add migration and legacy-route compatibility tests for fresh and existing usage databases

## 2. Dispatcher and protocol forwarding

- [x] 2.1 Implement session-key derivation, bounded conversation hashing, response-ID affinity, and smooth weighted round-robin selection
- [x] 2.2 Implement member health state transitions, Retry-After/exponential cooldown, recovery, and all-members-unavailable responses
- [x] 2.3 Implement native Responses pool forwarding with selected-member authorization replacement and one pre-response fallback retry
- [x] 2.4 Integrate Chat compatibility pool forwarding while preserving per-member conversation history and no partial-stream retry
- [x] 2.5 Add request-attempt audit recording, final-member usage attribution, and structured sanitized error classification

## 3. Desktop lifecycle and configuration

- [x] 3.1 Extend bridge, preload, and desktop model contracts for pool CRUD, status, and member health
- [x] 3.2 Make environment enable/disable and startup restoration hydrate pools transactionally and keep legacy single-account routing unchanged
- [x] 3.3 Synchronize pool membership after account create/update/copy/delete and environment rename/delete with rollback coverage
- [x] 3.4 Build the environment account-pool editor with member selection, ordering, weights, strategy, TTL, retry limit, and health display

## 4. Observability and release quality

- [x] 4.1 Extend usage request details and filters with pool, final account, failover, attempt count, and reason fields
- [x] 4.2 Add structured router logs and user-facing pool status/error messages without secrets or raw upstream bodies
- [x] 4.3 Add unit and integration tests for sticky sessions, weighted selection, 429/5xx/transport failover, validation errors, streaming boundaries, cooldown recovery, and restart rehydration
- [x] 4.4 Run desktop tests, website checks, production builds, packaged artifact verification, and document rollout/rollback behavior

## 5. Mixed authentication and pool visibility

- [x] 5.1 Generalize memory-only pool credentials for API-key and AUTH members, including ChatGPT account ID forwarding
- [x] 5.2 Enable mixed AUTH/API-key Responses pools and retain API-key-only Chat compatibility pools
- [x] 5.3 Project the local pool Base URL for AUTH accounts without replacing their auth.json credentials
- [x] 5.4 Expose pool membership in overview data and display original upstream URL plus proxy/automatic-distribution badges
- [x] 5.5 Default new pool configuration to Responses and include eligible AUTH accounts
- [x] 5.6 Add mixed-auth routing, persistence, UI, typecheck, regression, and production-build verification
- [x] 5.7 Optimize account runtime columns so Base URL and API-key values use available space and their copy actions remain aligned
- [x] 5.8 Add a scroll-aware top fade so account rows transition softly beneath the fixed summary area
- [x] 5.9 Persist credential-redacted request errors and per-attempt routing audit data, then expose both through request-detail hover diagnostics
- [x] 5.10 Aggregate the latest 60 requests per API-backed account and show success/cache-hit segmented health bars in the account list
- [x] 5.11 Hide internal URLs for native AUTH accounts, recover Chat-compatible upstream URLs, and consolidate independent-model help into one configuration icon
- [x] 5.12 Remove redundant sample-count and past-to-now labels from account request health bars
- [x] 5.13 Label account-pool parameters clearly and add a persisted bounded same-account failure threshold with routing and regression coverage

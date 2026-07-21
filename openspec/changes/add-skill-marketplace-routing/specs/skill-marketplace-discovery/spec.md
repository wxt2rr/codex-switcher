## ADDED Requirements

### Requirement: Skills page and soft navigation
The desktop application SHALL expose a Skills page through the existing soft-navigation model and SHALL restore `?view=skills` on reload.

#### Scenario: Scope strip overflows horizontally
- **WHEN** the number of Codex environments or providers exceeds the available width
- **THEN** the scope strip can scroll horizontally without displaying a scrollbar, and each edge shows a fade only while more scopes remain in that direction

#### Scenario: User navigates to Skills
- **WHEN** the user selects Skills in the desktop sidebar
- **THEN** the application displays the Skills page without launching a new window or reloading the Electron shell

#### Scenario: Skills deep link is restored
- **WHEN** the desktop renderer starts with `?view=skills`
- **THEN** the Skills page is selected as the initial view

### Requirement: Normalized marketplace catalog
The system SHALL normalize records from configured skill catalog adapters into stable IDs, display metadata, source/install URLs, popularity metadata when available, and freshness metadata.

#### Scenario: Popular catalog returns results
- **WHEN** a configured catalog returns a leaderboard page
- **THEN** the page displays skill cards ordered by the selected all-time, trending, hot, or official view using the adapter's normalized values

#### Scenario: Duplicate catalog entries are returned
- **WHEN** multiple adapters return the same normalized source and skill identity
- **THEN** the system displays one merged card while preserving source provenance

### Requirement: Search, filtering, and card details
The Skills page SHALL support search, catalog/source filtering, environment installation-state filtering, and card-based summaries with a detail view.

#### Scenario: User searches for a skill
- **WHEN** the user enters a supported search query
- **THEN** the system requests or filters matching normalized records and shows the query and result count

#### Scenario: User inspects a card
- **WHEN** the user opens a skill card detail
- **THEN** the system shows description, publisher, source, revision or ref, license when known, popularity when known, audit status when known, files or content preview when available, and the external catalog/source links

### Requirement: Catalog refresh and offline cache
The system SHALL cache the last valid response per adapter and query, respect upstream cache/rate-limit metadata, and expose whether displayed results are live or cached.

#### Scenario: Live refresh succeeds
- **WHEN** the user refreshes and the catalog returns a valid response
- **THEN** the system replaces the cache atomically and displays the new retrieval time

#### Scenario: Catalog is unavailable
- **WHEN** a catalog request fails and a valid cached response exists
- **THEN** the system displays cached cards with a stale/offline banner and cache age instead of clearing the page

#### Scenario: No live adapter or cache is available
- **WHEN** a marketplace requires unavailable authentication and no cache exists
- **THEN** the system explains the limitation and offers its external marketplace link plus direct Git/local installation

### Requirement: Catalog adapters do not scrape marketplace HTML
The system MUST use a documented API, documented CLI integration, repository feed, or configured compatible proxy for catalog data and MUST NOT parse marketplace web pages as a data contract.

#### Scenario: skills.sh credentials are unavailable
- **WHEN** the skills.sh adapter cannot obtain a supported desktop-safe API path
- **THEN** the adapter reports itself as link-only and does not attempt HTML scraping

### Requirement: Remote metadata is untrusted
The main process MUST validate catalog payload shape, URLs, identifiers, lengths, and source coordinates before exposing installation actions.

#### Scenario: Catalog returns malformed or unsafe values
- **WHEN** a catalog record contains an invalid URL, path traversal, oversized field, or missing stable identity
- **THEN** the system rejects or sanitizes the record and prevents installation from that record

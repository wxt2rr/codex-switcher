# external-codex-credential-import Specification

## Purpose
TBD - created by archiving change support-sub2api-cpa-json-import. Update Purpose after archive.
## Requirements
### Requirement: Separate Sub2API and CPA import modes
The account creation dialog SHALL expose Sub2API and CPA as separate selectable modes. Both modes SHALL create Codex authorization accounts and SHALL NOT be persisted as runtime authorization modes.

#### Scenario: Select Sub2API
- **WHEN** the user selects the Sub2API mode
- **THEN** the dialog displays a Sub2API credential JSON input and identifies the source as Sub2API

#### Scenario: Select CPA
- **WHEN** the user selects the CPA mode
- **THEN** the dialog displays a CPA credential JSON input and identifies the source as CPA

### Requirement: Source-compatible credential parsing
The system SHALL accept the official Codex credential representations used by the selected source and normalize them without sending credential content to a remote service. Sub2API parsing SHALL support its documented nested-token, flat-token, camel-case, snake-case, raw access-token, JSON array, and line-delimited inputs. CPA parsing SHALL support its documented flat Codex credential object and JSON arrays of those objects.

#### Scenario: Import nested Sub2API tokens
- **WHEN** the user submits a Sub2API object containing `tokens.access_token`, `tokens.refresh_token`, and `tokens.id_token`
- **THEN** the system normalizes the three tokens as one Codex credential

#### Scenario: Import flat CPA credentials
- **WHEN** the user submits a CPA Codex credential containing flat `access_token`, `refresh_token`, `id_token`, and `account_id` fields
- **THEN** the system normalizes the credential as one Codex credential

#### Scenario: Reject a source-incompatible payload
- **WHEN** the submitted content cannot be parsed as the selected source's supported format or lacks an access token
- **THEN** account creation fails with a source-specific validation message and no account is written

### Requirement: Official Codex auth conversion
Each normalized credential SHALL be written using Codex's official ChatGPT `auth.json` structure. The output SHALL set `auth_mode` to `chatgpt`, set `OPENAI_API_KEY` to null, place `access_token`, optional `id_token`, optional `refresh_token`, and optional `account_id` inside `tokens`, and include a valid `last_refresh`.

#### Scenario: Convert a complete credential
- **WHEN** a normalized credential contains access, ID, refresh, and account tokens
- **THEN** all four values are written under the `tokens` object and the resulting account is recognized as an authorization-login account

#### Scenario: Convert a credential without optional tokens
- **WHEN** a supported source supplies an access token without an ID token or refresh token
- **THEN** the system writes a valid Codex ChatGPT auth file containing the access token and omits unavailable optional token fields

### Requirement: Direct validated creation
The dialog SHALL create imported accounts directly without an intermediate preview. The system MUST parse and validate every submitted credential before writing any account. A single credential SHALL use the entered account name, and multiple credentials SHALL receive deterministic unique names derived from the entered account name.

#### Scenario: Create one account
- **WHEN** the user submits one valid credential and clicks the import action
- **THEN** one account is created immediately under the entered account name and the dialog reports success

#### Scenario: Create multiple accounts
- **WHEN** the user submits a valid supported batch containing multiple credentials
- **THEN** all credentials are validated first and each is created with a distinct deterministic account name

#### Scenario: Invalid member in a batch
- **WHEN** any member of a submitted batch is invalid
- **THEN** validation fails before account persistence begins and no member of the batch is written

### Requirement: Official routing and secret safety
Sub2API and CPA imports SHALL use Codex's default official routing. The dialog SHALL hide Base URL and compatibility configuration for both modes. The system SHALL NOT persist the original import payload or include raw token values in logs, error messages, or success messages.

#### Scenario: Import without Base URL
- **WHEN** the user creates an account in Sub2API or CPA mode
- **THEN** no Base URL is requested and the saved runtime configuration uses the default OpenAI Base URL mode

#### Scenario: Report malformed secret input
- **WHEN** a credential payload is malformed
- **THEN** the returned error identifies the invalid format without reproducing token values or the original payload

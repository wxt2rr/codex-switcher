# Usage Refresh and Routed Base URL Design

## Goal

Make usage statistics refresh reliably with configurable frequency, and keep account Base URL presentation meaningful while environment routing is enabled.

## Usage Refresh

- Default refresh frequency is 5 seconds.
- Presets are 1, 3, 5, and 10 seconds, plus a custom integer from 1 through 3600 seconds.
- The control matches the account-page refresh control: manual refresh icon and compact frequency selector in one group.
- Every manual or scheduled refresh rebuilds the selected time window using the current timestamp. A 24-hour filter therefore queries `now - 24h` through `now` on every request.
- Scheduled refresh pauses while the document is hidden.
- A scheduled tick does not start while another usage request is in flight.
- Manual refresh shows the spinning refresh icon and immediately requests a new snapshot.

## Routed Account Presentation

- The runtime Base URL remains the route-specific localhost URL while routing is enabled.
- The router manager exposes a read-only method that returns routes only when the detached service is already healthy. Loading the account page must not start the router service.
- `loadOverview` enriches each routed account with:
  - `enabled: true`
  - `originalBaseUrl`: the exact pre-routing Base URL
  - `localBaseUrl`: the current localhost route URL
- Account rows use `originalBaseUrl` as the primary displayed Base URL when route metadata exists.
- Routed account rows render a localized `已开启代理 / Routed` badge next to the existing account metadata.
- The badge title exposes the localhost route URL for diagnostics.
- When routing is disabled, route metadata disappears, the runtime Base URL is restored, and the badge is removed.

## Data Safety

- Route presentation does not include API keys, request bodies, or response bodies.
- Route lookup failures do not block overview loading; the page falls back to the runtime Base URL.

## Verification

- Pure tests prove refresh windows advance when `now` advances.
- Manager tests prove read-only route lookup does not spawn a missing service.
- View-model/source tests prove routed accounts display the original Base URL and proxy badge contract.
- Web and Electron TypeScript checks, desktop regression tests, and production build must pass.

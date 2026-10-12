# Usage router provider plugin sandbox fix

## Goal

Make managed provider plugins activate in the packaged macOS Electron gateway
process so plugin-backed routes keep their credentials and do not fall back to
unauthenticated upstream requests.

## Tasks

- [done] Use a packaged-Electron-safe plugin launch mode for the usage router while preserving explicit sandbox configuration.
- [done] Make the managed Our Free Model runtime attach to an already-running shared loopback service instead of failing on its lock.
- [done] Rebuild the desktop bundle and verify the `test` Our Free Model route through the running gateway.
- [done] Record the verification result and remaining limitations.

## Verification

- The packaged macOS gateway now starts a second provider-plugin host without
  the Electron Framework sandbox failure.
- The `test` route for `our-free-model:mimo-v2.6-flash-free` returned HTTP 200
  through `127.0.0.1:17832`; the router event recorded a successful attempt.
- `ling-3.1-flash-free` still returns the provider's own `502 Endpoint is
  unavailable` response, so that model is currently unavailable upstream even
  though catalogue discovery lists it.

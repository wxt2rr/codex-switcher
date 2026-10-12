# CSW Our Free Model

Official Codex Switcher Provider plugin for public/free model pools.

The plugin has no required credential. Configure the upstream with:

- `CSW_OUR_FREE_MODEL_BASE_URL`: OpenAI-compatible base URL.
- `CSW_OUR_FREE_MODEL_MODELS_URL`: optional model catalogue endpoint.
- `CSW_OUR_FREE_MODEL_FALLBACK_MODELS`: comma-separated ids or a JSON model array used when discovery is unavailable.
- `CSW_OUR_FREE_MODEL_QUOTA_URL`: optional quota endpoint.
- `CSW_OUR_FREE_MODEL_TIMEOUT_MS`: discovery/quota timeout, default 10000ms.

Model discovery is dynamic per account identity, deduplicated, and retains the last successful result. If the endpoint is unavailable, the last successful catalogue is returned; on first use the configured fallback catalogue is returned instead. The gateway still owns protocol conversion, account binding, routing, retries, and usage accounting.

The same values can be configured from the plugin details panel without
environment variables: `baseUrl`, `modelsUrl`, `quotaUrl`, and
`fallbackModels`. The host encrypts plugin settings at rest and does not
echo secret fields back to the renderer.

The plugin also implements the Provider custom-request hook. It forwards
JSON responses as objects and normalizes JSON Server-Sent Events into the
host's event list, so the gateway still owns the client-facing SSE framing,
protocol conversion, retries, and usage accounting.

# `@codex-switcher/plugin-sdk`

The public SDK for Codex Switcher Provider and Gateway Middleware plugins.
Plugins are ordinary Node ESM processes that communicate with the desktop host
over newline-delimited JSON-RPC. The host owns credentials, routing, protocol
conversion, usage accounting, permissions, signatures, and the OS sandbox.

## Provider plugin

```js
import { startCswPluginServer } from "@codex-switcher/plugin-sdk";

startCswPluginServer({
  provider: {
    describe() {
      return {
        id: "my-provider",
        displayName: "My Provider",
        authMethods: ["api_key"],
        endpoints: [{ protocol: "responses", baseUrl: "https://api.example/v1", modelsPath: "/models" }],
      };
    },
    async models({ account, secret, settings }) {
      return [{ id: "my-model", protocols: ["responses"], source: "discovery" }];
    },
    async request({ url, method, headers, body }) {
      const response = await fetch(url, { method, headers, body });
      const payload = await response.json();
      return { status: response.status, body: payload };
    },
  },
});
```

`request` is optional. Use it when an upstream needs provider-specific
signing, authentication, retries, or a non-standard response envelope. Return
`events` for a normalized stream; the host writes the client-facing SSE and
continues to own middleware, conversion, usage, and retry policy.

## Middleware plugin

Implement `describe`, `onRequest`, `onEvent`, and/or `onResponse` to transform
the shared gateway envelope. Middleware is fail-open for crashes and timeouts;
return `reject` only when rejection is intentional. Do not read desktop state
or credentials directly.

## Manifest and permissions

Every plugin needs `plugin.json` with `apiVersion`, `entry`, and at least one
capability permission (`provider` or `middleware`). Request `network`,
`filesystem`, or `secrets` only when required. The desktop UI shows these
permissions before installation; signed and verified market packages are
revalidated on every activation.

The repository contains a runnable template at
`examples/plugins/csw-demo`. Run `npm run plugin-sdk:example:test` to validate
its JSON-RPC handshake without starting the desktop app.

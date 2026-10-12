# CSW Our Free Model

Official Codex Switcher provider plugin for Our Free Model.

The plugin follows the managed-provider design used by
[`magpie-our-free-model`](https://github.com/mu-zi-lee/magpie-our-free-model):

- enabling the plugin starts the embedded Our Free Model service;
- the service listens on `127.0.0.1` and chooses the configured or default
  local port (`18900`);
- the forward API key is generated and stored by the embedded service;
- model discovery is read from the local service and is refreshed by it;
- Responses, Chat Completions, and Anthropic Messages requests are forwarded
  through the managed service;
- the plugin details page opens the local Our Free Model management console;
- stopping or restarting the plugin stops and recreates the local service.

No Base URL, Models URL, quota URL, or API key is required from the user. The
Codex Switcher host gives the plugin a private data directory, so service
state is kept outside the installed package and survives plugin restarts.
`CSW_OUR_FREE_MODEL_DATA_DIR` and `CSW_OUR_FREE_MODEL_PORT` are
developer/packaging overrides only; they are not part of normal setup.

The embedded upstream is vendored from the Our Free Model standalone service;
see `OFM-NOTICE.md` and `vendor/ofm/LICENSE` for attribution and licensing.

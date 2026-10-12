# CSW Demo Provider Plugin

This is the smallest complete Provider plugin: a `plugin.json` manifest, an
ordinary Node ESM entrypoint, and the public `@codex-switcher/plugin-sdk`
JSONL server. Copy the directory, change the provider descriptor, and install
it from the desktop Plugins page or with the local plugin manager.

The plugin process never receives prompts. It only receives the account and
secret fields required by the declared Provider operation, subject to the
manifest permission boundary.

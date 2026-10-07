function profile(input) {
    return {
        id: input.id,
        displayName: input.displayName,
        configPath: input.configPath,
        format: input.format ?? "json",
        defaultProtocol: input.protocol ?? "responses",
        modelPath: input.modelPath ?? "model",
        baseUrlPath: input.baseUrlPath ?? "base_url",
        tokenPath: input.tokenPath ?? "api_key",
        ...(input.reasoningPath ? { reasoningPath: input.reasoningPath } : {}),
        ...(input.fallbackModelPath ? { fallbackModelPath: input.fallbackModelPath } : {}),
        ...(input.subAgentModelPath ? { subAgentModelPath: input.subAgentModelPath } : {}),
        aliases: input.aliases ?? [],
        supports: { tools: true, reasoning: true, vision: true, streaming: true },
    };
}
export const BUILT_IN_AGENT_PROFILES = [
    profile({ id: "claude", displayName: "Claude Code", configPath: ".claude/settings.json", protocol: "anthropic", baseUrlPath: "env.ANTHROPIC_BASE_URL", tokenPath: "env.ANTHROPIC_API_KEY", aliases: ["claude-code"] }),
    profile({ id: "claude-desktop", displayName: "Claude Desktop", configPath: ".config/Claude/claude_desktop_config.json", protocol: "anthropic", baseUrlPath: "env.ANTHROPIC_BASE_URL", tokenPath: "env.ANTHROPIC_API_KEY" }),
    profile({ id: "codex", displayName: "Codex", configPath: ".codex/config.toml", format: "toml", protocol: "responses", baseUrlPath: "openai_base_url", tokenPath: "OPENAI_API_KEY", reasoningPath: "model_reasoning_effort" }),
    profile({ id: "gemini", displayName: "Gemini CLI", configPath: ".gemini/settings.json", protocol: "gemini", baseUrlPath: "baseUrl", tokenPath: "apiKey", aliases: ["gemini-cli"] }),
    profile({ id: "agy", displayName: "Agy", configPath: ".agy/config.json" }),
    profile({ id: "opencode", displayName: "OpenCode", configPath: ".config/opencode/opencode.json", baseUrlPath: "provider.codex-switcher.options.baseURL", modelPath: "model", tokenPath: "provider.codex-switcher.options.apiKey" }),
    profile({ id: "openchamber", displayName: "OpenChamber", configPath: ".config/openchamber/config.json", baseUrlPath: "provider.baseUrl", tokenPath: "provider.apiKey" }),
    profile({ id: "mimocode", displayName: "MiMo Code", configPath: ".config/mimocode/config.json", baseUrlPath: "provider.codex-switcher.baseURL", tokenPath: "provider.codex-switcher.apiKey" }),
    profile({ id: "pi", displayName: "Pi", configPath: ".pi/agent/config.json", baseUrlPath: "provider.baseUrl", tokenPath: "provider.apiKey" }),
    profile({ id: "aside", displayName: "Aside", configPath: ".aside/config.json" }),
    profile({ id: "omo", displayName: "OmO", configPath: ".config/omo/config.json" }),
    profile({ id: "goose", displayName: "Goose", configPath: ".config/goose/config.yaml", format: "yaml", baseUrlPath: "GOOSE_PROVIDER_BASE_URL", tokenPath: "GOOSE_API_KEY" }),
    profile({ id: "cursor", displayName: "Cursor", configPath: ".cursor/config.json" }),
    profile({ id: "cursor-local", displayName: "Cursor CLI", configPath: ".cursor-cli/config.json" }),
    profile({ id: "zed", displayName: "Zed", configPath: ".config/zed/settings.json", baseUrlPath: "language_models.openai.api_url", tokenPath: "language_models.openai.api_key" }),
    profile({ id: "vscode", displayName: "VS Code / Copilot", configPath: ".config/Code/User/settings.json", baseUrlPath: "github.copilot.chat.proxy", tokenPath: "github.copilot.chat.apiKey" }),
    profile({ id: "vscode-insiders", displayName: "VS Code Insiders", configPath: ".config/Code - Insiders/User/settings.json", baseUrlPath: "github.copilot.chat.proxy", tokenPath: "github.copilot.chat.apiKey" }),
    profile({ id: "air", displayName: "Air", configPath: ".config/air/config.json" }),
    profile({ id: "copilot", displayName: "GitHub Copilot CLI", configPath: ".config/copilot/config.json" }),
    profile({ id: "crush", displayName: "Crush", configPath: ".config/crush/crush.json" }),
    profile({ id: "dsh", displayName: "DeepSeek Harness", configPath: ".config/dsh/config.yaml", format: "yaml", baseUrlPath: "config.providers.codex-switcher.baseURL", tokenPath: "config.providers.codex-switcher.apiKey" }),
    profile({ id: "commandcode", displayName: "Command Code", configPath: ".commandcode/config.json" }),
    profile({ id: "fx", displayName: "fx", configPath: ".config/fx/config.json" }),
    profile({ id: "omp", displayName: "omp", configPath: ".omp/config.json" }),
    profile({ id: "devin", displayName: "Devin", configPath: ".config/devin/config.json" }),
    profile({ id: "hermes", displayName: "Hermes Agent", configPath: ".config/hermes/config.json" }),
    profile({ id: "morph", displayName: "Mister Morph", configPath: ".config/morph/config.json" }),
    profile({ id: "kimi", displayName: "Kimi Code", configPath: ".config/kimi/config.toml", format: "toml", protocol: "chat_completions" }),
    profile({ id: "muse", displayName: "Muse Code", configPath: ".config/muse/config.json" }),
    profile({ id: "empryo", displayName: "Empryo", configPath: ".config/empryo/config.json" }),
    profile({ id: "minimax-code", displayName: "MiniMax Code", configPath: ".config/minimax/config.json" }),
    profile({ id: "droid", displayName: "Droid", configPath: ".factory/droid/config.json" }),
    profile({ id: "cline", displayName: "Cline", configPath: ".config/cline/config.json" }),
    profile({ id: "qoder", displayName: "Qoder", configPath: ".config/qoder/config.json" }),
    profile({ id: "qoder-cn", displayName: "Qoder CN", configPath: ".config/qoder-cn/config.json" }),
    profile({ id: "grok", displayName: "Grok Build", configPath: ".config/grok/config.json" }),
    profile({ id: "zcode", displayName: "ZCode", configPath: ".zcode/config.json" }),
    profile({ id: "workbuddy", displayName: "WorkBuddy", configPath: ".workbuddy/config.json" }),
    profile({ id: "pencil", displayName: "Pencil", configPath: ".pencil/config.json" }),
    profile({ id: "t3code", displayName: "T3 Code", configPath: ".t3code/config.json" }),
    profile({ id: "hanako", displayName: "OpenHanako", configPath: ".hanako/config.json" }),
    profile({ id: "atomcode", displayName: "AtomCode", configPath: ".atomcode/config.json" }),
    profile({ id: "alma", displayName: "Alma", configPath: ".alma/config.json" }),
    profile({ id: "cindy", displayName: "Cindy", configPath: ".cindy/config.json" }),
];
export const AGENT_PROFILE_BY_ID = new Map(BUILT_IN_AGENT_PROFILES.map((item) => [item.id, item]));
export function getAgentProfile(id) {
    const result = AGENT_PROFILE_BY_ID.get(id);
    if (!result)
        throw new Error(`Unknown gateway agent '${id}'`);
    return result;
}
//# sourceMappingURL=profiles.js.map
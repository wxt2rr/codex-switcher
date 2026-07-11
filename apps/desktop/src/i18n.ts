export type UiLanguage = "zh" | "en" | "ja";

type TranslationTree = {
  brand: string;
  nav: {
    overview: string;
    environments: string;
    accounts: string;
    usage: string;
    operations: string;
  };
  topbar: {
    cliTarget: string;
    appTarget: string;
    language: string;
  };
  hero: {
    title: string;
    subtitle: string;
    generated: string;
    env: string;
    refresh: string;
  };
  message: {
    switchingEnv: string;
    switchedEnv: string;
    switchingAccount: string;
    switchedAccount: string;
    envNameRequired: string;
    creatingEnv: string;
    envCreated: string;
    runtimeRequiresInput: string;
    envPathRequired: string;
    updatingRuntime: string;
    runtimeUpdated: string;
    runningOperation: string;
    operationCompleted: string;
    envDeleted: string;
    envUpdatedDone: string;
    envConfigUpdated: string;
    independentModelUpdated: string;
    loginCompleted: string;
    reloginCompleted: string;
    accountLoggedOut: string;
    accountDeleted: string;
    proxyLoaded: string;
    proxyUpdated: string;
    proxyDisabled: string;
    proxyTestCompleted: string;
    tokenRefreshStarted: string;
    tokenRefreshStopped: string;
    tokenRefreshStatusLoaded: string;
    tokenRefreshRunCompleted: string;
    cliOpenedInTerminal: string;
    opsListLoaded: string;
    appStatusLoaded: string;
    appLoggedOut: string;
    appStoppedManaged: string;
    defaultImported: string;
    doctorCompleted: string;
    recoverCompleted: string;
    switcherLogLoaded: string;
    tokenRefreshLogLoaded: string;
    unknownError: string;
  };
  section: {
    activeAccounts: string;
    recentTasks: string;
    environments: string;
    refreshGuard: string;
    switchCliEnv: string;
    switchAppEnv: string;
    switchCliAccount: string;
    switchAppAccount: string;
    createEnvironment: string;
    updateRuntime: string;
    operations: string;
    operationOutput: string;
    advancedCommands: string;
    logs: string;
  };
  labels: {
    status: string;
    reloginNeeded: string;
    authExpiry: string;
    noOperationYet: string;
    current: string;
    standby: string;
    cli: string;
    app: string;
    cliAndApp: string;
    loggedIn: string;
    notLoggedIn: string;
    unknown: string;
    loading: string;
    retry: string;
    loadFailed: string;
    authMode: string;
    apiKeyMode: string;
    sub2apiMode: string;
    chatgptMode: string;
    defaultValue: string;
    customValue: string;
    emptySource: string;
    switcherLog: string;
    tokenRefreshLog: string;
    switch: string;
    createEnv: string;
    updateRuntime: string;
    runCommand: string;
    openTerminal: string;
    loadLog: string;
    usageExpired: string;
    usageUnauthorized: string;
    usageNetworkFailed: string;
    usageApiFailed: string;
  };
  inputs: {
    newEnv: string;
    envName: string;
    accountName: string;
    baseUrl: string;
    commandScope: string;
    commandAction: string;
    commandArgs: string;
  };
  operations: Record<string, string>;
};

export const DEFAULT_LANGUAGE: UiLanguage = "en";
export const SUPPORTED_LANGUAGES: UiLanguage[] = ["zh", "en", "ja"];

export const LANGUAGE_LABELS: Record<UiLanguage, string> = {
  zh: "简体中文",
  en: "English",
  ja: "日本語",
};

const translations: Record<UiLanguage, TranslationTree> = {
  zh: {
    brand: "codex-switcher",
    nav: {
      overview: "总览",
      environments: "环境",
      accounts: "账号",
      usage: "用量",
      operations: "设置",
    },
    topbar: {
      cliTarget: "CLI 目标",
      appTarget: "App 目标",
      language: "语言",
    },
    hero: {
      title: "Codex 切换的桌面控制台。",
      subtitle: "基于 core 的总览、稳定的账号上下文，以及清晰的任务操作。",
      generated: "生成时间",
      env: "环境",
      refresh: "刷新",
    },
    message: {
      switchingEnv: "正在切换 {target} 环境到 {env}...",
      switchedEnv: "{target} 环境已切换到 {env}",
      switchingAccount: "正在切换 {target} 账号到 {env}/{account}...",
      switchedAccount: "{target} 账号已切换到 {env}/{account}",
      envNameRequired: "必须填写环境名",
      creatingEnv: "正在创建环境 {env}...",
      envCreated: "环境已创建: {env}",
      runtimeRequiresInput: "更新运行时必须填写环境和账号",
      envPathRequired: "必须填写环境路径",
      updatingRuntime: "正在更新 {env}/{account} 的运行时...",
      runtimeUpdated: "{env}/{account} 的运行时已更新",
      runningOperation: "正在执行 {label}...",
      operationCompleted: "{label} 已完成",
      envDeleted: "环境已删除: {env}",
      envUpdatedDone: "环境已更新: {env}",
      envConfigUpdated: "{env} 配置已更新",
      independentModelUpdated: "{env}/{account} 的独立 Model 配置已更新",
      loginCompleted: "账号已登录: {env}/{account}",
      reloginCompleted: "账号已重新登录: {env}/{account}",
      accountLoggedOut: "账号已登出: {env}/{account}",
      accountDeleted: "账号已删除: {env}/{account}",
      proxyLoaded: "代理状态已加载",
      proxyUpdated: "代理已更新",
      proxyDisabled: "代理已关闭",
      proxyTestCompleted: "代理测试已完成",
      tokenRefreshStarted: "刷新守卫已启动",
      tokenRefreshStopped: "刷新守卫已停止",
      tokenRefreshStatusLoaded: "刷新守卫状态已加载",
      tokenRefreshRunCompleted: "令牌刷新扫描已完成",
      cliOpenedInTerminal: "已打开 CLI 会话",
      opsListLoaded: "系统操作状态已加载",
      appStatusLoaded: "App 状态已加载",
      appLoggedOut: "App 账号已登出",
      appStoppedManaged: "托管 App 已停止",
      defaultImported: "已导入默认环境到 {env}",
      doctorCompleted: "诊断修复已完成",
      recoverCompleted: "环境恢复已完成",
      switcherLogLoaded: "switcher 日志已加载",
      tokenRefreshLogLoaded: "token-refresh 日志已加载",
      unknownError: "未知错误",
    },
    section: {
      activeAccounts: "当前账号",
      recentTasks: "最近任务",
      environments: "环境列表",
      refreshGuard: "刷新守卫",
      switchCliEnv: "切换 CLI 环境",
      switchAppEnv: "切换 App 环境",
      switchCliAccount: "切换 CLI 账号",
      switchAppAccount: "切换 App 账号",
      createEnvironment: "创建环境",
      updateRuntime: "更新运行时 Base URL",
      operations: "操作",
      operationOutput: "操作输出",
      advancedCommands: "高级命令",
      logs: "日志",
    },
    labels: {
      status: "状态",
      reloginNeeded: "需要重新登录",
      authExpiry: "认证过期时间",
      noOperationYet: "还没有执行任何操作。",
      current: "当前",
      standby: "待命",
      cli: "CLI",
      app: "App",
      cliAndApp: "CLI + App",
      loggedIn: "已登录",
      notLoggedIn: "未登录",
      unknown: "未知",
      loading: "加载中...",
      retry: "重试",
      loadFailed: "数据加载失败",
      authMode: "授权登录",
      apiKeyMode: "API Key",
      sub2apiMode: "sub2api",
      chatgptMode: "chatgpt",
      defaultValue: "默认",
      customValue: "自定义",
      emptySource: "空白",
      switcherLog: "switcher 日志",
      tokenRefreshLog: "token-refresh 日志",
      switch: "切换",
      createEnv: "创建环境",
      updateRuntime: "更新运行时",
      runCommand: "执行命令",
      openTerminal: "打开 CLI 会话",
      loadLog: "读取日志",
      usageExpired: "已过期",
      usageUnauthorized: "未授权",
      usageNetworkFailed: "网络失败",
      usageApiFailed: "接口失败",
    },
    inputs: {
      newEnv: "新环境名",
      envName: "环境名",
      accountName: "账号名",
      baseUrl: "https://api.example.test/v1 或 default",
      commandScope: "scope，如 account / env / ops / app / cli",
      commandAction: "action，如 login / remove / status",
      commandArgs: "参数，使用空格分隔",
    },
    operations: {
      "proxy-test": "代理测试",
      "token-refresh-run-once": "刷新令牌",
      "doctor-fix": "诊断修复",
      "recover-dry-run": "恢复预演",
      "cli-launch-current": "启动 CLI",
      "app-restart-current": "重启 App",
      "app-launch-new": "启动新 App",
    },
  },
  en: {
    brand: "codex-switcher",
    nav: {
      overview: "Overview",
      environments: "Environments",
      accounts: "Accounts",
      usage: "Usage",
      operations: "Settings",
    },
    topbar: {
      cliTarget: "CLI Target",
      appTarget: "App Target",
      language: "Language",
    },
    hero: {
      title: "Desktop control for Codex switching.",
      subtitle: "Core-backed overview, stable account context, and explicit task presentation.",
      generated: "Generated",
      env: "Env",
      refresh: "Refresh",
    },
    message: {
      switchingEnv: "Switching {target} env to {env}...",
      switchedEnv: "{target} env switched to {env}",
      switchingAccount: "Switching {target} account to {env}/{account}...",
      switchedAccount: "{target} account switched to {env}/{account}",
      envNameRequired: "Environment name is required",
      creatingEnv: "Creating environment {env}...",
      envCreated: "Environment created: {env}",
      runtimeRequiresInput: "Runtime update requires env and account",
      envPathRequired: "Environment path is required",
      updatingRuntime: "Updating runtime for {env}/{account}...",
      runtimeUpdated: "Runtime updated for {env}/{account}",
      runningOperation: "Running {label}...",
      operationCompleted: "{label} completed",
      envDeleted: "Environment deleted: {env}",
      envUpdatedDone: "Environment updated: {env}",
      envConfigUpdated: "{env} config updated",
      independentModelUpdated: "Independent model updated for {env}/{account}",
      loginCompleted: "Logged in account: {env}/{account}",
      reloginCompleted: "Signed in again: {env}/{account}",
      accountLoggedOut: "Logged out account: {env}/{account}",
      accountDeleted: "Deleted account: {env}/{account}",
      proxyLoaded: "Proxy status loaded",
      proxyUpdated: "Proxy updated",
      proxyDisabled: "Proxy disabled",
      proxyTestCompleted: "Proxy test completed",
      tokenRefreshStarted: "Token refresh guard started",
      tokenRefreshStopped: "Token refresh guard stopped",
      tokenRefreshStatusLoaded: "Token refresh status loaded",
      tokenRefreshRunCompleted: "Token refresh scan completed",
      cliOpenedInTerminal: "CLI session opened",
      opsListLoaded: "Operations status loaded",
      appStatusLoaded: "App status loaded",
      appLoggedOut: "App account logged out",
      appStoppedManaged: "Managed app stopped",
      defaultImported: "Imported default environment into {env}",
      doctorCompleted: "Diagnostics completed",
      recoverCompleted: "Setup repaired",
      switcherLogLoaded: "Switcher log loaded",
      tokenRefreshLogLoaded: "Token-refresh log loaded",
      unknownError: "Unknown error",
    },
    section: {
      activeAccounts: "Active Accounts",
      recentTasks: "Recent Tasks",
      environments: "Environments",
      refreshGuard: "Refresh Guard",
      switchCliEnv: "Switch CLI Env",
      switchAppEnv: "Switch App Env",
      switchCliAccount: "Switch CLI Account",
      switchAppAccount: "Switch App Account",
      createEnvironment: "Create Environment",
      updateRuntime: "Update Runtime Base URL",
      operations: "Operations",
      operationOutput: "Operation Output",
      advancedCommands: "Advanced Commands",
      logs: "Logs",
    },
    labels: {
      status: "Status",
      reloginNeeded: "Re-login Needed",
      authExpiry: "Auth Expiry",
      noOperationYet: "No operation run yet.",
      current: "current",
      standby: "standby",
      cli: "CLI",
      app: "App",
      cliAndApp: "CLI + App",
      loggedIn: "logged-in",
      notLoggedIn: "not-logged-in",
      unknown: "unknown",
      loading: "Loading...",
      retry: "Retry",
      loadFailed: "Unable to load data",
      authMode: "Auth",
      apiKeyMode: "API Key",
      sub2apiMode: "sub2api",
      chatgptMode: "chatgpt",
      defaultValue: "Default",
      customValue: "Custom",
      emptySource: "Empty",
      switcherLog: "switcher log",
      tokenRefreshLog: "token-refresh log",
      switch: "Switch",
      createEnv: "Create Env",
      updateRuntime: "Update Runtime",
      runCommand: "Run Command",
      openTerminal: "Open CLI Session",
      loadLog: "Load Log",
      usageExpired: "expired",
      usageUnauthorized: "unauthorized",
      usageNetworkFailed: "network failed",
      usageApiFailed: "api failed",
    },
    inputs: {
      newEnv: "new-env",
      envName: "env name",
      accountName: "account name",
      baseUrl: "https://api.example.test/v1 or default",
      commandScope: "scope, e.g. account / env / ops / app / cli",
      commandAction: "action, e.g. login / remove / status",
      commandArgs: "arguments separated by spaces",
    },
    operations: {
      "proxy-test": "Proxy Test",
      "token-refresh-run-once": "Token Refresh",
      "doctor-fix": "Diagnostics",
      "recover-dry-run": "Repair Preview",
      "cli-launch-current": "Launch CLI",
      "app-restart-current": "Restart App",
      "app-launch-new": "Launch App",
    },
  },
  ja: {
    brand: "codex-switcher",
    nav: {
      overview: "概要",
      environments: "環境",
      accounts: "アカウント",
      usage: "使用量",
      operations: "設定",
    },
    topbar: {
      cliTarget: "CLI ターゲット",
      appTarget: "App ターゲット",
      language: "言語",
    },
    hero: {
      title: "Codex 切り替えのデスクトップコントロール。",
      subtitle: "core ベースの概要、安定したアカウント文脈、明示的なタスク操作を提供します。",
      generated: "生成時刻",
      env: "環境",
      refresh: "更新",
    },
    message: {
      switchingEnv: "{target} の環境を {env} に切り替えています...",
      switchedEnv: "{target} の環境を {env} に切り替えました",
      switchingAccount: "{target} のアカウントを {env}/{account} に切り替えています...",
      switchedAccount: "{target} のアカウントを {env}/{account} に切り替えました",
      envNameRequired: "環境名は必須です",
      creatingEnv: "環境 {env} を作成しています...",
      envCreated: "環境を作成しました: {env}",
      runtimeRequiresInput: "ランタイム更新には環境名とアカウント名が必要です",
      envPathRequired: "環境パスは必須です",
      updatingRuntime: "{env}/{account} のランタイムを更新しています...",
      runtimeUpdated: "{env}/{account} のランタイムを更新しました",
      runningOperation: "{label} を実行しています...",
      operationCompleted: "{label} が完了しました",
      envDeleted: "環境を削除しました: {env}",
      envUpdatedDone: "環境を更新しました: {env}",
      envConfigUpdated: "{env} の設定を更新しました",
      independentModelUpdated: "{env}/{account} の独立 Model 設定を更新しました",
      loginCompleted: "アカウントをログインしました: {env}/{account}",
      reloginCompleted: "アカウントを再ログインしました: {env}/{account}",
      accountLoggedOut: "アカウントをログアウトしました: {env}/{account}",
      accountDeleted: "アカウントを削除しました: {env}/{account}",
      proxyLoaded: "プロキシ状態を読み込みました",
      proxyUpdated: "プロキシを更新しました",
      proxyDisabled: "プロキシを無効化しました",
      proxyTestCompleted: "プロキシテストが完了しました",
      tokenRefreshStarted: "更新ガードを開始しました",
      tokenRefreshStopped: "更新ガードを停止しました",
      tokenRefreshStatusLoaded: "更新ガード状態を読み込みました",
      tokenRefreshRunCompleted: "トークン更新スキャンが完了しました",
      cliOpenedInTerminal: "CLI セッションを開きました",
      opsListLoaded: "システム操作状態を読み込みました",
      appStatusLoaded: "App 状態を読み込みました",
      appLoggedOut: "App アカウントをログアウトしました",
      appStoppedManaged: "管理 App を停止しました",
      defaultImported: "{env} にデフォルト環境を取り込みました",
      doctorCompleted: "診断修復が完了しました",
      recoverCompleted: "環境復旧が完了しました",
      switcherLogLoaded: "switcher ログを読み込みました",
      tokenRefreshLogLoaded: "token-refresh ログを読み込みました",
      unknownError: "不明なエラー",
    },
    section: {
      activeAccounts: "有効なアカウント",
      recentTasks: "最近のタスク",
      environments: "環境一覧",
      refreshGuard: "更新ガード",
      switchCliEnv: "CLI 環境を切り替え",
      switchAppEnv: "App 環境を切り替え",
      switchCliAccount: "CLI アカウントを切り替え",
      switchAppAccount: "App アカウントを切り替え",
      createEnvironment: "環境を作成",
      updateRuntime: "ランタイム Base URL を更新",
      operations: "操作",
      operationOutput: "操作出力",
      advancedCommands: "高度なコマンド",
      logs: "ログ",
    },
    labels: {
      status: "状態",
      reloginNeeded: "再ログイン必要数",
      authExpiry: "認証期限",
      noOperationYet: "まだ操作は実行されていません。",
      current: "現在",
      standby: "待機",
      cli: "CLI",
      app: "App",
      cliAndApp: "CLI + App",
      loggedIn: "ログイン済み",
      notLoggedIn: "未ログイン",
      unknown: "不明",
      loading: "読み込み中...",
      retry: "再试行",
      loadFailed: "データの読み込みに失敗しました",
      authMode: "認証ログイン",
      apiKeyMode: "API Key",
      sub2apiMode: "sub2api",
      chatgptMode: "chatgpt",
      defaultValue: "デフォルト",
      customValue: "カスタム",
      emptySource: "空",
      switcherLog: "switcher ログ",
      tokenRefreshLog: "token-refresh ログ",
      switch: "切替",
      createEnv: "環境を作成",
      updateRuntime: "ランタイム更新",
      runCommand: "コマンド実行",
      openTerminal: "CLI セッションを開く",
      loadLog: "ログを読む",
      usageExpired: "期限切れ",
      usageUnauthorized: "未認証",
      usageNetworkFailed: "ネットワーク失敗",
      usageApiFailed: "API 失敗",
    },
    inputs: {
      newEnv: "新しい環境名",
      envName: "環境名",
      accountName: "アカウント名",
      baseUrl: "https://api.example.test/v1 または default",
      commandScope: "scope 例: account / env / ops / app / cli",
      commandAction: "action 例: login / remove / status",
      commandArgs: "引数をスペース区切りで入力",
    },
    operations: {
      "proxy-test": "プロキシテスト",
      "token-refresh-run-once": "トークン更新",
      "doctor-fix": "診断修復",
      "recover-dry-run": "復旧ドライラン",
      "cli-launch-current": "CLI を起動",
      "app-restart-current": "App を再起動",
      "app-launch-new": "新しい App を起動",
    },
  },
};

export function getTranslations(language: UiLanguage): TranslationTree {
  return translations[language] ?? translations[DEFAULT_LANGUAGE];
}

export function normalizeLanguage(value: string | undefined): UiLanguage {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/_/g, "-");

  for (const language of SUPPORTED_LANGUAGES) {
    if (normalized === language || normalized.startsWith(`${language}-`)) {
      return language;
    }
  }

  return DEFAULT_LANGUAGE;
}

export function translate(
  template: string,
  values: Record<string, string>,
): string {
  return template.replace(/\{(\w+)\}/g, (_match, key: string) => values[key] ?? "");
}

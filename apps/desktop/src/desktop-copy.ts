import type { UiLanguage } from "./i18n";

type DesktopCopy = {
  common: {
    close: string;
    cancel: string;
    result: string;
    resultSubtitle: string;
    tools: string;
    shellSubtitle: string;
    refreshing: string;
    cliCurrent: string;
    appCurrent: string;
    current: string;
    idle: string;
    standby: string;
    loaded: string;
    empty: string;
    environment: string;
    account: string;
    status: string;
    actions: string;
    rawOutput: string;
    itemsSuffix: string;
  };
  overview: {
    eyebrow: string;
    title: string;
    description: string;
    pendingTitle: string;
    pendingEmpty: string;
    activeAccountsTitle: string;
    noActiveAccounts: string;
    targetColumn: string;
    currentColumn: string;
    loginStateColumn: string;
    emailColumn: string;
    usage5hColumn: string;
    usageWeeklyColumn: string;
    authColumn: string;
    actionColumn: string;
    keepCurrent: string;
    generated: string;
    guard: string;
    contextTitle: string;
    contextSubtitle: string;
    pendingSubtitle: string;
    cliLabel: string;
    appLabel: string;
  };
  environments: {
    eyebrow: string;
    title: string;
    description: string;
    create: string;
    total: string;
    searchPlaceholder: string;
    all: string;
    active: string;
    listTitle: string;
    listSubtitle: string;
    nameColumn: string;
    pathColumn: string;
    countColumn: string;
    edit: string;
    editTitle: string;
    config: string;
    configTitle: string;
    save: string;
    createTitle: string;
    createDescription: string;
    createHint: string;
    source: string;
    switchCli: string;
    switchApp: string;
    delete: string;
    deleteTitle: string;
    deleteDescription: string;
    deleteConfirm: string;
    deleteMissing: string;
    importDefault: string;
    emptyOutput: string;
    nonCurrent: string;
    emptyListTitle: string;
    emptyListDescription: string;
    emptyFilterTitle: string;
    emptyFilterDescription: string;
  };
  accounts: {
    eyebrow: string;
    title: string;
    description: string;
    create: string;
    total: string;
    allEnvironments: string;
    allModes: string;
    searchPlaceholder: string;
    listTitle: string;
    listSubtitle: string;
    accountColumn: string;
    environmentColumn: string;
    authColumn: string;
    runtimeColumn: string;
    stateColumn: string;
    loginTitle: string;
    loginDescription: string;
    runtimeTitle: string;
    runtimeDescription: string;
    runtimeAction: string;
    setCliAction: string;
    setAppAction: string;
    login: string;
    relogin: string;
    logout: string;
    logoutTitle: string;
    logoutDescription: string;
    logoutConfirm: string;
    logoutMissing: string;
    delete: string;
    deleteTitle: string;
    deleteDescription: string;
    deleteConfirm: string;
    deleteMissing: string;
    emptyOutput: string;
    managedAccount: string;
    subscriptionLabel: string;
    baseUrlLabel: string;
    keyLabel: string;
    target: string;
    mode: string;
    baseUrlMode: string;
    sub2api: string;
    apiKey: string;
    independentModel: string;
    independentModelNotSet: string;
    modelConfig: string;
    modelConfigTitle: string;
    modelConfigDescription: string;
    modelProvider: string;
    modelApiKey: string;
    modelBaseUrl: string;
    both: string;
    custom: string;
    defaultValue: string;
    emptyListTitle: string;
    emptyListDescription: string;
    emptyFilterTitle: string;
    emptyFilterDescription: string;
  };
  operations: {
    eyebrow: string;
    title: string;
    description: string;
    refreshStatus: string;
    guard: string;
    needRelogin: string;
    appProcess: string;
    proxyTitle: string;
    proxySubtitle: string;
    proxyAddress: string;
    proxyPlaceholder: string;
    proxyShow: string;
    proxySet: string;
    proxyOff: string;
    proxyTest: string;
    guardTitle: string;
    guardSubtitle: string;
    guardStart: string;
    guardStop: string;
    guardStatus: string;
    guardRunOnce: string;
    diagnoseTitle: string;
    diagnoseSubtitle: string;
    cliLaunch: string;
    opsList: string;
    appStatus: string;
    appLogout: string;
    appStopManaged: string;
    doctor: string;
    recover: string;
    advancedTitle: string;
    advancedSubtitle: string;
    logKind: string;
    readLog: string;
    scope: string;
    action: string;
    args: string;
    runCommand: string;
    openTerminal: string;
    emptyOutput: string;
  };
};

const copy: Record<UiLanguage, DesktopCopy> = {
  zh: {
    common: {
      close: "关闭",
      cancel: "取消",
      result: "结果",
      resultSubtitle: "先看结构化反馈，再查看原始输出。",
      tools: "工具",
      shellSubtitle: "桌面控制台，负责环境、账号和运行时管理。",
      refreshing: "刷新中...",
      cliCurrent: "CLI 当前",
      appCurrent: "App 当前",
      current: "当前",
      idle: "空闲",
      standby: "待命",
      loaded: "已加载",
      empty: "空",
      environment: "环境",
      account: "账号",
      status: "状态",
      actions: "操作",
      rawOutput: "原始输出",
      itemsSuffix: "项",
    },
    overview: {
      eyebrow: "总览",
      title: "总览只负责判断状态，不负责堆满操作。",
      description: "这里是桌面控制台的入口。它告诉你当前 CLI / App 指向、守护状态和是否有异常，再把你送去环境页、账号页或运行页处理。",
      pendingTitle: "待处理事项",
      pendingEmpty: "当前没有需要优先处理的异常。",
      activeAccountsTitle: "最近活跃账号",
      noActiveAccounts: "暂无活跃账号。",
      targetColumn: "目标",
      currentColumn: "当前对象",
      loginStateColumn: "登录状态",
      emailColumn: "邮箱",
      usage5hColumn: "5H",
      usageWeeklyColumn: "一周",
      authColumn: "认证信息",
      actionColumn: "操作",
      keepCurrent: "保持当前",
      generated: "生成时间",
      guard: "守护状态",
      contextTitle: "当前上下文",
      contextSubtitle: "最常用的状态应该被快速读懂，不需要滚很久。",
      pendingSubtitle: "总览只提示问题，不在这里展开复杂流程。",
      cliLabel: "CLI",
      appLabel: "App",
    },
    environments: {
      eyebrow: "环境管理",
      title: "环境",
      description: "先展示环境列表，再围绕环境执行创建、切换和删除。当前页只服务环境管理，不混入账号表单。",
      create: "新建环境",
      total: "总数",
      searchPlaceholder: "搜索环境名或路径",
      all: "全部环境",
      active: "当前使用中",
      listTitle: "环境列表",
      listSubtitle: "",
      nameColumn: "环境",
      pathColumn: "路径",
      countColumn: "账号数",
      edit: "编辑",
      editTitle: "编辑环境",
      config: "配置",
      configTitle: "编辑配置文件",
      save: "保存",
      createTitle: "创建环境",
      createDescription: "",
      createHint: "",
      source: "来源",
      switchCli: "切到 CLI",
      switchApp: "切到 App",
      delete: "删除",
      deleteTitle: "删除环境",
      deleteDescription: "",
      deleteConfirm: "确认删除环境",
      deleteMissing: "未找到待删除环境。",
      importDefault: "导入默认环境",
      emptyOutput: "还没有执行环境相关操作。",
      nonCurrent: "非当前环境",
      emptyListTitle: "暂无环境",
      emptyListDescription: "",
      emptyFilterTitle: "无匹配环境",
      emptyFilterDescription: "",
    },
    accounts: {
      eyebrow: "账号管理",
      title: "账号",
      description: "先按环境筛选和浏览账号，再对选中的账号做切换、登录、登出、运行时更新和删除。登录流程放在抽屉里，不常驻占满页面。",
      create: "新建账号 / 登录",
      total: "总数",
      allEnvironments: "全部环境",
      allModes: "全部模式",
      searchPlaceholder: "搜索账号、环境或 base URL",
      listTitle: "账号列表",
      listSubtitle: "",
      accountColumn: "账号",
      environmentColumn: "环境",
      authColumn: "认证",
      runtimeColumn: "运行时",
      stateColumn: "状态",
      loginTitle: "登录",
      loginDescription: "",
      runtimeTitle: "运行时",
      runtimeDescription: "",
      runtimeAction: "编辑运行时",
      setCliAction: "设为 CLI",
      setAppAction: "设为 App",
      login: "账号登录",
      relogin: "重新登录",
      logout: "登出",
      logoutTitle: "登出账号",
      logoutDescription: "",
      logoutConfirm: "确认登出账号",
      logoutMissing: "未找到待登出的账号。",
      delete: "删除",
      deleteTitle: "删除账号",
      deleteDescription: "",
      deleteConfirm: "确认删除账号",
      deleteMissing: "未找到待删除账号。",
      emptyOutput: "还没有执行账号相关操作。",
      managedAccount: "受管账号",
      subscriptionLabel: "订阅",
      baseUrlLabel: "Base URL",
      keyLabel: "密钥",
      target: "目标",
      mode: "模式",
      baseUrlMode: "Base URL 设置",
      sub2api: "sub2api 配置",
      apiKey: "API Key",
      independentModel: "独立 Model",
      independentModelNotSet: "未设置独立模型",
      modelConfig: "Model 配置",
      modelConfigTitle: "独立 Model 配置",
      modelConfigDescription: "仅对 AUTH 账号生效。保存后会在设为 CLI 或 App 时写入 custom provider 配置。",
      modelProvider: "Model Provider",
      modelApiKey: "Model API Key",
      modelBaseUrl: "Model Base URL",
      both: "两者",
      custom: "自定义",
      defaultValue: "默认",
      emptyListTitle: "暂无账号",
      emptyListDescription: "",
      emptyFilterTitle: "无匹配账号",
      emptyFilterDescription: "",
    },
    operations: {
      eyebrow: "系统工具",
      title: "设置",
      description: "",
      refreshStatus: "刷新状态",
      guard: "守护状态",
      needRelogin: "需重新登录",
      appProcess: "App 进程",
      proxyTitle: "代理",
      proxySubtitle: "",
      proxyAddress: "代理地址",
      proxyPlaceholder: "host:port 或 scheme://host:port",
      proxyShow: "查看",
      proxySet: "设置",
      proxyOff: "关闭",
      proxyTest: "测试",
      guardTitle: "守护与刷新",
      guardSubtitle: "",
      guardStart: "启动守护",
      guardStop: "停止守护",
      guardStatus: "读取状态",
      guardRunOnce: "执行一次",
      diagnoseTitle: "诊断与恢复",
      diagnoseSubtitle: "",
      cliLaunch: "启动 CLI",
      opsList: "系统列表",
      appStatus: "App 状态",
      appLogout: "App 登出",
      appStopManaged: "停止托管 App",
      doctor: "诊断修复",
      recover: "恢复环境",
      advancedTitle: "日志",
      advancedSubtitle: "",
      logKind: "日志类型",
      readLog: "读取日志",
      scope: "Scope",
      action: "Action",
      args: "参数",
      runCommand: "执行命令",
      openTerminal: "打开 CLI 会话",
      emptyOutput: "还没有执行系统级操作。",
    },
  },
  en: {
    common: {
      close: "Close",
      cancel: "Cancel",
      result: "Result",
      resultSubtitle: "Structured feedback first, raw output second.",
      tools: "Tools",
      shellSubtitle: "Desktop console for environment, account, and runtime control.",
      refreshing: "Refreshing...",
      cliCurrent: "CLI Current",
      appCurrent: "App Current",
      current: "Current",
      idle: "Idle",
      standby: "Standby",
      loaded: "Loaded",
      empty: "Empty",
      environment: "Environment",
      account: "Account",
      status: "Status",
      actions: "Actions",
      rawOutput: "Raw Output",
      itemsSuffix: "items",
    },
    overview: {
      eyebrow: "Overview",
      title: "Overview should assess state, not host every action.",
      description: "This is the desktop console entry point. It shows current CLI / App targets, guard state, and exceptions, then routes you to the right workspace page.",
      pendingTitle: "Needs Attention",
      pendingEmpty: "No urgent issues right now.",
      activeAccountsTitle: "Recently active accounts",
      noActiveAccounts: "No active accounts.",
      targetColumn: "Target",
      currentColumn: "Current",
      loginStateColumn: "Login State",
      emailColumn: "Email",
      usage5hColumn: "5H",
      usageWeeklyColumn: "Weekly",
      authColumn: "Authentication",
      actionColumn: "Action",
      keepCurrent: "Keep Current",
      generated: "Generated",
      guard: "Guard",
      contextTitle: "Current Context",
      contextSubtitle: "The most used state should be readable at a glance.",
      pendingSubtitle: "Overview should point out issues, not expand the full workflow.",
      cliLabel: "CLI",
      appLabel: "App",
    },
    environments: {
      eyebrow: "Environment Management",
      title: "Environments",
      description: "Start with the environment list, then create, switch, or delete around that list. This page only serves environment management.",
      create: "Create Environment",
      total: "Total",
      searchPlaceholder: "Search environment name or path",
      all: "All Environments",
      active: "Currently Active",
      listTitle: "Environment List",
      listSubtitle: "",
      nameColumn: "Environment",
      pathColumn: "Path",
      countColumn: "Accounts",
      edit: "Edit",
      editTitle: "Edit Environment",
      config: "Config",
      configTitle: "Edit Config File",
      save: "Save",
      createTitle: "Create Environment",
      createDescription: "",
      createHint: "",
      source: "Source",
      switchCli: "Set CLI",
      switchApp: "Set App",
      delete: "Delete",
      deleteTitle: "Delete Environment",
      deleteDescription: "",
      deleteConfirm: "Delete Environment",
      deleteMissing: "Environment not found.",
      importDefault: "Import Default",
      emptyOutput: "No environment action has been run yet.",
      nonCurrent: "Not current",
      emptyListTitle: "No environments",
      emptyListDescription: "",
      emptyFilterTitle: "No matches",
      emptyFilterDescription: "",
    },
    accounts: {
      eyebrow: "Account Management",
      title: "Accounts",
      description: "Filter by environment first, then switch, log in, log out, update runtime, or delete the selected account. Login lives in a drawer instead of occupying the page.",
      create: "New Account / Login",
      total: "Total",
      allEnvironments: "All Environments",
      allModes: "All Modes",
      searchPlaceholder: "Search account, environment, or base URL",
      listTitle: "Account List",
      listSubtitle: "",
      accountColumn: "Account",
      environmentColumn: "Environment",
      authColumn: "Authentication",
      runtimeColumn: "Runtime",
      stateColumn: "State",
      loginTitle: "Login",
      loginDescription: "",
      runtimeTitle: "Runtime",
      runtimeDescription: "",
      runtimeAction: "Edit Runtime",
      setCliAction: "Set CLI",
      setAppAction: "Set App",
      login: "Open Login",
      relogin: "Sign In Again",
      logout: "Logout",
      logoutTitle: "Logout Account",
      logoutDescription: "",
      logoutConfirm: "Logout Account",
      logoutMissing: "Account to log out was not found.",
      delete: "Delete",
      deleteTitle: "Delete Account",
      deleteDescription: "",
      deleteConfirm: "Delete Account",
      deleteMissing: "Account not found.",
      emptyOutput: "No account action has been run yet.",
      managedAccount: "Managed account",
      subscriptionLabel: "Plan",
      baseUrlLabel: "Base URL",
      keyLabel: "Key",
      target: "Target",
      mode: "Mode",
      baseUrlMode: "Base URL Mode",
      sub2api: "sub2api Payload",
      apiKey: "API Key",
      independentModel: "Independent Model",
      independentModelNotSet: "Independent model not set",
      modelConfig: "Model Config",
      modelConfigTitle: "Independent Model Config",
      modelConfigDescription: "Only applies to AUTH accounts. The custom provider config is written when this account is set to CLI or App.",
      modelProvider: "Model Provider",
      modelApiKey: "Model API Key",
      modelBaseUrl: "Model Base URL",
      both: "Both",
      custom: "Custom",
      defaultValue: "Default",
      emptyListTitle: "No accounts",
      emptyListDescription: "",
      emptyFilterTitle: "No matches",
      emptyFilterDescription: "",
    },
    operations: {
      eyebrow: "System Tools",
      title: "Settings",
      description: "",
      refreshStatus: "Refresh Status",
      guard: "Refresh Guard",
      needRelogin: "Re-login Needed",
      appProcess: "App Process",
      proxyTitle: "Proxy",
      proxySubtitle: "",
      proxyAddress: "Proxy Address",
      proxyPlaceholder: "host:port or scheme://host:port",
      proxyShow: "Show",
      proxySet: "Set",
      proxyOff: "Disable",
      proxyTest: "Test",
      guardTitle: "Refresh Guard",
      guardSubtitle: "",
      guardStart: "Start Guard",
      guardStop: "Stop Guard",
      guardStatus: "Read Status",
      guardRunOnce: "Run Once",
      diagnoseTitle: "Diagnostics & Repair",
      diagnoseSubtitle: "",
      cliLaunch: "Launch CLI",
      opsList: "List Ops",
      appStatus: "App Status",
      appLogout: "Sign Out App",
      appStopManaged: "Stop Managed App",
      doctor: "Run Diagnostics",
      recover: "Repair Setup",
      advancedTitle: "Logs",
      advancedSubtitle: "",
      logKind: "Log Kind",
      readLog: "Read Log",
      scope: "Scope",
      action: "Action",
      args: "Args",
      runCommand: "Run Command",
      openTerminal: "Open CLI Session",
      emptyOutput: "No system action has been run yet.",
    },
  },
  ja: {
    common: {
      close: "閉じる",
      cancel: "キャンセル",
      result: "結果",
      resultSubtitle: "まず構造化された結果を見て、その後に生出力を確認します。",
      tools: "ツール",
      shellSubtitle: "環境、アカウント、ランタイム管理のためのデスクトップコンソール。",
      refreshing: "更新中...",
      cliCurrent: "CLI 現在",
      appCurrent: "App 現在",
      current: "現在",
      idle: "待機",
      standby: "待機",
      loaded: "読み込み済み",
      empty: "空",
      environment: "環境",
      account: "アカウント",
      status: "状態",
      actions: "操作",
      rawOutput: "生出力",
      itemsSuffix: "件",
    },
    overview: {
      eyebrow: "概要",
      title: "概要は状態判断に専念し、全操作を載せる場所ではありません。",
      description: "ここはデスクトップコンソールの入口です。現在の CLI / App ターゲット、ガード状態、例外を示し、適切な作業ページへ導きます。",
      pendingTitle: "要対応項目",
      pendingEmpty: "優先度の高い問題はありません。",
      activeAccountsTitle: "最近アクティブなアカウント",
      noActiveAccounts: "アクティブなアカウントはありません。",
      targetColumn: "ターゲット",
      currentColumn: "現在",
      loginStateColumn: "ログイン状態",
      emailColumn: "メール",
      usage5hColumn: "5H",
      usageWeeklyColumn: "週間",
      authColumn: "認証情報",
      actionColumn: "操作",
      keepCurrent: "現状維持",
      generated: "生成時刻",
      guard: "ガード",
      contextTitle: "現在のコンテキスト",
      contextSubtitle: "よく使う状態は一目で読めるべきです。",
      pendingSubtitle: "概要では問題を示すだけに留め、複雑な操作は展開しません。",
      cliLabel: "CLI",
      appLabel: "App",
    },
    environments: {
      eyebrow: "環境管理",
      title: "環境",
      description: "まず環境一覧を表示し、その一覧を中心に作成、切替、削除を行います。このページは環境管理だけに集中します。",
      create: "環境を作成",
      total: "合計",
      searchPlaceholder: "環境名またはパスで検索",
      all: "すべての環境",
      active: "現在使用中",
      listTitle: "環境一覧",
      listSubtitle: "",
      nameColumn: "環境",
      pathColumn: "パス",
      countColumn: "アカウント数",
      edit: "編集",
      editTitle: "環境を編集",
      config: "設定",
      configTitle: "設定ファイルを編集",
      save: "保存",
      createTitle: "環境を作成",
      createDescription: "",
      createHint: "",
      source: "ソース",
      switchCli: "CLI に切替",
      switchApp: "App に切替",
      delete: "削除",
      deleteTitle: "環境を削除",
      deleteDescription: "",
      deleteConfirm: "環境を削除",
      deleteMissing: "削除対象の環境が見つかりません。",
      importDefault: "デフォルトを取り込む",
      emptyOutput: "まだ環境操作は実行されていません。",
      nonCurrent: "現在未使用",
      emptyListTitle: "環境はありません",
      emptyListDescription: "",
      emptyFilterTitle: "一致なし",
      emptyFilterDescription: "",
    },
    accounts: {
      eyebrow: "アカウント管理",
      title: "アカウント",
      description: "まず環境で絞り込み、その後で切替、ログイン、ログアウト、ランタイム更新、削除を行います。ログインはドロワーに収めます。",
      create: "新規アカウント / ログイン",
      total: "合計",
      allEnvironments: "すべての環境",
      allModes: "すべてのモード",
      searchPlaceholder: "アカウント、環境、base URL を検索",
      listTitle: "アカウント一覧",
      listSubtitle: "",
      accountColumn: "アカウント",
      environmentColumn: "環境",
      authColumn: "認証",
      runtimeColumn: "ランタイム",
      stateColumn: "状態",
      loginTitle: "ログイン",
      loginDescription: "",
      runtimeTitle: "ランタイム",
      runtimeDescription: "",
      runtimeAction: "ランタイム編集",
      setCliAction: "CLI に設定",
      setAppAction: "App に設定",
      login: "ログイン設定",
      relogin: "再ログイン",
      logout: "ログアウト",
      logoutTitle: "アカウントをログアウト",
      logoutDescription: "",
      logoutConfirm: "アカウントをログアウト",
      logoutMissing: "ログアウト対象のアカウントが見つかりません。",
      delete: "削除",
      deleteTitle: "アカウントを削除",
      deleteDescription: "",
      deleteConfirm: "アカウントを削除",
      deleteMissing: "削除対象のアカウントが見つかりません。",
      emptyOutput: "まだアカウント操作は実行されていません。",
      managedAccount: "管理アカウント",
      subscriptionLabel: "プラン",
      baseUrlLabel: "Base URL",
      keyLabel: "キー",
      target: "ターゲット",
      mode: "モード",
      baseUrlMode: "Base URL 設定",
      sub2api: "sub2api 設定",
      apiKey: "API Key",
      independentModel: "独立 Model",
      independentModelNotSet: "独立モデル未設定",
      modelConfig: "Model 設定",
      modelConfigTitle: "独立 Model 設定",
      modelConfigDescription: "AUTH アカウントでのみ有効です。保存後、このアカウントを CLI または App に設定すると custom provider を書き込みます。",
      modelProvider: "Model Provider",
      modelApiKey: "Model API Key",
      modelBaseUrl: "Model Base URL",
      both: "両方",
      custom: "カスタム",
      defaultValue: "デフォルト",
      emptyListTitle: "アカウントはありません",
      emptyListDescription: "",
      emptyFilterTitle: "一致なし",
      emptyFilterDescription: "",
    },
    operations: {
      eyebrow: "システムツール",
      title: "設定",
      description: "",
      refreshStatus: "状態を更新",
      guard: "ガード",
      needRelogin: "再ログイン必要",
      appProcess: "App プロセス",
      proxyTitle: "プロキシ",
      proxySubtitle: "",
      proxyAddress: "プロキシアドレス",
      proxyPlaceholder: "host:port または scheme://host:port",
      proxyShow: "表示",
      proxySet: "設定",
      proxyOff: "無効化",
      proxyTest: "テスト",
      guardTitle: "ガードと更新",
      guardSubtitle: "",
      guardStart: "ガード開始",
      guardStop: "ガード停止",
      guardStatus: "状態取得",
      guardRunOnce: "一度実行",
      diagnoseTitle: "診断と復旧",
      diagnoseSubtitle: "",
      cliLaunch: "CLI 起動",
      opsList: "一覧取得",
      appStatus: "App 状態",
      appLogout: "App ログアウト",
      appStopManaged: "管理 App 停止",
      doctor: "診断修復",
      recover: "環境復旧",
      advancedTitle: "ログ",
      advancedSubtitle: "",
      logKind: "ログ種別",
      readLog: "ログを読む",
      scope: "Scope",
      action: "Action",
      args: "引数",
      runCommand: "コマンド実行",
      openTerminal: "CLI セッションを開く",
      emptyOutput: "まだシステム操作は実行されていません。",
    },
  },
};

export function getDesktopCopy(language: UiLanguage): DesktopCopy {
  return copy[language] ?? copy.en;
}

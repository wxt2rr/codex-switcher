export type ResultTone = "ok" | "warn" | "neutral";

export interface ResultSummaryEntry {
  label: string;
  value: string;
  tone?: ResultTone;
}

export interface ResultSummarySection {
  title: string;
  entries: ResultSummaryEntry[];
}

export interface ResultSummary {
  title: string;
  status: string;
  tone: ResultTone;
  sections: ResultSummarySection[];
}

export function parseOperationOutput(scope: string, action: string, args: string[], output: string): ResultSummary | null {
  if (scope === "ops" && action === "proxy") {
    return parseProxyOutput(output);
  }
  if (scope === "ops" && action === "token-refresh") {
    return parseTokenRefreshOutput(args[0] ?? "", output);
  }
  if (scope === "ops" && action === "doctor") {
    return parseDoctorOutput(output);
  }
  if (scope === "ops" && action === "recover") {
    return parseRecoverOutput(output);
  }
  if (scope === "app" && action === "status") {
    return parseAppStatusOutput(output) ?? parseGenericResult(`${scope} ${action}`, output);
  }
  if (scope === "log") {
    return parseLogOutput(action, output);
  }
  if (scope === "cli" && action === "launch-current") {
    return parseCliLaunchOutput(output) ?? parseGenericResult("CLI Session", output);
  }

  return parseGenericResult(`${scope} ${action}`, output);
}

function parseProxyOutput(output: string): ResultSummary | null {
  const textOutput = output.trim();
  if (!textOutput) {
    return null;
  }

  const proxyMatch = textOutput.match(/^usage_api_proxy:\s*(.+)$/m);
  const testMatch = textOutput.match(/^usage_api_proxy_test:\s*(ok|failed)\s*\((.+)\)$/m);
  if (!proxyMatch && !testMatch) {
    return null;
  }

  const entries: ResultSummaryEntry[] = [];
  if (proxyMatch) {
    const proxyValue = proxyMatch[1].trim();
    entries.push({
      label: "Proxy",
      value: proxyValue,
      tone: proxyValue.includes("off") ? "warn" : "neutral",
    });
  }
  if (testMatch) {
    entries.push({
      label: "Test",
      value: `${testMatch[1]} (${testMatch[2]})`,
      tone: testMatch[1] === "ok" ? "ok" : "warn",
    });
  }

  const success = !testMatch || testMatch[1] === "ok";
  return {
    title: "Proxy",
    status: success ? "Ready" : "Attention required",
    tone: success ? "ok" : "warn",
    sections: [{ title: "Summary", entries }],
  };
}

function parseTokenRefreshOutput(action: string, output: string): ResultSummary | null {
  const textOutput = output.trim();
  if (!textOutput) {
    return null;
  }

  const guardMatch = textOutput.match(/^token_refresh_guard:\s*(.+)$/m);
  const needReloginMatch = textOutput.match(/^token_refresh_need_relogin_last_run:\s*(.+)$/m);
  const summaryMatch = textOutput.match(
    /^Summary:\s*scanned=(\d+)\s+fresh=(\d+)\s+checked=(\d+)\s+refreshed=(\d+)\s+failed=(\d+)\s+relogin=(\d+)\s+duration=([^\n]+)$/m,
  );

  if (!guardMatch && !needReloginMatch && !summaryMatch) {
    return null;
  }

  const sections: ResultSummarySection[] = [];
  if (guardMatch || needReloginMatch) {
    const entries: ResultSummaryEntry[] = [];
    if (guardMatch) {
      entries.push({
        label: "Guard",
        value: guardMatch[1].trim(),
        tone: guardMatch[1].includes("enabled") ? "ok" : "warn",
      });
    }
    if (needReloginMatch) {
      const reloginValue = needReloginMatch[1].trim();
      entries.push({
        label: "Need relogin",
        value: reloginValue,
        tone: reloginValue === "0" ? "ok" : "warn",
      });
    }
    sections.push({ title: "Guard", entries });
  }

  let tone: ResultTone = action === "status" ? "neutral" : "ok";
  let status = action === "status" ? "Status loaded" : "Completed";

  if (summaryMatch) {
    const [, scanned, fresh, checked, refreshed, failed, relogin, duration] = summaryMatch;
    const failedCount = Number(failed);
    const reloginCount = Number(relogin);
    tone = failedCount > 0 || reloginCount > 0 ? "warn" : "ok";
    status = tone === "ok" ? "Scan healthy" : "Issues detected";
    sections.push({
      title: "Last scan",
      entries: [
        { label: "Scanned", value: scanned },
        { label: "Fresh", value: fresh },
        { label: "Checked", value: checked },
        { label: "Refreshed", value: refreshed, tone: Number(refreshed) > 0 ? "ok" : "neutral" },
        { label: "Failed", value: failed, tone: failedCount > 0 ? "warn" : "ok" },
        { label: "Need relogin", value: relogin, tone: reloginCount > 0 ? "warn" : "ok" },
        { label: "Duration", value: duration },
      ],
    });
  }

  return {
    title: "Token Refresh",
    status,
    tone,
    sections,
  };
}

function parseDoctorOutput(output: string): ResultSummary | null {
  const textOutput = output.trim();
  if (!textOutput) {
    return null;
  }

  const ok = /^doctor:\s*ok$/m.test(textOutput);
  const issue = /^doctor:\s*issues found$/m.test(textOutput);
  const lines = textOutput
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.startsWith("doctor:"));

  if (!ok && !issue) {
    return null;
  }

  return {
    title: "Diagnostics",
    status: ok ? "Healthy" : "Issues found",
    tone: ok ? "ok" : "warn",
    sections: [
      {
        title: "Result",
        entries: lines.length
          ? lines.map((line) => ({ label: "Detail", value: line, tone: issue ? "warn" : "neutral" }))
          : [{ label: "Status", value: ok ? "No issues reported" : "Review raw output", tone: ok ? "ok" : "warn" }],
      },
    ],
  };
}

function parseRecoverOutput(output: string): ResultSummary | null {
  const textOutput = output.trim();
  if (!textOutput) {
    return null;
  }

  const matches = Array.from(textOutput.matchAll(/^recover\((cli|app)\):\s*(.+)$/gm));
  if (!matches.length) {
    return null;
  }

  return {
    title: "Repair",
    status: "Targets resolved",
    tone: "ok",
    sections: [
      {
        title: "Resolved targets",
        entries: matches.map((match) => ({
          label: match[1].toUpperCase(),
          value: match[2].trim(),
          tone: "ok",
        })),
      },
    ],
  };
}

function parseAppStatusOutput(output: string): ResultSummary | null {
  const textOutput = output.trim();
  if (!textOutput) {
    return null;
  }

  const currentMatch = textOutput.match(/^app_current:\s*(.+)$/m);
  const processMatch = textOutput.match(/^app_process:\s*(.+)$/m);
  if (!currentMatch && !processMatch) {
    return null;
  }

  const processValue = processMatch?.[1].trim() ?? "";
  const running = processValue.startsWith("running");
  const entries: ResultSummaryEntry[] = [];

  if (currentMatch) {
    entries.push({ label: "Current target", value: currentMatch[1].trim() });
  }
  if (processMatch) {
    entries.push({
      label: "Process",
      value: processValue,
      tone: running ? "ok" : "warn",
    });
  }

  return {
    title: "App Status",
    status: running ? "Running" : "Not running",
    tone: running ? "ok" : "warn",
    sections: [{ title: "Runtime", entries }],
  };
}

function parseCliLaunchOutput(output: string): ResultSummary | null {
  const textOutput = output.trim();
  if (!textOutput) {
    return null;
  }

  const opened = /opened cli session|opened terminal/i.test(textOutput);
  if (!opened) {
    return null;
  }

  return {
    title: "CLI Session",
    status: "Opened",
    tone: "ok",
    sections: [
      {
        title: "Result",
        entries: [{ label: "Session", value: "Opened", tone: "ok" }],
      },
    ],
  };
}

function parseLogOutput(kind: string, output: string): ResultSummary {
  const textOutput = output.trim();
  const lines = textOutput ? textOutput.split("\n") : [];
  const lastLine = lines.length > 0 ? lines[lines.length - 1] : "empty";

  return {
    title: "Log View",
    status: lines.length > 0 ? "Loaded" : "Empty",
    tone: lines.length > 0 ? "neutral" : "warn",
    sections: [
      {
        title: "File",
        entries: [
          { label: "Kind", value: kind },
          { label: "Lines", value: String(lines.length) },
          { label: "Last line", value: lastLine.slice(0, 120) || "empty" },
        ],
      },
    ],
  };
}

function parseGenericResult(title: string, output: string): ResultSummary | null {
  const textOutput = output.trim();
  if (!textOutput) {
    return null;
  }

  const lines = textOutput.split("\n").map((line) => line.trim()).filter(Boolean);
  return {
    title,
    status: "Completed",
    tone: "neutral",
    sections: [
      {
        title: "Summary",
        entries: [
          { label: "Lines", value: String(lines.length) },
          { label: "First line", value: lines[0] ?? "-" },
        ],
      },
    ],
  };
}

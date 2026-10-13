import { CheckCircle2, LoaderCircle, PlayCircle, XCircle } from "lucide-react";
import { useState, type MouseEvent } from "react";

import type { DesktopBridge, ModelRequestTestRequest, ModelRequestTestResult } from "../bridge";
import type { UiLanguage } from "../i18n";
import { Button } from "./ui/button";
import { cn } from "../lib/utils";

export function ModelTestButton({ bridge, request, language }: {
  bridge: DesktopBridge;
  request?: ModelRequestTestRequest;
  language: UiLanguage;
}) {
  const zh = language === "zh";
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<ModelRequestTestResult>();

  async function test(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();
    if (!request || testing) return;
    setTesting(true);
    setResult(undefined);
    try {
      setResult(await bridge.testModelRequest(request));
    } catch (error) {
      setResult({
        ok: false,
        status: 0,
        message: error instanceof Error ? error.message : String(error),
        latencyMs: 0,
        model: request.model,
      });
    } finally {
      setTesting(false);
    }
  }

  const label = testing ? (zh ? "测试中" : "Testing") : (zh ? "测试" : "Test");
  const resultLabel = result
    ? result.ok
      ? (zh ? `响应正常 · ${result.latencyMs}ms` : `Responded · ${result.latencyMs}ms`)
      : (zh ? `测试失败${result.status ? ` · ${result.status}` : ""}` : `Failed${result.status ? ` · ${result.status}` : ""}`)
    : undefined;

  return (
    <div className="flex max-w-[220px] flex-col items-end gap-1">
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={test}
        disabled={!request || testing}
        title={request ? (zh ? "使用当前服务商发送：你是什么模型" : "Ask the current provider: What model are you?") : (zh ? "需要先绑定账号" : "Bind an account before testing")}
        className={cn(
          "h-7 gap-1.5 px-2.5 text-[11px]",
          result?.ok && "border-emerald-200 bg-emerald-50 text-emerald-700",
          result && !result.ok && "border-rose-200 bg-rose-50 text-rose-700",
        )}
      >
        {testing ? <LoaderCircle className="size-3.5 animate-spin" /> : result?.ok ? <CheckCircle2 className="size-3.5" /> : result && !result.ok ? <XCircle className="size-3.5" /> : <PlayCircle className="size-3.5" />}
        {label}
      </Button>
      {resultLabel ? (
        <span
          className={cn("max-w-[220px] truncate text-[10px]", result?.ok ? "text-emerald-600" : "text-rose-600")}
          title={result?.message ?? ""}
        >
          {resultLabel}
        </span>
      ) : null}
    </div>
  );
}

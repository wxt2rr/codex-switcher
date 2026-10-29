import { CheckCircle2, CircleAlert, LoaderCircle, PlayCircle } from "lucide-react";
import { useState, type MouseEvent } from "react";

import type { DesktopBridge, ModelRequestTestRequest, ModelRequestTestResult } from "../bridge";
import type { UiLanguage } from "../i18n";
import { cn } from "../lib/utils";
import { Tooltip } from "./ui/tooltip";

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

  const label = testing
    ? (zh ? "测试中" : "Testing")
    : result?.ok
      ? (zh ? "已通过" : "Passed")
      : result && !result.ok
        ? (zh ? "重新测试" : "Retry")
        : (zh ? "测试" : "Test");

  return (
    <div className="flex h-8 min-w-0 items-center gap-2">
      <button
        type="button"
        onClick={test}
        disabled={!request || testing}
        title={request ? (zh ? "使用当前服务商发送：你是什么模型" : "Ask the current provider: What model are you?") : (zh ? "需要先绑定账号" : "Bind an account before testing")}
        className={cn(
          "inline-flex h-8 min-w-[68px] items-center justify-center gap-1.5 rounded-lg border border-black/[0.08] bg-white px-2.5 text-[11px] font-medium text-slate-600 transition-colors hover:bg-slate-50 hover:text-neutral-950 disabled:cursor-not-allowed disabled:opacity-50",
          result?.ok && "border-primary/30 bg-primary/10 text-primary",
        )}
      >
        {testing ? <LoaderCircle className="size-3.5 animate-spin" /> : result?.ok ? <CheckCircle2 className="size-3.5" /> : <PlayCircle className="size-3.5" />}
        {label}
      </button>
      {result?.ok ? (
        <span className="max-w-[140px] truncate text-[10px] text-emerald-600" title={result.message ?? ""}>
          {zh ? `连接正常 · ${result.latencyMs}ms` : `Connected · ${result.latencyMs}ms`}
        </span>
      ) : result && !result.ok ? (
        <Tooltip
          content={(
            <div className="max-w-[280px]">
              <div className="font-semibold">{zh ? "模型请求失败" : "Model request failed"}{result.status ? ` · ${result.status}` : ""}</div>
              <div className="mt-0.5 break-words font-normal text-white/80">{result.message || (zh ? "服务商没有返回可用响应" : "The provider did not return a usable response")}</div>
            </div>
          )}
        >
          <button
            type="button"
            aria-label={zh ? "查看测试失败详情" : "View test failure details"}
            onClick={(event) => event.stopPropagation()}
            className="inline-flex min-w-0 max-w-[150px] cursor-help items-center gap-1 truncate rounded px-0.5 text-left text-[10px] text-rose-600 hover:bg-rose-50"
          >
            <CircleAlert className="size-3 shrink-0" />
            <span className="truncate">{zh ? "连接失败 · 查看详情" : "Connection failed · Details"}</span>
          </button>
        </Tooltip>
      ) : null}
    </div>
  );
}

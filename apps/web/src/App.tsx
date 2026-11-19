import { useEffect, useState } from "react";
import { healthResponseSchema, type HealthResponse } from "@maillink/shared";

// 占位页：只证明前后端同源联通。正式页面与视觉由 UI 里程碑负责。
const SITE_NAME = "MailLink";
const HEALTH_URL = "/api/admin/system/health";

type HealthState =
  | { status: "loading" }
  | { status: "done"; httpStatus: number; body: HealthResponse }
  | { status: "error"; message: string };

async function fetchHealth(): Promise<HealthState> {
  const res = await fetch(HEALTH_URL);
  const json: unknown = await res.json();
  // 不健康时后端返回 503 但响应体结构不变，所以不按状态码判断成败
  return { status: "done", httpStatus: res.status, body: healthResponseSchema.parse(json) };
}

export function App() {
  const [health, setHealth] = useState<HealthState>({ status: "loading" });

  useEffect(() => {
    fetchHealth()
      .then(setHealth)
      .catch((error: unknown) =>
        setHealth({ status: "error", message: error instanceof Error ? error.message : String(error) }),
      );
  }, []);

  return (
    <main className="mx-auto max-w-2xl p-6">
      <h1 className="text-2xl font-semibold">{SITE_NAME}</h1>
      <p className="mt-2 text-sm text-gray-600">占位首页（M0）。下面是 {HEALTH_URL} 的响应：</p>
      <pre className="mt-4 overflow-auto rounded border p-3 text-xs">
        {health.status === "loading" && "加载中…"}
        {health.status === "error" && `请求失败：${health.message}`}
        {health.status === "done" && `HTTP ${health.httpStatus}\n${JSON.stringify(health.body, null, 2)}`}
      </pre>
    </main>
  );
}

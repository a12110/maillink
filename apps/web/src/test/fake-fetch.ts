import { vi } from "vitest";

// 组件测试用的假后端：按 `METHOD /path`（不含查询串）匹配，记录每次请求的方法、完整地址与解析后的 JSON 请求体。
// 没有匹配的请求直接抛错（不静默返回空响应），让测试暴露漏掉的接口。

export type RecordedCall = { method: string; url: string; path: string; body: unknown };
export type FakeReply = { status?: number; json: unknown; headers?: Record<string, string> };
export type FakeHandler = FakeReply | ((call: RecordedCall) => FakeReply);

export type FakeFetch = {
  calls: RecordedCall[];
  /** 某接口被调用过的所有记录 */
  callsTo: (key: string) => RecordedCall[];
  /** 换掉一个接口的回复（后续请求生效） */
  set: (key: string, handler: FakeHandler) => void;
};

export function errorReply(status: number, code: string, message: string, headers?: Record<string, string>): FakeReply {
  return { status, json: { error: { code, message } }, ...(headers ? { headers } : {}) };
}

function parseBody(init: RequestInit | undefined): unknown {
  return typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
}

export function installFakeFetch(initial: Record<string, FakeHandler>): FakeFetch {
  const handlers = new Map(Object.entries(initial));
  const calls: RecordedCall[] = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const path = url.split("?")[0] ?? url;
    const method = init?.method ?? "GET";
    const call: RecordedCall = { method, url, path, body: parseBody(init) };
    calls.push(call);
    const handler = handlers.get(`${method} ${path}`);
    if (handler === undefined) throw new Error(`假后端没有配置 ${method} ${path}`);
    const reply = typeof handler === "function" ? handler(call) : handler;
    return new Response(JSON.stringify(reply.json), {
      status: reply.status ?? 200,
      headers: { "Content-Type": "application/json", ...reply.headers },
    });
  });
  return {
    calls,
    callsTo: (key) => calls.filter((call) => `${call.method} ${call.path}` === key),
    set: (key, handler) => void handlers.set(key, handler),
  };
}

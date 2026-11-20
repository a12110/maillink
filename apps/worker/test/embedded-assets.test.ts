import { createExecutionContext, createScheduledController, env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { createAssetResponder, withEmbeddedAssets, type WorkerHandlers } from "../src/embedded-assets";
import type { EmbeddedAssetManifest } from "../src/embedded-assets-manifest";
import worker from "../src/index";
import { resetApp } from "./helpers";

// 单文件部署（docs/deploy-gui.md）：/api/* 交给原 Worker，其余路径按 Static Assets 的行为直出内嵌前端。

const CSP = "default-src 'self'; frame-ancestors 'none'";
const PNG_BYTES = [137, 80, 78, 71];

const manifest: EmbeddedAssetManifest = {
  spaFallback: "/index.html",
  files: {
    "/index.html": { contentType: "text/html; charset=utf-8", encoding: "utf8", body: "<!doctype html><p>app</p>" },
    "/assets/app-abc.js": { contentType: "text/javascript; charset=utf-8", encoding: "utf8", body: "console.log(1)" },
    "/logo.png": { contentType: "image/png", encoding: "base64", body: btoa(String.fromCharCode(...PNG_BYTES)) },
  },
  headerRules: [
    { pattern: "/*", headers: [["Content-Security-Policy", CSP], ["X-Robots-Tag", "noarchive"]] },
    { pattern: "/s/*", headers: [["Cache-Control", "no-store"], ["X-Robots-Tag", "noindex, nofollow"]] },
  ],
};

type FakeEnv = { marker: string };

function fakeWorker(): { calls: string[]; handlers: WorkerHandlers<FakeEnv> } {
  const calls: string[] = [];
  return {
    calls,
    handlers: {
      fetch: (request, fakeEnv) => {
        calls.push(`fetch ${new URL(request.url).pathname} ${fakeEnv.marker}`);
        return new Response("from worker");
      },
      scheduled: async (controller, fakeEnv) => {
        calls.push(`scheduled ${controller.cron} ${fakeEnv.marker}`);
      },
    },
  };
}

const FAKE_ENV: FakeEnv = { marker: "env-1" };

async function get(path: string, method = "GET"): Promise<Response> {
  const { handlers } = fakeWorker();
  return await withEmbeddedAssets(handlers, manifest).fetch(
    new Request(`https://mail.example.com${path}`, { method }),
    FAKE_ENV,
    createExecutionContext(),
  );
}

describe("withEmbeddedAssets 分流", () => {
  it("/api/* 交给原 Worker，env 原样转交；/api 本身与其他路径不经过 Worker", async () => {
    const { calls, handlers } = fakeWorker();
    const single = withEmbeddedAssets(handlers, manifest);
    const ctx = createExecutionContext();
    const api = await single.fetch(new Request("https://mail.example.com/api/setup/status"), FAKE_ENV, ctx);
    expect(await api.text()).toBe("from worker");
    const bare = await single.fetch(new Request("https://mail.example.com/api"), FAKE_ENV, ctx);
    expect(await bare.text()).toContain("<p>app</p>");
    await single.fetch(new Request("https://mail.example.com/admin"), FAKE_ENV, ctx);
    expect(calls).toEqual(["fetch /api/setup/status env-1"]);
  });

  it("cron 原样转交", async () => {
    const { calls, handlers } = fakeWorker();
    const single = withEmbeddedAssets(handlers, manifest);
    await single.scheduled(createScheduledController({ cron: "*/5 * * * *" }), FAKE_ENV, createExecutionContext());
    expect(calls).toEqual(["scheduled */5 * * * * env-1"]);
  });
});

describe("内嵌静态资源", () => {
  it("/ 与未知路径返回 index.html（SPA 回退），带 _headers 的安全头且不长期缓存", async () => {
    for (const path of ["/", "/admin/users", "/setup", "/S/abc"]) {
      const res = await get(path);
      expect(res.status, path).toBe(200);
      expect(res.headers.get("Content-Type"), path).toBe("text/html; charset=utf-8");
      expect(res.headers.get("Content-Security-Policy"), path).toBe(CSP);
      expect(res.headers.get("Cache-Control"), path).toBe("no-cache");
      expect(await res.text(), path).toContain("<p>app</p>");
    }
  });

  it("/s/* 另加 no-store；多条规则设置同一个头时按 _headers 语义合并", async () => {
    const res = await get("/s/token-abc");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("X-Robots-Tag")).toBe("noarchive, noindex, nofollow");
    expect(res.headers.get("Content-Security-Policy")).toBe(CSP);
  });

  it("命中的带哈希资源长期缓存；/assets/ 下不存在的文件回退 index.html 且不缓存", async () => {
    const js = await get("/assets/app-abc.js");
    expect(js.headers.get("Content-Type")).toBe("text/javascript; charset=utf-8");
    expect(js.headers.get("Cache-Control")).toBe("public, max-age=31536000, immutable");
    expect(await js.text()).toBe("console.log(1)");
    const missing = await get("/assets/old-hash.js");
    expect(missing.headers.get("Cache-Control")).toBe("no-cache");
    expect(missing.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
  });

  it("base64 文件按原始字节返回，多次请求结果一致", async () => {
    for (let i = 0; i < 2; i += 1) {
      const res = await get("/logo.png");
      expect(res.headers.get("Content-Type")).toBe("image/png");
      expect([...new Uint8Array(await res.arrayBuffer())]).toEqual(PNG_BYTES);
    }
  });

  it("HEAD 只有头没有正文；其他方法 405", async () => {
    const head = await get("/", "HEAD");
    expect(head.status).toBe(200);
    expect(head.headers.get("Content-Security-Policy")).toBe(CSP);
    expect(await head.text()).toBe("");
    const post = await get("/", "POST");
    expect(post.status).toBe(405);
    expect(post.headers.get("Allow")).toBe("GET, HEAD");
  });

  it("_headers 本身不会被当成文件下发", async () => {
    const res = await get("/_headers");
    expect(await res.text()).toContain("<p>app</p>");
  });

  it("清单缺回退页时创建即失败", () => {
    expect(() => createAssetResponder({ ...manifest, spaFallback: "/missing.html" })).toThrow(/缺少回退页/);
  });
});

describe("包装真实 Worker", () => {
  beforeEach(resetApp);

  it("/api/* 由原应用处理（带 API 安全头），页面由内嵌资源处理", async () => {
    const single = withEmbeddedAssets(worker, manifest);
    const ctx = createExecutionContext();
    const status = await single.fetch(new Request("http://localhost:8787/api/setup/status"), env, ctx);
    expect(status.status).toBe(200);
    expect(await status.json()).toMatchObject({ needs_setup: true });
    expect(status.headers.get("X-Content-Type-Options")).toBe("nosniff");
    const unknown = await single.fetch(new Request("http://localhost:8787/api/no-such-route"), env, ctx);
    expect(unknown.status).toBe(404);
    const page = await single.fetch(new Request("http://localhost:8787/login"), env, ctx);
    expect(page.headers.get("Content-Security-Policy")).toBe(CSP);
  });
});

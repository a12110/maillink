import { env } from "cloudflare:workers";
import { Hono } from "hono";
import { ZodError, z } from "zod";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { healthResponseSchema } from "@maillink/shared";
import type { AppEnv, Bindings } from "../src/env";
import { app } from "../src/index";
import { onError } from "../src/middleware/error";
import { parseWith } from "../src/validate";
import { adminSession, api, resetApp, setupMailDb } from "./helpers";

const HEALTH_PATH = "/api/admin/system/health";

describe("GET /api/admin/system/health", () => {
  let cookie: string;

  beforeEach(async () => {
    await resetApp();
    cookie = (await adminSession()).cookie;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const getHealth = (bindings?: Partial<Bindings>) =>
    api(HEALTH_PATH, { cookie, ...(bindings ? { bindings } : {}) });

  it("需要管理员：未登录 401", async () => {
    expect((await api(HEALTH_PATH)).status).toBe(401);
  });

  it("两个库都正常：200，响应符合 shared 里的 schema", async () => {
    const res = await getHealth();
    expect(res.status).toBe(200);
    const body = healthResponseSchema.parse(await res.json());
    expect(body.ok).toBe(true);
    expect(body.app_db).toEqual({ ok: true, error: null });
    expect(body.mail_db.ok).toBe(true);
    expect(body.mail_db.probe?.db_version).toBe("v0.0.11");
    expect(body.mail_db.probe?.capabilities).toEqual({ to_address: true, raw_blob: true, metadata: true });
  });

  it("MAIL_DB 缺 to_address：仍 200，但响应里带能力标记与警告", async () => {
    await setupMailDb({ omitColumns: ["to_address"] });
    const res = await getHealth();
    expect(res.status).toBe(200);
    const body = healthResponseSchema.parse(await res.json());
    expect(body.mail_db.probe?.capabilities.to_address).toBe(false);
    expect(body.mail_db.probe?.warnings.length).toBeGreaterThan(0);
  });

  it("MAIL_DB 缺必需列：503 并明确指出缺哪一列", async () => {
    await setupMailDb({ omitColumns: ["created_at"] });
    const res = await getHealth();
    expect(res.status).toBe(503);
    const body = healthResponseSchema.parse(await res.json());
    expect(body.ok).toBe(false);
    expect(body.app_db.ok).toBe(true);
    expect(body.mail_db.ok).toBe(false);
    expect(body.mail_db.probe?.missing_required).toEqual(["created_at"]);
  });

  it("raw_mails 不存在：503", async () => {
    await setupMailDb({ rawMails: false });
    const res = await getHealth();
    expect(res.status).toBe(503);
    const body = healthResponseSchema.parse(await res.json());
    expect(body.mail_db.probe?.table_exists).toBe(false);
  });

  it("MAIL_DB 查询本身失败：503，错误信息原样暴露，不假装健康", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    const broken = {
      prepare: () => {
        throw new Error("D1 unreachable (synthetic)");
      },
    } as unknown as D1Database;
    const res = await getHealth({ MAIL_DB: broken });
    expect(res.status).toBe(503);
    // 捕获到的异常必须打日志，不能只塞进响应体
    expect(errorLog).toHaveBeenCalledWith(expect.stringContaining("MAIL_DB"), expect.any(Error));
    const body = healthResponseSchema.parse(await res.json());
    expect(body.mail_db.ok).toBe(false);
    expect(body.mail_db.probe).toBeNull();
    expect(body.mail_db.error).toContain("D1 unreachable");
  });
});

describe("全局错误处理", () => {
  it("未知路由返回统一错误体 404", async () => {
    const res = await app.request("/api/nope", {}, env);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: { code: "not_found", message: "资源不存在" } });
  });

  it("未预期异常返回统一错误体 500，且不泄露内部信息", async () => {
    const failing = new Hono<AppEnv>();
    failing.onError(onError);
    failing.get("/boom", () => {
      throw new Error("secret internal detail");
    });
    const res = await failing.request("/boom", {}, env);
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("internal_error");
    expect(JSON.stringify(body)).not.toContain("secret internal detail");
  });
});

describe("ZodError 与 400", () => {
  it("路由边界校验失败（parseWith）→ 400 validation_error", async () => {
    const boundary = new Hono<AppEnv>();
    boundary.onError(onError);
    boundary.get("/check", () => parseWith(z.object({ n: z.number() }), { n: "x" }) && new Response("ok"));
    const res = await boundary.request("/check", {}, env);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("validation_error");
  });

  it("边界之外冒出的 ZodError 是代码缺陷 → 500，且记录日志", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    const leaky = new Hono<AppEnv>();
    leaky.onError(onError);
    leaky.get("/leak", () => {
      z.number().parse("not a number");
      return new Response("unreachable");
    });
    const res = await leaky.request("/leak", {}, env);
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("internal_error");
    expect(errorLog).toHaveBeenCalledWith("unhandled error", expect.any(ZodError));
    errorLog.mockRestore();
  });
});

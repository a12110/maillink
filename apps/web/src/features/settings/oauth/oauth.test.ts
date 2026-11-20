// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AdminOAuthProvider } from "@maillink/shared";
import { click, mount } from "../../../test/render";
import type { Mounted } from "../../../test/render";
import { errorResponse, stubFetch } from "../../../test/http-stub";
import { waitUntil } from "../../../test/wait";
import { ToastProvider } from "../../../ui";
import { OAuthProviders } from "./OAuthProviders";
import { PROVIDER_PRESETS } from "./presets";
import { draftFromProvider, emptyDraft, toCreateInput, toUpdateInput } from "./provider-form";

const PROVIDER: AdminOAuthProvider = {
  id: 7, slug: "google", name: "Google", kind: "oidc", enabled: true,
  issuer: "https://accounts.google.com",
  authorization_endpoint: "https://accounts.google.com/o/oauth2/v2/auth",
  token_endpoint: "https://oauth2.googleapis.com/token",
  userinfo_endpoint: "https://openidconnect.googleapis.com/v1/userinfo",
  jwks_uri: "https://www.googleapis.com/oauth2/v3/certs",
  client_id: "cid", client_secret_set: true, scopes: "openid profile email",
  claim_map: { subject: "sub", email: "email", email_verified: "email_verified", name: "name" },
  allow_signup: false, auto_link_verified_email: false, icon: "google", sort: 0,
  callback_url: "http://localhost:8807/api/auth/oauth/google/callback", created_at: 1, updated_at: 1,
};

describe("提供方草稿 ↔ 接口数据", () => {
  it("编辑：现有配置转草稿再转回，client_secret 留空就不带（服务端保留原值）", () => {
    const result = toUpdateInput(draftFromProvider(PROVIDER));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect("client_secret" in result.value).toBe(false);
    expect(result.value).toMatchObject({ slug: "google", kind: "oidc", client_id: "cid", claim_map: PROVIDER.claim_map, icon: "google", sort: 0 });
  });

  it("编辑：填了新 secret 才带上", () => {
    const result = toUpdateInput({ ...draftFromProvider(PROVIDER), client_secret: "new" });
    expect(result.ok && result.value.client_secret).toBe("new");
  });

  it("新建：client_secret 必填，必填项缺失给中文提示", () => {
    const result = toCreateInput(emptyDraft());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.fields).toMatchObject({ slug: "请填写 slug", name: "请填写名称", client_id: "请填写 client_id", client_secret: "请填写 client_secret", issuer: "OIDC 提供方需要填写 issuer" });
  });

  it("OAuth2 需要三个端点与 scopes；claim 路径格式错误落在对应字段上", () => {
    const github = PROVIDER_PRESETS.find((preset) => preset.id === "oauth2");
    const base = { ...emptyDraft(), ...github?.fields, slug: "x", name: "X", client_id: "c", client_secret: "s" };
    const missing = toCreateInput(base);
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(Object.keys(missing.fields).sort()).toEqual(["authorization_endpoint", "scopes", "token_endpoint", "userinfo_endpoint"]);
    const badClaim = toCreateInput({ ...draftFromProvider(PROVIDER), client_secret: "s", claim_email: "a b" });
    expect(badClaim).toMatchObject({ ok: false, fields: { claim_email: expect.any(String) } });
  });

  it("每份预设填上 client_id / secret 后都是合法的新建请求", () => {
    for (const preset of PROVIDER_PRESETS) {
      const draft = { ...emptyDraft(), ...preset.fields, slug: preset.fields.slug ?? "custom", name: preset.fields.name ?? "Custom", client_id: "c", client_secret: "s",
        issuer: preset.fields.kind === "oauth2" ? "" : (preset.fields.issuer || "https://idp.example.com"),
        ...(preset.id === "oauth2" ? { authorization_endpoint: "https://a.example.com/auth", token_endpoint: "https://a.example.com/token", userinfo_endpoint: "https://a.example.com/me", scopes: "profile" } : {}) };
      expect(toCreateInput(draft), preset.id).toMatchObject({ ok: true });
    }
  });
});

let mounted: Mounted | null = null;
afterEach(async () => {
  await mounted?.unmount();
  mounted = null;
  vi.unstubAllGlobals();
});

const byText = (label: string, scope: ParentNode = document.body) =>
  [...scope.querySelectorAll("button")].find((candidate) => candidate.textContent?.trim().startsWith(label)) as HTMLButtonElement;

describe("提供方列表与编辑对话框", () => {
  async function open() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    mounted = await mount(createElement(QueryClientProvider, { client }, createElement(ToastProvider, null, createElement(OAuthProviders))));
    await waitUntil(() => mounted?.container.textContent?.includes("Google") === true, "列表加载完成");
  }

  it("编辑对话框显示回调地址；已有绑定时改 issuer 被 409 拒绝，界面说明原因", async () => {
    stubFetch({
      "GET /api/admin/oauth-providers": { items: [PROVIDER] },
      "PUT /api/admin/oauth-providers/7": () => errorResponse(409, "oauth_provider_has_identities", "该提供方已有 3 个绑定，修改 issuer 前需先解除这些绑定"),
    });
    await open();
    await click(byText("编辑", mounted?.container));
    expect(document.body.textContent).toContain("http://localhost:8807/api/auth/oauth/google/callback");
    await click(byText("保存"));
    await waitUntil(() => document.body.textContent?.includes("oauth_provider_has_identities") === true, "出现 409 说明");
    expect(document.body.textContent).toContain("同一个 subject");
    expect(document.body.textContent).toContain("已有 3 个绑定");
  });

  it("“从 issuer 自动发现”调用 discover 并填入端点", async () => {
    const { requests } = stubFetch({
      "GET /api/admin/oauth-providers": { items: [PROVIDER] },
      "POST /api/admin/oauth-providers/discover": {
        issuer: "https://accounts.google.com", authorization_endpoint: "https://new.example.com/auth", token_endpoint: "https://new.example.com/token",
        userinfo_endpoint: null, jwks_uri: "https://new.example.com/jwks", scopes_supported: ["openid", "email"],
      },
    });
    await open();
    await click(byText("编辑", mounted?.container));
    await click(byText("从 issuer 自动发现"));
    await waitUntil(() => document.body.textContent?.includes("已填入端点") === true, "发现完成");
    expect(requests.find((request) => request.path.endsWith("/discover"))?.body).toEqual({ issuer: "https://accounts.google.com" });
    const auth = document.body.querySelector<HTMLInputElement>('input[name="authorization_endpoint"]');
    expect(auth?.value).toBe("https://new.example.com/auth");
  });

  it("没有提供方时显示空状态", async () => {
    stubFetch({ "GET /api/admin/oauth-providers": { items: [] } });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    mounted = await mount(createElement(QueryClientProvider, { client }, createElement(ToastProvider, null, createElement(OAuthProviders))));
    await waitUntil(() => mounted?.container.textContent?.includes("还没有 OAuth 提供方") === true, "空状态");
  });
});

import { DEFAULT_CLAIM_MAP, DEFAULT_OIDC_SCOPES } from "@maillink/shared";
import type { ProviderDraft } from "./provider-form";

/** 常见提供方的表单默认值：只是填充草稿，不是特殊代码路径（03 §4.4） */
export type ProviderPreset = { id: string; label: string; note?: string; fields: Partial<ProviderDraft> };

const OIDC_DEFAULTS = {
  kind: "oidc",
  scopes: DEFAULT_OIDC_SCOPES,
  claim_subject: DEFAULT_CLAIM_MAP.subject,
  claim_email: DEFAULT_CLAIM_MAP.email ?? "",
  claim_email_verified: DEFAULT_CLAIM_MAP.email_verified ?? "",
  claim_name: DEFAULT_CLAIM_MAP.name ?? "",
} satisfies Partial<ProviderDraft>;

export const PROVIDER_PRESETS: readonly ProviderPreset[] = [
  {
    id: "google",
    label: "Google",
    fields: { ...OIDC_DEFAULTS, slug: "google", name: "Google", issuer: "https://accounts.google.com", icon: "google" },
  },
  {
    id: "gitlab",
    label: "GitLab",
    fields: { ...OIDC_DEFAULTS, slug: "gitlab", name: "GitLab", issuer: "https://gitlab.com", icon: "gitlab" },
  },
  {
    id: "github",
    label: "GitHub（OAuth2）",
    note: "GitHub 的 /user 接口不提供“邮箱已验证”声明，也可能不返回私密邮箱，所以无法用邮箱自动关联。",
    fields: {
      slug: "github", name: "GitHub", kind: "oauth2", icon: "github",
      issuer: "", jwks_uri: "",
      authorization_endpoint: "https://github.com/login/oauth/authorize",
      token_endpoint: "https://github.com/login/oauth/access_token",
      userinfo_endpoint: "https://api.github.com/user",
      scopes: "read:user user:email",
      claim_subject: "id", claim_email: "email", claim_email_verified: "", claim_name: "name",
    },
  },
  {
    id: "oidc",
    label: "自定义 OIDC（Keycloak、Authentik 等）",
    note: "填 issuer 后点“从 issuer 自动发现”补全端点。",
    fields: { ...OIDC_DEFAULTS },
  },
  {
    id: "oauth2",
    label: "自定义 OAuth2",
    note: "OAuth2 没有发现文档，需要手填授权、令牌与用户信息端点，并确认 claim 路径。",
    fields: {
      kind: "oauth2", issuer: "", jwks_uri: "", scopes: "",
      claim_subject: "id", claim_email: "email", claim_email_verified: "", claim_name: "name",
    },
  },
];

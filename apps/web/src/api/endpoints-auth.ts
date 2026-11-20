import {
  adminGrantListResponseSchema,
  adminMailboxListResponseSchema,
  adminRuleGroupListSchema,
  credentialRemovalResponseSchema,
  grantBatchResponseSchema,
  adminGrantSchema,
  myIdentityListSchema,
  myMailboxListResponseSchema,
  myPasskeyListSchema,
  myPasskeySchema,
  okResponseSchema,
  presentedMailSchema,
  recoveryCodesResponseSchema,
  sessionsRevokedResponseSchema,
  totpSetupResponseSchema,
  visibleMailListResponseSchema,
} from "@maillink/shared";
import type {
  AdminGrantListQuery,
  AdminMailboxListQuery,
  GrantBatchRequest,
  GrantPatch,
  MyMailListQuery,
  PasskeyOptionsRequest,
  PasskeyRegisterVerifyRequest,
  ReauthRequest,
  TotpEnableRequest,
} from "@maillink/shared";
import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from "@simplewebauthn/browser";
import { z } from "zod";
import type { ApiClient } from "./client";

// 登录第二步、通行密钥、账号安全、用户凭据清除、授权、我的邮件。
// 与 endpoints.ts 分开放，由它展开合并（减少多条开发线改同一个文件的冲突）。

/** options 响应是 @simplewebauthn/server 生成的对象，交给浏览器库使用；这里只确认它是带 challenge 的对象 */
function optionsSchema<T extends { challenge: string }>() {
  return z.custom<T>(
    (value) => typeof value === "object" && value !== null && typeof (value as { challenge?: unknown }).challenge === "string",
    "不是有效的 WebAuthn options（缺少 challenge）",
  );
}

const loginOptionsSchema = optionsSchema<PublicKeyCredentialRequestOptionsJSON>();
const registrationOptionsSchema = optionsSchema<PublicKeyCredentialCreationOptionsJSON>();

function userPath(id: number, suffix: string): string {
  return `/api/admin/users/${id}${suffix}`;
}

export function myMailPath(id: number, mailboxId: number | undefined): string {
  return `/api/me/mails/${id}${mailboxId === undefined ? "" : `?mailbox_id=${mailboxId}`}`;
}

export function myMailAttachmentPath(id: number, index: number, mailboxId: number | undefined): string {
  return `/api/me/mails/${id}/attachments/${index}${mailboxId === undefined ? "" : `?mailbox_id=${mailboxId}`}`;
}

/** 发起 OAuth 的整页跳转地址：必须整页导航（302 到提供方），不能用 fetch */
export function oauthStartPath(slug: string, mode: "login" | "link"): string {
  return `/api/auth/oauth/${encodeURIComponent(slug)}/start?mode=${mode}`;
}

export function createAuthEndpoints(client: ApiClient) {
  const { request } = client;
  return {
    // 登录第二步与通行密钥登录：401 在这里是业务结果（验证码错、通行密钥无效），不触发全局“会话过期”跳转
    mfaTotp: (code: string) =>
      request({ method: "POST", path: "/api/auth/mfa/totp", body: { code }, schema: okResponseSchema, handleUnauthorized: false }),
    mfaRecovery: (code: string) =>
      request({ method: "POST", path: "/api/auth/mfa/recovery", body: { code }, schema: okResponseSchema, handleUnauthorized: false }),
    passkeyLoginOptions: () =>
      request({ method: "POST", path: "/api/auth/passkey/options", schema: loginOptionsSchema, handleUnauthorized: false }),
    passkeyLoginVerify: (response: AuthenticationResponseJSON) =>
      request({
        method: "POST",
        path: "/api/auth/passkey/verify",
        body: { response },
        schema: okResponseSchema,
        handleUnauthorized: false,
      }),

    totpSetup: () => request({ method: "POST", path: "/api/me/totp/setup", schema: totpSetupResponseSchema }),
    totpEnable: (body: TotpEnableRequest) =>
      request({ method: "POST", path: "/api/me/totp/enable", body, schema: recoveryCodesResponseSchema }),
    totpDisable: (body: ReauthRequest) => request({ method: "DELETE", path: "/api/me/totp", body, schema: okResponseSchema }),
    regenerateRecoveryCodes: (body: ReauthRequest) =>
      request({ method: "POST", path: "/api/me/recovery-codes", body, schema: recoveryCodesResponseSchema }),

    myPasskeys: () => request({ path: "/api/me/passkeys", schema: myPasskeyListSchema }),
    passkeyRegisterOptions: (body: PasskeyOptionsRequest) =>
      request({ method: "POST", path: "/api/me/passkeys/options", body, schema: registrationOptionsSchema }),
    passkeyRegisterVerify: (body: PasskeyRegisterVerifyRequest) =>
      request({ method: "POST", path: "/api/me/passkeys/verify", body, schema: myPasskeySchema }),
    renamePasskey: (id: number, name: string) =>
      request({ method: "PATCH", path: `/api/me/passkeys/${id}`, body: { name }, schema: okResponseSchema }),
    deletePasskey: (id: number) => request({ method: "DELETE", path: `/api/me/passkeys/${id}`, schema: okResponseSchema }),

    myIdentities: () => request({ path: "/api/me/identities", schema: myIdentityListSchema }),
    deleteIdentity: (id: number) => request({ method: "DELETE", path: `/api/me/identities/${id}`, schema: okResponseSchema }),

    revokeOtherSessions: () =>
      request({ method: "DELETE", path: "/api/me/sessions", query: { scope: "others" }, schema: sessionsRevokedResponseSchema }),

    clearUserTotp: (id: number) =>
      request({ method: "DELETE", path: userPath(id, "/totp"), schema: credentialRemovalResponseSchema }),
    clearUserPasskeys: (id: number, passkeyId?: number) =>
      request({
        method: "DELETE",
        path: userPath(id, passkeyId === undefined ? "/passkeys" : `/passkeys/${passkeyId}`),
        schema: credentialRemovalResponseSchema,
      }),
    clearUserIdentities: (id: number, identityId?: number) =>
      request({
        method: "DELETE",
        path: userPath(id, identityId === undefined ? "/identities" : `/identities/${identityId}`),
        schema: credentialRemovalResponseSchema,
      }),

    listGrants: (query: AdminGrantListQuery) => request({ path: "/api/admin/grants", query, schema: adminGrantListResponseSchema }),
    batchGrants: (body: GrantBatchRequest) =>
      request({ method: "POST", path: "/api/admin/grants/batch", body, schema: grantBatchResponseSchema }),
    patchGrant: (id: number, body: GrantPatch) =>
      request({ method: "PATCH", path: `/api/admin/grants/${id}`, body, schema: adminGrantSchema }),
    deleteGrant: (id: number) => request({ method: "DELETE", path: `/api/admin/grants/${id}`, schema: okResponseSchema }),
    /** 授权表单里的收件地址与规则组选择器（只读列表） */
    pickMailboxes: (query: AdminMailboxListQuery) =>
      request({ path: "/api/admin/mailboxes", query, schema: adminMailboxListResponseSchema }),
    pickRuleGroups: () => request({ path: "/api/admin/rule-groups", schema: adminRuleGroupListSchema }),

    myMailboxes: () => request({ path: "/api/me/mailboxes", schema: myMailboxListResponseSchema }),
    myMails: (query: MyMailListQuery) => request({ path: "/api/me/mails", query, schema: visibleMailListResponseSchema }),
    myMail: (id: number, mailboxId: number | undefined) =>
      request({ path: `/api/me/mails/${id}`, query: { mailbox_id: mailboxId }, schema: presentedMailSchema }),
  };
}

export type AuthEndpoints = ReturnType<typeof createAuthEndpoints>;

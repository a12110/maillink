import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { httpsUrlSchema, OAUTH_CLIENT_ID_MAX_LENGTH, OAUTH_NAME_MAX_LENGTH, OAUTH_SLUG_MAX_LENGTH } from "@maillink/shared";
import type { AdminOAuthProvider, OAuthDiscoverResponse } from "@maillink/shared";
import { api } from "../../../api/instance";
import { Button, Callout, ErrorCallout, Segmented, Select, Status, TextField } from "../../../ui";
import { useCopy } from "../../mail/useCopy";
import { bindText, CheckField } from "../fields";
import type { StringKeys } from "../fields";
import { describeSettingsError } from "../errors";
import { PROVIDER_PRESETS } from "./presets";
import type { ProviderDraft } from "./provider-form";

export type FieldsProps = {
  draft: ProviderDraft;
  errors: Record<string, string>;
  disabled: boolean;
  update: (patch: Partial<ProviderDraft>) => void;
};

const bind = (props: FieldsProps, name: StringKeys<ProviderDraft>) => bindText(props, name);

export function PresetPicker({ update }: { update: (patch: Partial<ProviderDraft>) => void }) {
  const [note, setNote] = useState<string | null>(null);
  return (
    <div className="field">
      <label className="field-label" htmlFor="oauth-preset">从预设开始（可选）</label>
      <Select id="oauth-preset" block defaultValue="" onChange={(event) => {
        const preset = PROVIDER_PRESETS.find((item) => item.id === event.target.value);
        if (!preset) return;
        update(preset.fields);
        setNote(preset.note ?? null);
      }}>
        <option value="">选择一个常见提供方…</option>
        {PROVIDER_PRESETS.map((preset) => <option key={preset.id} value={preset.id}>{preset.label}</option>)}
      </Select>
      <p className="field-hint">预设只是帮你填好端点与 claim 映射，之后都可以修改。client_id 与 client_secret 需要自己填。</p>
      {note ? <Callout tone="warning" title="注意">{note}</Callout> : null}
    </div>
  );
}

export function BasicFields(props: FieldsProps) {
  const { draft, update, disabled } = props;
  return (
    <>
      <div className="field-row">
        <TextField label="名称" maxLength={OAUTH_NAME_MAX_LENGTH} hint="显示在登录按钮上" {...bind(props, "name")} />
        <TextField label="slug" mono maxLength={OAUTH_SLUG_MAX_LENGTH} hint="小写字母、数字、连字符；决定回调地址" {...bind(props, "slug")} />
      </div>
      <Segmented legend="类型" name="oauth-kind" value={draft.kind} disabled={disabled}
        options={[{ value: "oidc", label: "OIDC" }, { value: "oauth2", label: "OAuth2" }]}
        onChange={(kind) => update({ kind })}
        hint="OIDC 校验 id_token，可用 issuer 自动发现端点；OAuth2 只能用用户信息接口，端点要手填。" />
    </>
  );
}

function discoverPatch(doc: OAuthDiscoverResponse, current: ProviderDraft): Partial<ProviderDraft> {
  return {
    issuer: doc.issuer,
    authorization_endpoint: doc.authorization_endpoint,
    token_endpoint: doc.token_endpoint,
    userinfo_endpoint: doc.userinfo_endpoint ?? "",
    jwks_uri: doc.jwks_uri,
    scopes: current.scopes,
  };
}

function DiscoverButton({ props }: { props: FieldsProps }) {
  const { draft, update } = props;
  const [local, setLocal] = useState<string | null>(null);
  const discover = useMutation({
    mutationFn: (issuer: string) => api.discoverOAuthIssuer(issuer),
    onSuccess: (doc) => update(discoverPatch(doc, draft)),
  });
  const run = () => {
    const parsed = httpsUrlSchema.safeParse(draft.issuer);
    setLocal(parsed.success ? null : "issuer 必须是 https 地址");
    if (parsed.success) discover.mutate(parsed.data);
  };
  return (
    <>
      <div className="form-actions">
        <Button size="sm" busy={discover.isPending} busyLabel="读取中…" disabled={props.disabled} onClick={run}>从 issuer 自动发现</Button>
        {discover.isSuccess ? <Status tone="success">已填入端点{discover.data.scopes_supported ? `；服务商支持的 scopes：${discover.data.scopes_supported.join(" ")}` : ""}</Status> : null}
      </div>
      {local ? <p className="field-error">{local}</p> : null}
      {discover.isError ? <ErrorCallout title="自动发现失败" {...describeSettingsError(discover.error)} /> : null}
    </>
  );
}

export function EndpointFields(props: FieldsProps) {
  const oidc = props.draft.kind === "oidc";
  return (
    <>
      {oidc ? (
        <>
          <TextField label="issuer" mono placeholder="https://accounts.example.com" {...bind(props, "issuer")} />
          <DiscoverButton props={props} />
        </>
      ) : null}
      <TextField label="授权端点（authorization_endpoint）" mono {...bind(props, "authorization_endpoint")}
        hint={oidc ? "OIDC 留空时保存会按 issuer 自动补齐" : undefined} />
      <TextField label="令牌端点（token_endpoint）" mono {...bind(props, "token_endpoint")} />
      <TextField label="用户信息端点（userinfo_endpoint）" mono {...bind(props, "userinfo_endpoint")} />
      {oidc ? <TextField label="JWKS 地址（jwks_uri）" mono {...bind(props, "jwks_uri")} /> : null}
    </>
  );
}

export function CredentialFields(props: FieldsProps & { secretSet: boolean | null }) {
  return (
    <>
      <TextField label="client_id" mono maxLength={OAUTH_CLIENT_ID_MAX_LENGTH} autoComplete="off" {...bind(props, "client_id")} />
      <TextField label="client_secret" type="password" mono autoComplete="new-password"
        placeholder={props.secretSet ? "已设置，留空表示不修改" : ""}
        hint="加密保存，之后不会再显示。" {...bind(props, "client_secret")} />
      <TextField label="scopes" mono {...bind(props, "scopes")}
        hint={props.draft.kind === "oidc" ? "空格分隔，必须包含 openid" : "空格分隔，按服务商文档填写"} />
    </>
  );
}

export function ClaimFields(props: FieldsProps) {
  return (
    <fieldset className="claim-fields">
      <legend className="field-label">claim 映射</legend>
      <p className="field-hint">从 id_token 或用户信息里取值的点路径，如 sub、email、profile.email。</p>
      <div className="field-row">
        <TextField label="subject" mono {...bind(props, "claim_subject")} />
        <TextField label="name" mono placeholder="可留空" {...bind(props, "claim_name")} />
        <TextField label="email" mono placeholder="可留空" {...bind(props, "claim_email")} />
        <TextField label="email_verified" mono placeholder="可留空" {...bind(props, "claim_email_verified")} />
      </div>
    </fieldset>
  );
}

export function BehaviorFields(props: FieldsProps) {
  const { draft, update, disabled } = props;
  return (
    <>
      <CheckField label="允许通过它注册新账号" checked={draft.allow_signup} disabled={disabled}
        onChange={(event) => update({ allow_signup: event.target.checked })}
        hint="未绑定的第三方账号首次登录时自动建一个普通用户；关闭则提示先用其他方式登录后在账号页绑定。" />
      <CheckField label="按已验证邮箱自动关联已有用户" checked={draft.auto_link_verified_email} disabled={disabled}
        onChange={(event) => update({ auto_link_verified_email: event.target.checked })}
        hint="默认关闭。" />
      {draft.auto_link_verified_email ? (
        <Callout tone="warning" title="自动关联有被冒名接管的风险">
          部分提供方的邮箱并未真正验证；开启后，别人用同邮箱的第三方账号登录就会进入已有用户的账号。只对确认邮箱已验证的提供方开启（系统只认 email_verified 为 true 的声明）。
        </Callout>
      ) : null}
      <CheckField label="启用" checked={draft.enabled} disabled={disabled}
        onChange={(event) => update({ enabled: event.target.checked })}
        hint="停用后登录页不再显示，已绑定的用户若没有其他登录方式会无法登录。" />
      <div className="field-row">
        <TextField label="图标" mono placeholder="如 google，或 https 图片地址" hint="内置图标名或 https 地址；留空只显示名称" {...bind(props, "icon")} />
        <TextField label="排序" inputMode="numeric" hint="数字小的在前" {...bind(props, "sort")} />
      </div>
    </>
  );
}

export function CallbackUrl({ provider, slug }: { provider: AdminOAuthProvider | null; slug: string }) {
  const { copy, error } = useCopy();
  const url = provider?.callback_url ?? `${window.location.origin}/api/auth/oauth/${slug.trim() || "<slug>"}/callback`;
  return (
    <div className="field">
      <span className="field-label">回调地址</span>
      <div className="copy-row">
        <code className="copy-value">{url}</code>
        <Button size="sm" onClick={() => void copy(url, "回调地址已复制")}>复制</Button>
      </div>
      <p className="field-hint">
        {provider ? "把它登记到提供方后台的“重定向 URI”。" : "把它登记到提供方后台的“重定向 URI”；这里按当前访问地址推算，保存后以服务端给出的 PUBLIC_ORIGIN 地址为准。"}
      </p>
      {error ? <p className="field-error">复制失败：{error}</p> : null}
    </div>
  );
}

export function EditNotice() {
  return (
    <Callout title="已有用户绑定时，部分字段不能改">
      如果已有用户绑定了这个提供方，修改类型、issuer、各端点或 client_id 会被拒绝（409 oauth_provider_has_identities）：换成另一个身份提供方后，同一个 subject 可能对应另一个人。名称、scopes、claim 映射、开关等其他字段不受影响。需要换提供方时，先让用户解除绑定，或删除后重建。
    </Callout>
  );
}

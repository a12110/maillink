import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { AdminShareLink } from "@maillink/shared";
import { LINK_API_PASSWORD_BASE64_HEADER } from "@maillink/shared";
import { api } from "../../api/instance";
import { linkKeys } from "../../api/links-queries";
import { describeError } from "../../lib/messages";
import { Callout, ErrorCallout, Switch, useToast } from "../../ui";
import { API_TOGGLE_LABEL } from "./CreateAccessStep";
import { API_SHARE_WARNING, API_TOKEN_PLACEHOLDER, accessWithApi, apiCodeUrl, curlExample } from "./api-code";

type Props = { link: AdminShareLink; origin: string };

/** 侧板“API 取码”：开关、接口地址（token 用占位）、curl 示例。完整地址在“复制链接”里给出 */
export function ApiSection({ link, origin }: Props) {
  const { access } = link;
  const queryClient = useQueryClient();
  const toast = useToast();
  const toggle = useMutation({
    mutationFn: (next: boolean) => api.updateLink(link.id, { access: accessWithApi(access, next) }),
    onSuccess: async (updated) => {
      await queryClient.invalidateQueries({ queryKey: linkKeys.all });
      toast.success(updated.access.api ? "已允许 API 取码" : "已关闭 API 取码");
    },
  });
  const url = apiCodeUrl(origin, API_TOKEN_PLACEHOLDER);
  const revoked = link.status === "revoked";
  return (
    <section className="panel-section" aria-labelledby="link-api">
      <h3 className="section-title" id="link-api">API 取码</h3>
      <label className="api-toggle">
        <Switch aria-label={API_TOGGLE_LABEL} checked={access.api} disabled={revoked || toggle.isPending} onChange={(event) => toggle.mutate(event.target.checked)} />
        <span>{API_TOGGLE_LABEL}</span>
      </label>
      {toggle.isError ? <ErrorCallout title="修改失败" {...describeError(toggle.error)} /> : null}
      {access.api && access.turnstile ? (
        <Callout tone="warning" title="这个链接开了人机验证">接口会返回 403 turnstile_required；需要 API 取码请关闭人机验证。</Callout>
      ) : null}
      <div className="api-block">
        <span className="field-label">接口地址</span>
        <code className="api-url">GET {url}</code>
      </div>
      <div className="api-block">
        <span className="field-label">curl 示例</span>
        <pre className="api-curl" tabIndex={0} aria-label="curl 示例">{curlExample(url, access.has_password)}</pre>
      </div>
      <p className="field-hint api-warning" role="note">{API_SHARE_WARNING}</p>
      <ul className="api-notes">
        <li>{API_TOKEN_PLACEHOLDER} 是完整 token：在“复制链接”里取得（会写审计），那里同时给出完整的接口地址。</li>
        {access.has_password ? <li>口令含中文等非 ASCII 字符时，改用 {LINK_API_PASSWORD_BASE64_HEADER} 头（UTF-8 字节的 base64）。</li> : null}
        <li>按响应里的 retry_after_sec 轮询；接口占 1 台设备，取码次数与取件页共用。</li>
      </ul>
    </section>
  );
}

import {
  LINK_DEFAULT_EXPIRES_DAYS_MAX,
  LINK_POLL_INTERVAL_MAX_SEC,
  LINK_POLL_INTERVAL_MIN_SEC,
  LOG_RETENTION_DAYS_MAX,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
} from "@maillink/shared";
import { TextField } from "../../ui";
import { bindText, CheckField } from "./fields";
import { SettingsGroupForm } from "./SettingsGroupForm";
import type { FormContext } from "./SettingsGroupForm";

// 安全、取件链接默认值、日志：字段少、结构简单，放在一个文件里。

function SecurityFields(context: FormContext<"security">) {
  const { draft, update, disabled } = context;
  return (
    <>
      <CheckField label="管理员必须通过两步验证" checked={draft.admin_require_2fa} disabled={disabled}
        onChange={(event) => update({ admin_require_2fa: event.target.checked })}
        hint="开启后，没有第二因素（TOTP 或通行密钥）的管理员无法访问管理接口。保存时会检查至少有一个管理员已经具备。" />
      <TextField label="会话空闲时长（小时）" inputMode="decimal" hint="超过这段时间没有操作，会话失效。最短 1 小时。" {...bindText(context, "session_idle_hours")} />
      <TextField label="会话绝对时长（天）" inputMode="decimal" hint="从登录起最长保持的时间，不能短于空闲时长。最长 365 天。" {...bindText(context, "session_absolute_days")} />
      <TextField label="密码最小长度" inputMode="numeric" hint={`${PASSWORD_MIN_LENGTH}–${PASSWORD_MAX_LENGTH}；只影响新设置的密码，老用户照常登录。`} {...bindText(context, "password_min_length")} />
    </>
  );
}

export function SecurityForm() {
  return <SettingsGroupForm group="security">{(context) => <SecurityFields {...context} />}</SettingsGroupForm>;
}

function LinksFields(context: FormContext<"links">) {
  const { draft, update, disabled } = context;
  return (
    <>
      <TextField label="默认有效天数" inputMode="numeric" placeholder="留空 = 默认不过期"
        hint={`新建取件链接时预填；1–${LINK_DEFAULT_EXPIRES_DAYS_MAX} 天，留空表示默认不过期。`} {...bindText(context, "default_expires_in_days")} />
      <TextField label="默认轮询间隔（秒）" inputMode="numeric"
        hint={`取件页自动刷新的间隔，${LINK_POLL_INTERVAL_MIN_SEC}–${LINK_POLL_INTERVAL_MAX_SEC} 秒。`} {...bindText(context, "default_poll_interval_sec")} />
      <CheckField label="取件页显示站点品牌" checked={draft.show_brand} disabled={disabled}
        onChange={(event) => update({ show_brand: event.target.checked })}
        hint="显示站点名称与 Logo（Logo 只有上传的图片才会显示）。" />
    </>
  );
}

export function LinksForm() {
  return <SettingsGroupForm group="links">{(context) => <LinksFields {...context} />}</SettingsGroupForm>;
}

function LogsFields(context: FormContext<"logs">) {
  const hint = `1–${LOG_RETENTION_DAYS_MAX} 天；超期记录由每日定时任务清理。`;
  return (
    <>
      <TextField label="访问日志保留天数" inputMode="numeric" hint={hint} {...bindText(context, "access_retention_days")} />
      <TextField label="审计日志保留天数" inputMode="numeric" hint={hint} {...bindText(context, "audit_retention_days")} />
    </>
  );
}

export function LogsForm() {
  return <SettingsGroupForm group="logs">{(context) => <LogsFields {...context} />}</SettingsGroupForm>;
}

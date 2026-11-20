import { useQuery } from "@tanstack/react-query";
import type { CronRun, SystemSettings } from "@maillink/shared";
import { settingsGroupQuery } from "../../api/queries";
import { formatFullDateTime } from "../../lib/format";
import { Button, Callout, ErrorCallout, Status, Tag } from "../../ui";
import { describeSettingsError } from "./errors";

/** 探测结果里已经有“缺表 / 缺列”的具体说明时，不再重复显示笼统的读取失败 */
function probeExplains(system: SystemSettings): boolean {
  const probe = system.mail_db.probe;
  return probe !== null && (!probe.table_exists || probe.missing_required.length > 0);
}

function MailDbAlerts({ system }: { system: SystemSettings }) {
  const { mail_db: mailDb } = system;
  const probe = mailDb.probe;
  return (
    <>
      {!mailDb.ok && !probeExplains(system) ? (
        <Callout tone="danger" title="无法读取邮件库（MAIL_DB）">{mailDb.error ?? "探测失败，没有更多信息"}</Callout>
      ) : null}
      {probe && !probe.table_exists ? (
        <Callout tone="danger" title="邮件库里没有 raw_mails 表">请确认 MAIL_DB 绑定的是 cloudflare_temp_email 使用的那个 D1 数据库。</Callout>
      ) : null}
      {probe && probe.table_exists && probe.missing_required.length > 0 ? (
        <Callout tone="danger" title={`邮件库缺少必需列：${probe.missing_required.join("、")}`}>
          缺列期间邮件读取会失败关闭（不显示任何邮件）。请检查 cloudflare_temp_email 的版本与迁移。
        </Callout>
      ) : null}
      {probe?.warnings.map((warning) => (
        <Callout key={warning} tone="warning" title="邮件库提示">{warning}</Callout>
      ))}
    </>
  );
}

function CronLine({ run }: { run: CronRun | null }) {
  if (run === null) return <Status tone="neutral">从未运行</Status>;
  const processed = Object.entries(run.processed).map(([name, count]) => `${name} ${count}`).join("，");
  return (
    <>
      <Status tone={run.ok ? "success" : "danger"}>{run.ok ? "成功" : "失败"} · {formatFullDateTime(run.started_at)}</Status>
      {processed ? <span className="cron-detail">{processed}</span> : null}
      {run.error ? <span className="field-error">{run.error}</span> : null}
    </>
  );
}

function Capability({ label, on }: { label: string; on: boolean }) {
  return <Tag tone={on ? "success" : "warning"}>{label}：{on ? "有" : "无"}</Tag>;
}

function Tags({ names }: { names: string[] | null }) {
  return <dd className="cell-tags-wrap">{names ? names.map((name) => <Tag key={name}>{name}</Tag>) : "—"}</dd>;
}

function MailDbRows({ system }: { system: SystemSettings }) {
  const probe = system.mail_db.probe;
  const healthy = system.mail_db.ok && probe?.healthy === true;
  return (
    <>
      <dt>MAIL_DB</dt>
      <dd><Status tone={healthy ? "success" : "danger"}>{healthy ? "正常" : "异常"}</Status></dd>
      <dt>db_version</dt>
      <dd className="mono">{system.db_version ?? "未知（表或键不存在）"}</dd>
      <dt>raw_mails 列</dt>
      <Tags names={probe?.columns ?? null} />
      <dt>可选能力</dt>
      <dd className="cell-tags-wrap">
        {probe ? (
          <>
            <Capability label="to_address" on={probe.capabilities.to_address} />
            <Capability label="raw_blob" on={probe.capabilities.raw_blob} />
            <Capability label="metadata" on={probe.capabilities.metadata} />
          </>
        ) : "—"}
      </dd>
    </>
  );
}

function BindingRow({ name, ok, missing }: { name: string; ok: boolean; missing: string }) {
  return (
    <>
      <dt>{name}</dt>
      <dd><Status tone={ok ? "success" : "danger"}>{ok ? "已配置" : missing}</Status></dd>
    </>
  );
}

function SystemDetails({ system }: { system: SystemSettings }) {
  const { app_db: appDb, rate_limit: rate, cron } = system;
  return (
    <dl className="kv kv-wide">
      <dt>APP_DB</dt>
      <dd><Status tone={appDb.ok ? "success" : "danger"}>{appDb.ok ? "正常" : (appDb.error ?? "异常")}</Status></dd>
      <MailDbRows system={system} />
      <dt>mail_index 行数</dt>
      <dd className="num">{system.mail_index_rows.toLocaleString("zh-CN")}</dd>
      <dt>预热任务</dt>
      <dd className="cron-line"><CronLine run={cron.prewarm} /></dd>
      <dt>清理任务</dt>
      <dd className="cron-line"><CronLine run={cron.cleanup} /></dd>
      <BindingRow name="RATE_LIMITER" ok={rate.configured} missing="未配置（登录等接口会返回 503）" />
      <BindingRow name="LINK_RATE_LIMITER" ok={rate.link_configured} missing="未配置（取件链接接口会返回 503）" />
    </dl>
  );
}

export function SystemPanel() {
  const query = useQuery(settingsGroupQuery("system"));
  if (query.isError) {
    return <ErrorCallout title="系统状态读取失败" {...describeSettingsError(query.error)} onRetry={() => void query.refetch()} />;
  }
  if (!query.data) return <span className="skeleton" aria-label="加载中" />;
  const system = query.data;
  return (
    <div className="settings-form">
      <div className="section-row">
        <Status tone={system.ok ? "success" : "danger"}>{system.ok ? "系统整体正常" : "系统有异常，见下方"}</Status>
        <Button size="sm" busy={query.isFetching} busyLabel="刷新中…" onClick={() => void query.refetch()}>刷新</Button>
      </div>
      <MailDbAlerts system={system} />
      <SystemDetails system={system} />
    </div>
  );
}

import type { ReactNode } from "react";
import type { AdminShareLink } from "@maillink/shared";
import { formatDateTime, formatFullDateTime } from "../../lib/format";
import { Callout, Status } from "../../ui";
import { ANOMALY_HINT, ANOMALY_LABEL, STATE_LABEL, STATE_TONE, devicesText } from "./labels";

const DASH = <span className="dim">—</span>;
const SEC_PER_HOUR = 3600;
const SEC_PER_DAY = 86_400;

function spanText(seconds: number): string {
  if (seconds % SEC_PER_DAY === 0) return `${seconds / SEC_PER_DAY} 天`;
  if (seconds % SEC_PER_HOUR === 0) return `${seconds / SEC_PER_HOUR} 小时`;
  return `${Math.round(seconds / 60)} 分钟`;
}

function Time({ value }: { value: number | null }) {
  return value === null ? DASH : <span className="mono">{formatFullDateTime(value)}</span>;
}

export function OverviewSection({ link }: { link: AdminShareLink }) {
  return (
    <section className="panel-section" aria-labelledby="link-overview">
      <h3 className="section-title" id="link-overview">概览</h3>
      <dl className="kv">
        <dt>状态</dt>
        <dd><Status tone={STATE_TONE[link.state]}>{STATE_LABEL[link.state]}</Status></dd>
        <dt>订单号</dt>
        <dd>{link.order_ref ?? DASH}</dd>
        <dt>规则组</dt>
        <dd>{link.rule_group.name}</dd>
        <dt>收件地址</dt>
        <dd>
          {link.mailboxes.length === 0 ? DASH : (
            <ul className="plain-list">
              {link.mailboxes.map((mailbox) => (
                <li key={mailbox.id} className="mono">
                  {mailbox.address}
                  {mailbox.status !== "active" ? <span className="dim"> （已停用）</span> : null}
                </li>
              ))}
            </ul>
          )}
        </dd>
        <dt>链接</dt>
        <dd className="mono">…{link.token_hint}（前 6 位，仅供辨认）</dd>
        <dt>创建</dt>
        <dd><Time value={link.created_at} /></dd>
        <dt>首次取码</dt>
        <dd><Time value={link.first_access_at} /></dd>
        <dt>最近访问</dt>
        <dd><Time value={link.last_access_at} /></dd>
      </dl>
    </section>
  );
}

function ExpiryRows({ link }: { link: AdminShareLink }) {
  return (
    <>
      <dt>生效时间</dt>
      <dd>{link.valid_from === null ? "创建即生效" : <Time value={link.valid_from} />}</dd>
      <dt>过期时间</dt>
      <dd>{link.expires_at === null ? "不按日期过期" : <Time value={link.expires_at} />}</dd>
      <dt>首次取码后</dt>
      <dd>{link.expire_after_first_access_sec === null ? DASH : `${spanText(link.expire_after_first_access_sec)}后失效`}</dd>
      <dt>实际截止</dt>
      <dd>{link.effective_expires_at === null ? "不过期（首次取码前未开始计时）" : <Time value={link.effective_expires_at} />}</dd>
    </>
  );
}

function limitsText(link: AdminShareLink): string {
  const { max_deliveries_total: total, max_deliveries_per_day: daily } = link.access;
  const parts = [total === undefined ? null : `总共 ${total} 次`, daily === undefined ? null : `每 24 小时 ${daily} 次`].filter((part) => part !== null);
  return parts.length === 0 ? "不限" : parts.join("，");
}

function list(values: readonly string[]): ReactNode {
  return values.length === 0 ? "不限" : <span className="mono">{values.join("  ")}</span>;
}

export function AccessSection({ link }: { link: AdminShareLink }) {
  const { access } = link;
  return (
    <section className="panel-section" aria-labelledby="link-access">
      <h3 className="section-title" id="link-access">访问约束</h3>
      <dl className="kv">
        <ExpiryRows link={link} />
        <dt>口令</dt>
        <dd>{access.has_password ? "已设置" : "无"}</dd>
        <dt>设备数上限</dt>
        <dd>{access.max_devices === undefined ? "不限" : `${access.max_devices} 台`}</dd>
        <dt>取码方式</dt>
        <dd>{access.reveal === "click" ? "点击取码" : "自动显示"}</dd>
        <dt>取码次数</dt>
        <dd>{limitsText(link)}</dd>
        <dt>IP 白名单</dt>
        <dd>{list(access.ip_allow)}</dd>
        <dt>国家白名单</dt>
        <dd>{list(access.country_allow)}</dd>
        <dt>轮询间隔</dt>
        <dd>{access.poll_interval_sec} 秒</dd>
        <dt>人机验证</dt>
        <dd>{access.turnstile ? "开启（Turnstile）" : "关闭"}</dd>
        <dt>买家标题</dt>
        <dd className="pre-wrap">{link.public_title ?? DASH}</dd>
        <dt>买家说明</dt>
        <dd className="pre-wrap">{link.public_note ?? DASH}</dd>
      </dl>
    </section>
  );
}

export function StatsSection({ link }: { link: AdminShareLink }) {
  return (
    <section className="panel-section" aria-labelledby="link-stats">
      <h3 className="section-title" id="link-stats">统计</h3>
      <dl className="kv">
        <dt>设备数</dt>
        <dd className="num">{devicesText(link)}</dd>
        <dt>访问国家数</dt>
        <dd className="num">{link.country_count}</dd>
        <dt>近 24 小时取码</dt>
        <dd className="num">{link.deliveries_24h}</dd>
        <dt>累计取码</dt>
        <dd className="num">{link.deliveries_total}</dd>
        <dt>起始时间重置</dt>
        <dd>{link.anchor_reset_at === null ? DASH : formatDateTime(link.anchor_reset_at)}</dd>
      </dl>
      {link.anomalies.map((anomaly) => (
        <Callout key={anomaly} tone="warning" title={ANOMALY_LABEL[anomaly]}>
          {ANOMALY_HINT[anomaly]}
        </Callout>
      ))}
    </section>
  );
}

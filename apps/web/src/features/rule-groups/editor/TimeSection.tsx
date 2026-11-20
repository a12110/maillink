import { useId } from "react";
import type { RuleGroupConfig, RuleGroupIssue } from "@maillink/shared";
import { MS_PER_SECOND } from "../../../constants";
import { Select } from "../../../ui";
import { issuesAt } from "../issues";
import { FieldIssues } from "./FieldIssues";
import { NumberField } from "./NumberField";

type SinceType = RuleGroupConfig["time"]["since"]["type"];

const ANCHOR_OPTIONS: ReadonlyArray<{ value: SinceType; label: string; hint: string }> = [
  { value: "none", label: "无", hint: "不按链接或授权的时间限制，只受滚动窗口约束。" },
  { value: "subject_created", label: "链接创建时", hint: "从链接（或授权）创建的那一刻起算，新买家看不到上一个人时的历史邮件。" },
  { value: "first_access", label: "买家首次取码时", hint: "从访客点“开始取码”那一刻起算；库存链接提前生成、卖出才打开，所以不按创建时间算。首次打开前只看得到“往前多看”之内的邮件。" },
  { value: "fixed", label: "固定时间", hint: "只显示这个时间之后收到的邮件。" },
];

const SECONDS_PER_MINUTE = 60;
const PAD = 2;
const pad = (n: number) => String(n).padStart(PAD, "0");

function toLocalInput(unixSec: number | undefined): string {
  if (unixSec === undefined) return "";
  const d = new Date(unixSec * MS_PER_SECOND);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromLocalInput(text: string): number | undefined {
  const ms = new Date(text).getTime();
  return text === "" || Number.isNaN(ms) ? undefined : Math.floor(ms / MS_PER_SECOND / SECONDS_PER_MINUTE) * SECONDS_PER_MINUTE;
}

type Props = { config: RuleGroupConfig; issues: readonly RuleGroupIssue[]; onChange: (update: (c: RuleGroupConfig) => RuleGroupConfig) => void };

function FixedAtField({ at, issues, onChange }: { at: number | undefined; issues: readonly RuleGroupIssue[]; onChange: (at: number | undefined) => void }) {
  const id = useId();
  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>起始时间</label>
      <input id={id} className="input" type="datetime-local" value={toLocalInput(at)} aria-invalid={issues.some((i) => i.severity === "error") ? "true" : undefined}
        onChange={(event) => onChange(fromLocalInput(event.target.value))} />
      <FieldIssues issues={issues} />
    </div>
  );
}

/** ① 时间：滚动窗口、起始锚点、往前多看（02 §3.1） */
export function TimeSection({ config, issues, onChange }: Props) {
  const { time } = config;
  const anchorId = useId();
  const anchor = ANCHOR_OPTIONS.find((option) => option.value === time.since.type);
  const anchored = time.since.type === "subject_created" || time.since.type === "first_access";
  const setTime = (patch: Partial<RuleGroupConfig["time"]>) => onChange((c) => ({ ...c, time: { ...c.time, ...patch } }));
  const setSince = (patch: Partial<RuleGroupConfig["time"]["since"]>) => setTime({ since: { ...time.since, ...patch } });
  const at = issuesAt(issues, ["time", "since", "at"]);
  return (
    <section aria-labelledby="s-time">
      <h2 className="section-title" id="s-time"><span className="idx">1</span>时间</h2>
      <p className="section-lead">决定邮件“多新”才会被看到。时间以邮件入库时间为准，不是邮件的 Date 头。</p>
      <div className="form-grid cols-3">
        <NumberField label="滚动窗口" suffix="分钟" value={time.window_minutes} placeholder="不限制" error={issuesAt(issues, ["time", "window_minutes"])[0]?.message}
          hint={time.window_minutes === undefined ? "不填 = 不限制窗口。" : `只显示最近 ${time.window_minutes} 分钟内收到的邮件。`}
          onChange={(minutes) => setTime({ window_minutes: minutes })} />
        <div className="field">
          <label className="field-label" htmlFor={anchorId}>起始锚点</label>
          <Select id={anchorId} block value={time.since.type}
            onChange={(event) => setSince({ type: event.target.value as SinceType, at: undefined })}>
            {ANCHOR_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </Select>
          <p className="field-hint">{anchor?.hint}</p>
        </div>
        <NumberField label="往前多看" suffix="分钟" value={time.since.lookback_minutes} placeholder="0" disabled={!anchored}
          error={issuesAt(issues, ["time", "since", "lookback_minutes"])[0]?.message}
          hint={anchored ? "买家常先点“发送验证码”，再打开链接。" : "只对“链接创建时”和“买家首次取码时”生效。"}
          onChange={(minutes) => setSince({ lookback_minutes: minutes })} />
      </div>
      {time.since.type === "fixed" ? <div className="form-grid cols-3 editor-gap"><FixedAtField at={time.since.at} issues={at} onChange={(value) => setSince({ at: value })} /></div> : null}
    </section>
  );
}

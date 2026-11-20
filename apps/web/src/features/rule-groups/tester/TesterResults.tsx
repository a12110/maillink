import { RefreshCw } from "lucide-react";
import type { RuleGroupTestResponse } from "@maillink/shared";
import { formatDateTime } from "../../../lib/format";
import { Button, Callout } from "../../../ui";
import { summarizeItems } from "./tester-state";
import { TesterItem } from "./TesterItem";

type Props = { result: RuleGroupTestResponse; stale: boolean; busy: boolean; now: Date; onRerun: () => void };

/** 汇总行 + 逐封列表；stale = 当前显示的是上一份配置的结果（正在重跑或配置暂时无效） */
export function TesterResults({ result, stale, busy, now, onRerun }: Props) {
  const summary = summarizeItems(result.items);
  return (
    <>
      <div className="tester-sum" data-stale={stale ? "true" : undefined}>
        <span>最近 <b className="num">{summary.total}</b> 封</span>
        <span><span className="dot" data-tone="success" aria-hidden="true" /> 可见 <b className="num">{summary.visible}</b></span>
        <span><span className="dot" aria-hidden="true" /> 不可见 <b className="num">{summary.hidden}</b></span>
        <span className="spacer" />
        <Button size="sm" variant="ghost" busy={busy} busyLabel="试跑中…" onClick={onRerun}><RefreshCw className="icon-sm" />重新试跑</Button>
      </div>
      {result.time_lower_bound !== null ? <p className="tester-note">有效时间下界 {formatDateTime(result.time_lower_bound, now)}，更早收到的邮件不可见。</p> : null}
      {result.partial ? (
        <div className="tester-note">
          <Callout tone="warning" title="有邮件本次没解析到">这些邮件显示为 pending，点“重新试跑”稍后再看；它们的可见性目前不能确定。</Callout>
        </div>
      ) : null}
      {result.items.length === 0 ? <p className="tester-note">这个地址（或这些 id）下没有邮件可以试跑。</p> : (
        <ul className="tester-list" aria-busy={busy}>
          {result.items.map((item) => <TesterItem key={item.mail_id} item={item} now={now} />)}
        </ul>
      )}
    </>
  );
}

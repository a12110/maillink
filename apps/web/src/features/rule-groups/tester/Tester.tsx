import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { adminMailboxesQuery } from "../../../api/queries";
import { SEARCH_DEBOUNCE_MS } from "../../../constants";
import { useDebouncedValue } from "../../../hooks/useDebouncedValue";
import { describeError } from "../../../lib/messages";
import { Callout, ErrorCallout } from "../../../ui";
import { FieldIssues } from "../editor/FieldIssues";
import { localInputToUnix } from "../../mails/search";
import { TesterResults } from "./TesterResults";
import { TesterControls } from "./TesterControls";
import { useRuleGroupTest } from "./useRuleGroupTest";

const SUGGEST_LIMIT = 20;

/** 预选的收件地址：最近来过信的那个（没有邮件的地址试跑不出结果）；都没来过信就取第一个 */
export function preferredAddress(items: ReadonlyArray<{ address: string; last_received_at: number | null }> | undefined): string | undefined {
  if (!items) return undefined;
  const withMail = items.filter((item) => item.last_received_at !== null);
  const latest = withMail.reduce<(typeof items)[number] | undefined>((best, item) => (best === undefined || (item.last_received_at ?? 0) > (best.last_received_at ?? 0) ? item : best), undefined);
  return (latest ?? items[0])?.address;
}

/** 收件地址候选：输入的是地址片段时按它搜，数字（邮件 id）不搜 */
function useMailboxSuggestions(text: string) {
  const q = useDebouncedValue(text.trim(), SEARCH_DEBOUNCE_MS);
  const search = q === "" || /^[\d\s,，]+$/u.test(q) ? undefined : q;
  return useQuery(adminMailboxesQuery({ q: search, limit: SUGGEST_LIMIT }));
}

type TestState = ReturnType<typeof useRuleGroupTest>;

function BlockedNote({ blocking }: { blocking: number }) {
  return (
    <div className="tester-note">
      <Callout tone="warning" title={`配置有 ${blocking} 个错误，暂时无法试跑`}>在左侧修好后会自动重新试跑；错误就显示在对应字段旁。</Callout>
    </div>
  );
}

function FailureNote({ test }: { test: TestState }) {
  return (
    <div className="tester-note">
      <ErrorCallout title="试跑失败" {...describeError(test.query.error)} onRetry={() => void test.query.refetch()} />
      <FieldIssues issues={test.serverIssues?.errors ?? []} />
    </div>
  );
}

function Body({ test, now }: { test: TestState; now: Date }) {
  const { query } = test;
  if (test.targetError) return <p className="tester-note field-error">{test.targetError}</p>;
  if (test.blocking > 0 && !query.data) return <BlockedNote blocking={test.blocking} />;
  if (query.isError) return <FailureNote test={test} />;
  if (!query.data) {
    return <p className="tester-note">{test.enabled ? "试跑中…" : "选一个收件地址（或粘贴邮件 id），用左侧当前的配置试跑最近的邮件。"}</p>;
  }
  const stale = query.isPlaceholderData || test.blocking > 0 || test.pending;
  return <TesterResults result={query.data} stale={stale} busy={query.isFetching} now={now} onRerun={() => void query.refetch()} />;
}

function headStatus(test: TestState): { tone: "success" | "warning"; text: string } {
  if (test.blocking > 0) return { tone: "warning", text: "配置有错误，暂停试跑" };
  if (test.pending) return { tone: "warning", text: "改动后自动试跑…" };
  return { tone: "success", text: "用当前未保存的配置试跑" };
}

type Props = { config: unknown; initialTarget?: string };

/** 右侧常驻测试器：改左边、右边跟着变（配置改动防抖后重跑） */
export function Tester({ config, initialTarget }: Props) {
  const [target, setTarget] = useState(initialTarget ?? "");
  // 带了默认目标就当作已经选过，不再被“最近来信的地址”覆盖
  const [touched, setTouched] = useState(initialTarget !== undefined);
  const [anchor, setAnchor] = useState("");
  const suggestions = useMailboxSuggestions(target);
  const first = preferredAddress(suggestions.data?.items);
  // 还没手动输入过时，预选第一个收件地址，打开页面就有结果
  useEffect(() => {
    if (!touched && target === "" && first) setTarget(first);
  }, [touched, target, first]);
  const test = useRuleGroupTest(config, target, localInputToUnix(anchor, "start"));
  const status = headStatus(test);
  return (
    <aside className="tester" aria-label="规则测试器">
      <div className="tester-head">
        <h2>测试器 <small><span className="dot" data-tone={status.tone} aria-hidden="true" />{status.text}</small></h2>
        <TesterControls target={target} anchor={anchor} suggestions={suggestions.data?.items.map((m) => m.address) ?? []}
          onTarget={(value) => { setTouched(true); setTarget(value); }} onAnchor={setAnchor} />
      </div>
      <Body test={test} now={new Date()} />
    </aside>
  );
}

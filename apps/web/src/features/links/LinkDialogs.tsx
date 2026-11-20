import { useMutation } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { AdminShareLink } from "@maillink/shared";
import { api } from "../../api/instance";
import { describeError } from "../../lib/messages";
import { Button, ErrorCallout, FormDialog } from "../../ui";
import { BatchResultDialog, ExtendDialog, RevokeDialog, RuleGroupDialog } from "./BatchDialogs";
import { buildBatch, summarizeBatch } from "./batch";
import type { BatchSummary } from "./batch";
import { CreateLinkDialog } from "./CreateLinkDialog";
import { ExportPanel } from "./ExportPanel";
import { CopyLinkDialog, RebindDialog, ResetDevicesDialog, RotateDialog } from "./LinkOpDialogs";

export type DialogState =
  | { kind: "create"; preselected: number[] }
  | { kind: "copy"; link: AdminShareLink }
  | { kind: "rebind"; link: AdminShareLink }
  | { kind: "reset"; link: AdminShareLink }
  | { kind: "rotate"; link: AdminShareLink }
  | { kind: "extend"; ids: number[] }
  | { kind: "revoke"; ids: number[] }
  | { kind: "ruleGroup"; ids: number[] }
  | { kind: "export"; ids: number[] }
  | { kind: "quick"; action: "pause" | "resume"; ids: number[] };

type Props = {
  dialog: DialogState | null;
  labelOf: (id: number) => string;
  onClose: () => void;
  /** 数据变了：刷新列表；message 非空时提示成功 */
  onChanged: (message?: string) => void;
};

const DONE_TEXT = {
  extend: "已延长有效期",
  revoke: "已撤销",
  ruleGroup: "已换规则组",
  pause: "已暂停",
  resume: "已恢复",
} as const;

type Result = { title: string; summary: BatchSummary };

/** 暂停 / 恢复不需要确认：一打开就执行，有没改动的再逐条列出原因 */
function QuickBatch({ action, ids, onFinished, onClose }: { action: "pause" | "resume"; ids: number[]; onFinished: (summary: BatchSummary) => void; onClose: () => void }) {
  const started = useRef(false);
  const run = useMutation({
    mutationFn: () => api.batchLinks(action === "pause" ? buildBatch.pause(ids) : buildBatch.resume(ids)),
    onSuccess: (response) => onFinished(summarizeBatch(response)),
  });
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    run.mutate();
  }, [run]);
  if (!run.isError) return null;
  return (
    <FormDialog open onOpenChange={(open) => !open && onClose()} title={action === "pause" ? "暂停失败" : "恢复失败"} description="请求没有完成，链接状态没有变化。" footer={<Button onClick={onClose}>关闭</Button>}>
      <ErrorCallout title="操作失败" {...describeError(run.error)} />
    </FormDialog>
  );
}

type Ctx = {
  onClose: () => void;
  onChanged: (message?: string) => void;
  /** 批量接口返回后：关闭对话框、刷新列表；有没改动的条目时转到逐条结果 */
  finish: (title: string, text: string) => (summary: BatchSummary) => void;
};

type DialogOf<K extends DialogState["kind"]> = Extract<DialogState, { kind: K }>;

function ExportDialog({ ids, onClose }: { ids: number[]; onClose: () => void }) {
  return (
    <FormDialog open onOpenChange={(open) => !open && onClose()} title="导出取件链接" description={`导出选中的 ${ids.length} 个链接（含完整链接）。`} footer={<Button onClick={onClose}>关闭</Button>}>
      <ExportPanel ids={ids} />
    </FormDialog>
  );
}

/** 每种对话框一个渲染函数：同一时刻最多一个 */
const RENDER: { [K in DialogState["kind"]]: (dialog: DialogOf<K>, ctx: Ctx) => ReactNode } = {
  create: (d, c) => <CreateLinkDialog preselected={d.preselected} onClose={c.onClose} onCreated={() => c.onChanged()} />,
  copy: (d, c) => <CopyLinkDialog link={d.link} onClose={c.onClose} />,
  rebind: (d, c) => <RebindDialog link={d.link} onClose={c.onClose} />,
  reset: (d, c) => <ResetDevicesDialog link={d.link} onClose={c.onClose} />,
  rotate: (d, c) => <RotateDialog link={d.link} onClose={c.onClose} />,
  extend: (d, c) => <ExtendDialog ids={d.ids} onClose={c.onClose} onDone={c.finish("延长有效期", DONE_TEXT.extend)} />,
  revoke: (d, c) => <RevokeDialog ids={d.ids} onClose={c.onClose} onDone={c.finish("撤销链接", DONE_TEXT.revoke)} />,
  ruleGroup: (d, c) => <RuleGroupDialog ids={d.ids} onClose={c.onClose} onDone={c.finish("换规则组", DONE_TEXT.ruleGroup)} />,
  export: (d, c) => <ExportDialog ids={d.ids} onClose={c.onClose} />,
  quick: (d, c) => (
    <QuickBatch action={d.action} ids={d.ids} onClose={c.onClose} onFinished={c.finish(d.action === "pause" ? "暂停链接" : "恢复链接", DONE_TEXT[d.action])} />
  ),
};

export function LinkDialogs({ dialog, labelOf, onClose, onChanged }: Props) {
  const [result, setResult] = useState<Result | null>(null);
  const finish = (title: string, text: string) => (summary: BatchSummary) => {
    onClose();
    onChanged(summary.failed.length === 0 ? `${text}（${summary.ok} 条）` : undefined);
    if (summary.failed.length > 0) setResult({ title, summary });
  };
  const render = dialog === null ? null : (RENDER[dialog.kind] as (dialog: DialogState, ctx: Ctx) => ReactNode)(dialog, { onClose, onChanged, finish });
  return (
    <>
      {render}
      {result ? <BatchResultDialog title={result.title} summary={result.summary} labelOf={labelOf} onClose={() => setResult(null)} /> : null}
    </>
  );
}

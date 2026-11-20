import type { MailboxImportItem, MailboxImportResponse } from "@maillink/shared";
import { IMPORT_PREVIEW_ROWS } from "../../constants";
import { Button, ErrorCallout, Tag } from "../../ui";
import { groupImportItems } from "./import-state";
import { importReasonLabel } from "./labels";

type Props = {
  preview: MailboxImportResponse;
  busy: boolean;
  error: { message: string; detail: string } | null;
  onBack: () => void;
  onConfirm: () => void;
};

function ItemList({ items }: { items: MailboxImportItem[] }) {
  const shown = items.slice(0, IMPORT_PREVIEW_ROWS);
  return (
    <ul className="import-items">
      {shown.map((item) => (
        <li key={item.line}>
          <span className="import-line num">第 {item.line} 行</span>
          <span className="import-input mono" title={item.input}>{item.address ?? item.input}</span>
          <span className="import-reason">{importReasonLabel(item)}</span>
        </li>
      ))}
      {items.length > shown.length ? <li className="import-more">还有 {items.length - shown.length} 条未显示（共 {items.length} 条）</li> : null}
    </ul>
  );
}

type GroupProps = { title: string; tone?: "warning" | "danger"; items: MailboxImportItem[]; open?: boolean };

/** 分组折叠：逐条原因可展开。无效默认展开（需要处理），重复与新增默认折叠 */
function Group({ title, tone, items, open }: GroupProps) {
  if (items.length === 0) return null;
  return (
    <details className="import-group" open={open}>
      <summary>
        <Tag tone={tone}>{items.length}</Tag>
        {title}
      </summary>
      <ItemList items={items} />
    </details>
  );
}

function Counts({ summary }: { summary: MailboxImportResponse["summary"] }) {
  return (
    <dl className="import-counts" aria-label="预览结果">
      <div><dt>新增</dt><dd className="num">{summary.new}</dd></div>
      <div><dt>重复</dt><dd className="num">{summary.duplicate}</dd></div>
      <div data-tone={summary.invalid > 0 ? "danger" : undefined}><dt>无效</dt><dd className="num">{summary.invalid}</dd></div>
    </dl>
  );
}

/** 第 2 步：预览。写入前确认：只有“新增”会被导入，重复与无效都会跳过 */
export function ImportPreviewStep({ preview, busy, error, onBack, onConfirm }: Props) {
  const groups = groupImportItems(preview.items);
  const nothing = preview.summary.new === 0;
  return (
    <div className="dialog-form">
      <Counts summary={preview.summary} />
      <p className="field-hint">确认后只写入“新增”的地址；重复与无效的行会被跳过，不会改动已有地址。</p>
      <Group title="无效，将被跳过" tone="danger" items={groups.invalid} open />
      <Group title="重复，将被跳过" tone="warning" items={groups.duplicate} />
      <Group title="新增，将被导入" items={groups.new} />
      {error ? <ErrorCallout title="导入失败" {...error} /> : null}
      <div className="dialog-actions">
        <Button onClick={onBack} disabled={busy}>返回修改</Button>
        <Button variant="primary" busy={busy} busyLabel="导入中…" disabled={nothing} onClick={onConfirm}>
          {nothing ? "没有可导入的新地址" : `导入 ${preview.summary.new} 个新地址`}
        </Button>
      </div>
    </div>
  );
}

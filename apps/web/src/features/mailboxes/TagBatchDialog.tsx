import { useState } from "react";
import type { FormEvent } from "react";
import { MAILBOX_LIMITS, mailboxTagSchema } from "@maillink/shared";
import { Button, ChipInput, ErrorCallout, FormDialog } from "../../ui";

export type TagMode = "add" | "remove";

type Props = {
  mode: TagMode | null;
  count: number;
  busy: boolean;
  error: { message: string; detail: string } | null;
  onClose: () => void;
  onSubmit: (mode: TagMode, tags: string[]) => void;
};

function tagError(tag: string): string | undefined {
  const parsed = mailboxTagSchema.safeParse(tag);
  return parsed.success ? undefined : parsed.error.issues[0]?.message;
}

type FormProps = Omit<Props, "mode"> & { mode: TagMode };

function TagForm({ mode, count, busy, error, onClose, onSubmit }: FormProps) {
  const [tags, setTags] = useState<string[]>([]);
  const bad = tags.map(tagError).find((message) => message !== undefined);
  const tooMany = tags.length > MAILBOX_LIMITS.tagsPerMailbox;
  const invalid = tags.length === 0 || bad !== undefined || tooMany;
  const verb = mode === "add" ? "打" : "去";
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!invalid) onSubmit(mode, tags);
  };
  return (
    <form className="dialog-form" onSubmit={submit} noValidate>
      <div className="field">
        <span className="field-label">标签</span>
        <ChipInput values={tags} onChange={setTags} aria-label="标签" placeholder="输入后按 Enter 添加" mono={false} itemError={tagError} />
        {bad ? <p className="field-error">{bad}</p> : tooMany ? <p className="field-error">一次最多 {MAILBOX_LIMITS.tagsPerMailbox} 个标签</p> : (
          <p className="field-hint">
            {mode === "add" ? `每个地址最多 ${MAILBOX_LIMITS.tagsPerMailbox} 个标签，超出的地址会被跳过并列出原因。` : "没有这个标签的地址不受影响。"}
          </p>
        )}
      </div>
      {error ? <ErrorCallout title="操作失败" {...error} /> : null}
      <div className="dialog-actions">
        <Button onClick={onClose} disabled={busy}>取消</Button>
        <Button type="submit" variant="primary" busy={busy} busyLabel="处理中…" disabled={invalid}>
          {`给 ${count} 个地址${verb}标签`}
        </Button>
      </div>
    </form>
  );
}

/** 批量打标签 / 去标签。关闭时不渲染表单，下次打开从空白开始 */
export function TagBatchDialog(props: Props) {
  const { mode } = props;
  return (
    <FormDialog
      open={mode !== null}
      onOpenChange={(open) => !open && props.onClose()}
      title={mode === "remove" ? "去标签" : "打标签"}
      description={`对已选的 ${props.count} 个地址${mode === "remove" ? "移除" : "追加"}标签。`}
    >
      {mode ? <TagForm {...props} mode={mode} /> : null}
    </FormDialog>
  );
}

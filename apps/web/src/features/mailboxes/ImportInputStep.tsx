import { useRef, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import { MAILBOX_LIMITS, mailboxTagSchema } from "@maillink/shared";
import { Upload } from "lucide-react";
import { Button, ChipInput, ErrorCallout, TextAreaField } from "../../ui";
import { AdminMailDbNotice } from "../mail-db/MailDbNotice";
import { hasIcloudAlias } from "../mail-db/notice-text";
import { checkImportInput } from "./import-state";

export type ImportInput = { content: string; tags: string[] };

type Props = {
  value: ImportInput;
  onChange: (value: ImportInput) => void;
  busy: boolean;
  error: { message: string; detail: string } | null;
  onCancel: () => void;
  onPreview: () => void;
};

const FORMAT_HINT = `每行一个地址，可带平台与备注：地址[,平台[,备注]]（逗号或制表符分隔）。平台列会成为该地址的标签，多个用空白、; 或 | 分隔；备注含逗号时用双引号括起。首行是 address / 地址 表头时自动跳过。一次最多 ${MAILBOX_LIMITS.importMaxLines} 行。`;

function tagError(tag: string): string | undefined {
  const parsed = mailboxTagSchema.safeParse(tag);
  return parsed.success ? undefined : parsed.error.issues[0]?.message;
}

/** 第 1 步：粘贴或上传。本地先检查行数与长度，不合格不发请求 */
export function ImportInputStep({ value, onChange, busy, error, onCancel, onPreview }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const localError = touched ? checkImportInput(value.content) : null;
  const badTag = value.tags.map(tagError).find((message) => message !== undefined);

  const readFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      onChange({ ...value, content: await file.text() });
      setFileName(file.name);
      setReadError(null);
    } catch (cause) {
      setReadError(`读取文件失败：${cause instanceof Error ? cause.message : String(cause)}`);
    }
    event.target.value = "";
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (checkImportInput(value.content) === null && badTag === undefined) onPreview();
  };

  return (
    <form className="dialog-form" onSubmit={submit} noValidate>
      <AdminMailDbNotice emphasizeIcloud={hasIcloudAlias(value.content)} />
      <TextAreaField
        label="地址列表"
        mono
        rows={8}
        spellCheck={false}
        placeholder={"alias_one@icloud.com,OpenAI,共享号 #12\nalias_two@icloud.com,Steam\nalias_three@icloud.com"}
        value={value.content}
        onChange={(event) => onChange({ ...value, content: event.target.value })}
        error={localError ?? readError ?? undefined}
        hint={FORMAT_HINT}
      />
      <div className="form-actions">
        <input ref={fileRef} type="file" accept=".csv,.txt,text/csv,text/plain" className="sr-only" tabIndex={-1} aria-label="选择 CSV 文件" onChange={readFile} />
        <Button size="sm" onClick={() => fileRef.current?.click()}>
          <Upload />
          上传 CSV / 文本文件
        </Button>
        {fileName ? <span className="field-hint">已读入 {fileName}</span> : null}
      </div>
      <div className="field">
        <span className="field-label">给本次新增的全部地址加标签（可选）</span>
        <ChipInput values={value.tags} onChange={(tags) => onChange({ ...value, tags })} aria-label="本次导入的标签" placeholder="输入后按 Enter" mono={false} itemError={tagError} />
        {badTag ? <p className="field-error">{badTag}</p> : <p className="field-hint">已存在的地址不会被改动。</p>}
      </div>
      {error ? <ErrorCallout title="预览失败" {...error} /> : null}
      <div className="dialog-actions">
        <Button onClick={onCancel} disabled={busy}>取消</Button>
        <Button type="submit" variant="primary" busy={busy} busyLabel="解析中…">预览导入结果</Button>
      </div>
    </form>
  );
}

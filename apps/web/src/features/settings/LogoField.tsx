import { useId, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { SITE_LOGO_MAX_LENGTH } from "@maillink/shared";
import { Button, TextField } from "../../ui";

type LogoFieldProps = { value: string; onChange: (value: string) => void; error?: string; disabled?: boolean };

/** 单文件读成 data URI；读失败抛原始错误，不吞 */
function readAsDataUri(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("读取文件失败"));
    reader.readAsDataURL(file);
  });
}

/** data URI 的字符数上限折算成大致的原图字节数（base64 约 4/3 倍，再扣掉 data:…;base64, 前缀的余量） */
const BASE64_RATIO = 3 / 4;

export function isDataUri(value: string): boolean {
  return value.startsWith("data:");
}

/** 返回 null 表示可用，否则是中文原因 */
export function checkLogoUpload(file: { type: string }, dataUri: string): string | null {
  if (!file.type.startsWith("image/")) return `只能上传图片文件（收到 ${file.type || "未知类型"}）`;
  if (dataUri.length > SITE_LOGO_MAX_LENGTH) {
    const approxKb = Math.floor((SITE_LOGO_MAX_LENGTH * BASE64_RATIO) / 1024);
    return `图片太大：编码后 ${dataUri.length} 个字符，上限 ${SITE_LOGO_MAX_LENGTH}（原图约 ${approxKb} KB 以内）`;
  }
  return null;
}

export function LogoField({ value, onChange, error, disabled }: LogoFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const hintId = useId();
  const [uploadError, setUploadError] = useState<string | null>(null);

  const pick = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const uri = await readAsDataUri(file);
      const problem = checkLogoUpload(file, uri);
      setUploadError(problem);
      if (problem === null) onChange(uri);
    } catch (cause) {
      setUploadError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  return (
    <div className="field logo-field">
      <span className="field-label" id={`${hintId}-label`}>Logo</span>
      <div className="logo-row">
        {value !== "" ? <img className="logo-thumb" src={value} alt="当前 Logo" /> : <span className="logo-thumb logo-empty" aria-hidden="true" />}
        <div className="logo-controls">
          {isDataUri(value) ? (
            <p className="field-hint">已上传图片（{value.length} 个字符）</p>
          ) : (
            <TextField label="Logo 地址（https）" value={value} onChange={(event) => onChange(event.target.value)}
              placeholder="https://example.com/logo.png" disabled={disabled} mono />
          )}
          <div className="form-actions">
            <Button size="sm" disabled={disabled} onClick={() => inputRef.current?.click()}>
              {isDataUri(value) ? "更换图片" : "上传图片"}
            </Button>
            {value !== "" ? <Button size="sm" variant="ghost" disabled={disabled} onClick={() => onChange("")}>清除 Logo</Button> : null}
          </div>
          <input ref={inputRef} type="file" accept="image/*" hidden onChange={(event) => void pick(event)} aria-label="选择 Logo 图片" />
        </div>
      </div>
      {error || uploadError ? <p className="field-error">{error ?? uploadError}</p> : (
        <p className="field-hint" id={hintId}>
          上传的图片会编码保存（上限 {SITE_LOGO_MAX_LENGTH} 个字符）。取件页只显示上传的图片，不显示外部地址；https 地址只用于登录页等站内页面。
        </p>
      )}
    </div>
  );
}

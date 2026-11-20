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

/** base64 约 4/3 倍：data URI 的字符数上限折算成原图字节数时乘它 */
const BASE64_RATIO = 3 / 4;
const BYTES_PER_KB = 1024;

/**
 * 原图字节数上限：shared 只有 data URI 的字符数上限（SITE_LOGO_MAX_LENGTH），这里按 base64 比例折算，
 * 用来在读文件之前就拦下明显过大的图片；折算是上界，通过后仍要按真实的 data URI 长度再校验一次。
 */
export const LOGO_MAX_FILE_BYTES = Math.floor(SITE_LOGO_MAX_LENGTH * BASE64_RATIO);

export function isDataUri(value: string): boolean {
  return value.startsWith("data:");
}

/** 读文件之前的检查（只看类型与大小，不读内容）；返回 null 表示可以读，否则是中文原因 */
export function checkLogoFile(file: { type: string; size: number }): string | null {
  if (!file.type.startsWith("image/")) return `只能上传图片文件（收到 ${file.type || "未知类型"}）`;
  if (file.size > LOGO_MAX_FILE_BYTES) {
    const sizeKb = Math.ceil(file.size / BYTES_PER_KB);
    return `图片太大：${sizeKb} KB，上限约 ${Math.floor(LOGO_MAX_FILE_BYTES / BYTES_PER_KB)} KB`;
  }
  return null;
}

/** 读出 data URI 之后的检查（含 data:…;base64, 前缀）；返回 null 表示可用 */
export function checkLogoDataUri(dataUri: string): string | null {
  if (dataUri.length > SITE_LOGO_MAX_LENGTH) {
    return `图片太大：编码后 ${dataUri.length} 个字符，上限 ${SITE_LOGO_MAX_LENGTH}`;
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
    const tooBig = checkLogoFile(file);
    setUploadError(tooBig);
    if (tooBig !== null) return;
    try {
      const uri = await readAsDataUri(file);
      const problem = checkLogoDataUri(uri);
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

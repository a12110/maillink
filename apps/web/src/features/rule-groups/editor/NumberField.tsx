import { useId, useState } from "react";

type Props = {
  label: string;
  value: number | undefined;
  onChange: (value: number | undefined) => void;
  suffix?: string;
  hint?: string;
  /** 来自配置校验的错误（就地显示） */
  error?: string;
  placeholder?: string;
  disabled?: boolean;
  hideLabel?: boolean;
};

function format(value: number | undefined): string {
  return value === undefined ? "" : String(value);
}

/** 本地输入框文本与数值的解析：空 = 未设置；非整数留在输入框里并就地报错，不往配置里写垃圾 */
export function parseIntegerInput(text: string): { value: number | undefined; error: string | null } {
  const trimmed = text.trim();
  if (trimmed === "") return { value: undefined, error: null };
  if (!/^\d{1,15}$/u.test(trimmed)) return { value: undefined, error: "请输入非负整数" };
  return { value: Number(trimmed), error: null };
}

function Note({ id, error, hint }: { id: string; error: string | undefined; hint: string | undefined }) {
  if (error) return <p className="field-error" id={`${id}-error`}>{error}</p>;
  return hint ? <p className="field-hint" id={`${id}-hint`}>{hint}</p> : null;
}

/** 整数输入：配置里的数值与输入框文本分开持有，外部值变化（如放弃更改）时同步回文本 */
export function NumberField({ label, value, onChange, suffix, hint, error, placeholder, disabled, hideLabel }: Props) {
  const id = useId();
  const [text, setText] = useState(format(value));
  const [seen, setSeen] = useState(value);
  if (value !== seen) {
    setSeen(value);
    if (parseIntegerInput(text).value !== value) setText(format(value));
  }
  const shown = parseIntegerInput(text).error ?? error;
  const describedBy = shown ? `${id}-error` : `${id}-hint`;
  const commit = (next: string) => {
    setText(next);
    const parsed = parseIntegerInput(next);
    if (parsed.error !== null) return;
    setSeen(parsed.value);
    onChange(parsed.value);
  };
  const input = (
    <input
      id={id}
      className="input"
      data-num="true"
      inputMode="numeric"
      value={text}
      placeholder={placeholder}
      disabled={disabled}
      aria-invalid={shown ? "true" : undefined}
      aria-describedby={describedBy}
      onChange={(event) => commit(event.target.value)}
    />
  );
  return (
    <div className="field">
      <label className={hideLabel ? "sr-only" : "field-label"} htmlFor={id}>{label}</label>
      {suffix ? <div className="input-suffix">{input}<span>{suffix}</span></div> : input}
      <Note id={id} error={shown} hint={hint} />
    </div>
  );
}

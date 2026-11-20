import { useState } from "react";
import type { ClipboardEvent, KeyboardEvent } from "react";
import { X } from "lucide-react";

type ChipInputProps = {
  values: readonly string[];
  onChange: (values: string[]) => void;
  "aria-label": string;
  placeholder?: string;
  mono?: boolean;
  invalid?: boolean;
  /** 逐项校验：返回错误文案的项会标红 */
  itemError?: (value: string, index: number) => string | undefined;
  disabled?: boolean;
  /** 逗号、分号是否也当分隔符；正则、含逗号的关键词要关掉，只认 Enter 与换行 */
  splitOnComma?: boolean;
};

/** 输入内容里的分隔符：逗号、分号、换行（粘贴一整段时拆成多项） */
const SPLIT_ALL = /[,;\n\r]+/u;
const SPLIT_LINES = /[\n\r]+/u;

function splitItems(text: string, pattern: RegExp): string[] {
  return text.split(pattern).map((item) => item.trim()).filter((item) => item !== "");
}

/** 多值标签输入：Enter / 逗号 / 失焦提交，Backspace 删最后一项，粘贴按分隔符拆开。不去重（去重是内容决定，交给校验） */
export function ChipInput(props: ChipInputProps) {
  const { values, onChange, placeholder, mono = true, invalid, itemError, disabled, splitOnComma = true } = props;
  const [draft, setDraft] = useState("");
  const pattern = splitOnComma ? SPLIT_ALL : SPLIT_LINES;

  const commit = (text: string) => {
    const items = splitItems(text, pattern);
    if (items.length > 0) onChange([...values, ...items]);
    setDraft("");
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" || (splitOnComma && event.key === ",")) {
      event.preventDefault();
      commit(draft);
    } else if (event.key === "Backspace" && draft === "" && values.length > 0) {
      onChange(values.slice(0, -1));
    }
  };
  const onPaste = (event: ClipboardEvent<HTMLInputElement>) => {
    const text = event.clipboardData.getData("text");
    if (!pattern.test(text)) return;
    event.preventDefault();
    commit(`${draft}${text}`);
  };

  return (
    <div className="chips" data-invalid={invalid ? "true" : undefined} data-disabled={disabled ? "true" : undefined}>
      {values.map((value, index) => {
        const error = itemError?.(value, index);
        return (
          <span key={`${index}:${value}`} className="chip" data-mono={mono ? "true" : undefined} data-invalid={error ? "true" : undefined} title={error}>
            {value === "" ? "（空）" : value}
            <button type="button" aria-label={`移除 ${value}`} disabled={disabled} onClick={() => onChange(values.filter((_, i) => i !== index))}>
              <X className="icon-sm" />
            </button>
          </span>
        );
      })}
      <input
        className="chip-entry"
        data-mono={mono ? "true" : undefined}
        aria-label={props["aria-label"]}
        placeholder={values.length === 0 ? placeholder : undefined}
        value={draft}
        disabled={disabled}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        onBlur={() => commit(draft)}
      />
    </div>
  );
}

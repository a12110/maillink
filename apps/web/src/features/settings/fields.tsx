import { useId } from "react";
import type { InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from "react";

type CheckFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, "id" | "type" | "children"> & {
  label: ReactNode;
  hint?: ReactNode;
};

/** 单个勾选项：原生 checkbox，标签可点，提示在下方 */
export function CheckField({ label, hint, ...rest }: CheckFieldProps) {
  const id = useId();
  return (
    <div className="check-field">
      <label className="check" htmlFor={id}>
        <input id={id} type="checkbox" aria-describedby={hint ? `${id}-hint` : undefined} {...rest} />
        <span>{label}</span>
      </label>
      {hint ? <p className="field-hint check-hint" id={`${id}-hint`}>{hint}</p> : null}
    </div>
  );
}

type TextAreaFieldProps = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "id"> & {
  label: string;
  hint?: string;
  error?: string;
};

export function TextAreaField({ label, hint, error, ...rest }: TextAreaFieldProps) {
  const id = useId();
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>{label}</label>
      <textarea id={id} className="input textarea" aria-invalid={error ? "true" : undefined} aria-describedby={describedBy} {...rest} />
      {error ? <p className="field-error" id={`${id}-error`}>{error}</p> : hint ? <p className="field-hint" id={`${id}-hint`}>{hint}</p> : null}
    </div>
  );
}

/** 一组勾选项（多选）：fieldset + legend */
export function CheckGroup({ legend, hint, error, children }: { legend: string; hint?: string; error?: string; children: ReactNode }) {
  return (
    <fieldset className="check-group">
      <legend className="field-label">{legend}</legend>
      {children}
      {error ? <p className="field-error">{error}</p> : hint ? <p className="field-hint">{hint}</p> : null}
    </fieldset>
  );
}

type BindContext<D> = { draft: D; errors: Record<string, string>; disabled: boolean; update: (patch: Partial<D>) => void };

export type StringKeys<D> = { [K in keyof D]: D[K] extends string ? K : never }[keyof D] & string;

/** 文本类字段的公共属性：值、就地错误、禁用与回写；草稿里该字段必须是字符串 */
export function bindText<D, K extends StringKeys<D>>(context: BindContext<D>, name: K) {
  return {
    name,
    value: context.draft[name] as string,
    error: context.errors[name],
    disabled: context.disabled,
    onChange: (event: { target: { value: string } }) => context.update({ [name]: event.target.value } as Partial<D>),
  };
}

/** 切换数组里的一个值（登录方式、作用范围） */
export function toggled<T>(list: readonly T[], value: T, on: boolean): T[] {
  const rest = list.filter((item) => item !== value);
  return on ? [...rest, value] : rest;
}

import { useId } from "react";
import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";
import { ChevronDown } from "lucide-react";

type FieldFrameProps = {
  label: string;
  hint?: string;
  error?: string;
  id: string;
  children: ReactNode;
};

/** 标签在上、提示在下；错误替换提示位（不靠颜色单独表达：带文字） */
function FieldFrame({ label, hint, error, id, children }: FieldFrameProps) {
  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      {children}
      {error ? (
        <p className="field-error" id={`${id}-error`}>
          {error}
        </p>
      ) : hint ? (
        <p className="field-hint" id={`${id}-hint`}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}

function describedBy(id: string, hint?: string, error?: string): string | undefined {
  if (error) return `${id}-error`;
  return hint ? `${id}-hint` : undefined;
}

type TextFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, "id"> & {
  label: string;
  hint?: string;
  error?: string;
  mono?: boolean;
};

export function TextField({ label, hint, error, mono, ...rest }: TextFieldProps) {
  const id = useId();
  return (
    <FieldFrame label={label} hint={hint} error={error} id={id}>
      <input
        id={id}
        className="input"
        data-mono={mono ? "true" : undefined}
        aria-invalid={error ? "true" : undefined}
        aria-describedby={describedBy(id, hint, error)}
        {...rest}
      />
    </FieldFrame>
  );
}

type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & { block?: boolean };

/** 原生 select 去外观 + 自绘箭头。工具栏里用 aria-label 命名 */
export function Select({ block, children, ...rest }: SelectProps) {
  return (
    <span className="select-wrap" data-block={block ? "true" : undefined}>
      <select className="select" {...rest}>
        {children}
      </select>
      <ChevronDown />
    </span>
  );
}

type SegmentedOption<T extends string> = { value: T; label: string };

type SegmentedProps<T extends string> = {
  legend: string;
  name: string;
  value: T;
  options: ReadonlyArray<SegmentedOption<T>>;
  onChange: (value: T) => void;
  hint?: string;
  disabled?: boolean;
};

/** 2–4 个互斥项的分段控件，底层是原生 radio（方向键、读屏都由浏览器处理） */
export function Segmented<T extends string>({ legend, name, value, options, onChange, hint, disabled }: SegmentedProps<T>) {
  const hintId = useId();
  return (
    <fieldset className="segmented-group" aria-describedby={hint ? hintId : undefined}>
      <legend className="field-label">{legend}</legend>
      <div className="segmented">
        {options.map((option) => (
          <label key={option.value}>
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={value === option.value}
              disabled={disabled}
              onChange={() => onChange(option.value)}
            />
            <span>{option.label}</span>
          </label>
        ))}
      </div>
      {hint ? (
        <p className="field-hint" id={hintId}>
          {hint}
        </p>
      ) : null}
    </fieldset>
  );
}

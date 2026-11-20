import { useId } from "react";
import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";
import { ChevronDown, Lock } from "lucide-react";

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

type TextAreaFieldProps = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "id"> & {
  label: string;
  hint?: string;
  error?: string;
  mono?: boolean;
  /** 标签只给读屏（旁边已有可见标题时） */
  hideLabel?: boolean;
};

export function TextAreaField({ label, hint, error, mono, hideLabel, ...rest }: TextAreaFieldProps) {
  const id = useId();
  return (
    <div className="field">
      <label className={hideLabel ? "sr-only" : "field-label"} htmlFor={id}>
        {label}
      </label>
      <textarea
        id={id}
        className="textarea"
        data-mono={mono ? "true" : undefined}
        aria-invalid={error ? "true" : undefined}
        aria-describedby={describedBy(id, hint, error)}
        {...rest}
      />
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

type SegmentedOption<T extends string> = {
  value: T;
  label: string;
  /** 互斥约束：保留在原位、带锁图标，点击不切换，改为通知 onLockedSelect（由调用方在控件下方写明原因） */
  locked?: boolean;
};

type SegmentedProps<T extends string> = {
  legend: string;
  name: string;
  value: T;
  options: ReadonlyArray<SegmentedOption<T>>;
  onChange: (value: T) => void;
  onLockedSelect?: (value: T) => void;
  /** 锁定项的原因所在元素 id，读屏用 aria-describedby 关联 */
  lockedReasonId?: string;
  hint?: string;
  disabled?: boolean;
  size?: "sm";
  /** 旁边已有可见的文字标签时，只给读屏留 legend */
  hideLegend?: boolean;
};

/** 2–4 个互斥项的分段控件，底层是原生 radio（方向键、读屏都由浏览器处理） */
export function Segmented<T extends string>(props: SegmentedProps<T>) {
  const { legend, name, value, options, onChange, onLockedSelect, lockedReasonId, hint, disabled, size, hideLegend } = props;
  const hintId = useId();
  return (
    <fieldset className="segmented-group" aria-describedby={hint ? hintId : undefined}>
      <legend className={hideLegend ? "sr-only" : "field-label"}>{legend}</legend>
      <div className="segmented" data-size={size}>
        {options.map((option) => (
          <label key={option.value}>
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={value === option.value}
              disabled={disabled}
              aria-disabled={option.locked ? "true" : undefined}
              aria-describedby={option.locked ? lockedReasonId : undefined}
              onChange={() => (option.locked ? onLockedSelect?.(option.value) : onChange(option.value))}
            />
            <span>
              {option.locked ? <Lock className="icon-sm" aria-hidden="true" /> : null}
              {option.label}
            </span>
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

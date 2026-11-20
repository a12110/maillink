import type { ComponentProps, ReactNode } from "react";

type CheckboxProps = Omit<ComponentProps<"input">, "type" | "children"> & { children?: ReactNode };

/** 墨色填充的复选框；有 children 时整行可点 */
export function Checkbox({ children, ...rest }: CheckboxProps) {
  const box = <input type="checkbox" className="cb" {...rest} />;
  if (children === undefined) return box;
  return (
    <label className="check" data-disabled={rest.disabled ? "true" : undefined}>
      {box}
      {children}
    </label>
  );
}

type SwitchProps = Omit<ComponentProps<"input">, "type" | "role"> & { "aria-label": string };

/** 开关：原生 checkbox + role=switch，状态由 :checked 画出 */
export function Switch(props: SwitchProps) {
  return <input type="checkbox" role="switch" className="switch" {...props} />;
}

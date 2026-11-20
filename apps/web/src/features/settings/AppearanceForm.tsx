import { useEffect } from "react";
import { THEME_PRESETS } from "@maillink/shared";
import { Segmented, Select, TextField } from "../../ui";
import { useThemeController } from "../../theme";
import { AccentReadout, AppearancePreview } from "./AccentPreview";
import { ACCENT_SWATCHES, accentBlocker, isHexColor, PRESET_LABELS, previewTheme } from "./accent-report";
import { SettingsGroupForm } from "./SettingsGroupForm";
import type { FormContext } from "./SettingsGroupForm";

const MODE_OPTIONS = [
  { value: "light", label: "浅色" },
  { value: "dark", label: "深色" },
  { value: "system", label: "跟随系统" },
] as const;

const RADIUS_OPTIONS = [
  { value: "0", label: "直角 0" },
  { value: "4", label: "默认 4px" },
  { value: "8", label: "圆润 8px" },
] as const;

function AccentPicker({ value, onChange, error, disabled }: { value: string; onChange: (hex: string) => void; error?: string; disabled: boolean }) {
  return (
    <div className="accent-picker">
      <div className="accent-input">
        <input type="color" className="color-input" aria-label="选择强调色" disabled={disabled}
          value={isHexColor(value) ? value.toLowerCase() : "#000000"} onChange={(event) => onChange(event.target.value)} />
        <TextField label="强调色" mono name="accent" value={value} error={error} disabled={disabled}
          hint="#rrggbb。按钮文字色与可读性由程序保证，对比度不足的颜色会被自动调整。"
          onChange={(event) => onChange(event.target.value)} />
      </div>
      <div className="swatches" role="group" aria-label="常用强调色">
        {ACCENT_SWATCHES.map((swatch) => (
          <button key={swatch.hex} type="button" className="swatch" style={{ background: swatch.hex }} title={swatch.label}
            aria-label={swatch.label} aria-pressed={value.toLowerCase() === swatch.hex} disabled={disabled} onClick={() => onChange(swatch.hex)} />
        ))}
      </div>
    </div>
  );
}

function AppearanceFields({ draft, update, errors, disabled, saved }: FormContext<"appearance">) {
  const controller = useThemeController();
  // 改动即时作用于当前页面；离开设置页或撤销后回到已保存的主题
  useEffect(() => {
    controller.preview(previewTheme(draft, saved.accent));
  }, [controller, draft, saved.accent]);
  useEffect(() => () => controller.preview(null), [controller]);

  return (
    <>
      <Segmented legend="明暗模式" name="mode" value={draft.mode} options={MODE_OPTIONS} disabled={disabled}
        onChange={(mode) => update({ mode })} hint="“跟随系统”按访问者设备的明暗设置切换。" />
      <Segmented legend="圆角" name="radius" value={draft.radius} options={RADIUS_OPTIONS} disabled={disabled}
        onChange={(radius) => update({ radius })} />
      <AccentPicker value={draft.accent} onChange={(accent) => update({ accent })} error={errors.accent} disabled={disabled} />
      <AccentReadout accent={draft.accent} />
      <div className="field">
        <label className="field-label" htmlFor="appearance-preset">主题预设</label>
        <Select id="appearance-preset" value={draft.preset} disabled={disabled} onChange={(event) => update({ preset: event.target.value as typeof draft.preset })}>
          {THEME_PRESETS.map((preset) => <option key={preset} value={preset}>{PRESET_LABELS[preset]}</option>)}
        </Select>
        <p className="field-hint">目前只有一套预设；强调色、明暗与圆角是对它的覆盖。</p>
      </div>
      <AppearancePreview />
    </>
  );
}

export function AppearanceForm() {
  return (
    <SettingsGroupForm group="appearance" blocker={(draft) => accentBlocker(draft.accent)}>
      {(context) => <AppearanceFields {...context} />}
    </SettingsGroupForm>
  );
}

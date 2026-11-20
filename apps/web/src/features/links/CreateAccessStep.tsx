import { useQuery } from "@tanstack/react-query";
import { Lock } from "lucide-react";
import { publicConfigQuery } from "../../api/queries";
import { Segmented, Select, TextField } from "../../ui";
import { effectiveReveal, isLimited } from "./create-form";
import type { CreateDraft, ExpiryKind, FieldErrors } from "./create-form";
import { EXTEND_UNITS } from "./labels";
import type { ExtendUnit } from "./labels";

type StepProps = { draft: CreateDraft; errors: FieldErrors; onChange: (patch: Partial<CreateDraft>) => void };

const EXPIRY_OPTIONS: ReadonlyArray<{ value: ExpiryKind; label: string }> = [
  { value: "default", label: "按系统默认有效期" },
  { value: "days", label: "N 天后过期" },
  { value: "after_first", label: "首次取码后 N 天失效" },
  { value: "never", label: "不过期" },
];

function toExpiry(value: string): ExpiryKind {
  return EXPIRY_OPTIONS.find((option) => option.value === value)?.value ?? "default";
}

function toUnit(value: string): ExtendUnit {
  return EXTEND_UNITS.find((unit) => unit.value === value)?.value ?? "day";
}

function ExpiryFields({ draft, errors, onChange }: StepProps) {
  return (
    <fieldset className="form-section">
      <legend className="section-title">有效期</legend>
      <div className="inline-fields">
        <div className="field">
          <label className="field-label" htmlFor="create-expiry">过期方式</label>
          <Select id="create-expiry" block value={draft.expiry} onChange={(event) => onChange({ expiry: toExpiry(event.target.value) })}>
            {EXPIRY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </Select>
        </div>
        {draft.expiry === "days" ? (
          <TextField label="天数" inputMode="numeric" value={draft.expiryDays} error={errors.expiry} onChange={(event) => onChange({ expiryDays: event.target.value })} />
        ) : null}
        {draft.expiry === "after_first" ? (
          <>
            <TextField label="时长" inputMode="numeric" value={draft.afterFirstAmount} error={errors.expiry} onChange={(event) => onChange({ afterFirstAmount: event.target.value })} />
            <div className="field">
              <label className="field-label" htmlFor="create-after-unit">单位</label>
              <Select id="create-after-unit" value={draft.afterFirstUnit} onChange={(event) => onChange({ afterFirstUnit: toUnit(event.target.value) })}>
                {EXTEND_UNITS.map((unit) => (
                  <option key={unit.value} value={unit.value}>{unit.label}</option>
                ))}
              </Select>
            </div>
          </>
        ) : null}
      </div>
      {draft.expiry === "default" ? <p className="field-hint">没有指定时，服务端按“系统设置 → 取件链接”里的默认有效期计算。</p> : null}
      {draft.expiry === "after_first" ? <p className="field-hint">买家第一次点“开始取码”才开始计时；之前不会过期。</p> : null}
    </fieldset>
  );
}

function DeliveryFields({ draft, errors, onChange }: StepProps) {
  const limited = isLimited(draft);
  return (
    <fieldset className="form-section">
      <legend className="section-title">取码方式与次数</legend>
      <Segmented
        legend="取码方式"
        name="create-reveal"
        value={effectiveReveal(draft)}
        disabled={limited}
        options={[
          { value: "auto", label: "自动显示" },
          { value: "click", label: "点击取码" },
        ]}
        onChange={(reveal) => onChange({ reveal })}
        hint={limited ? undefined : "自动显示：打开页面就看到最新验证码。点击取码：买家点一下才显示，每封邮件计一次。"}
      />
      {limited ? (
        <p className="field-hint reveal-lock" role="status">
          <Lock className="inline-icon" aria-hidden="true" />
          设了取码次数，取码方式已自动切换为“点击取码”：自动显示时后台轮询会白白消耗次数。清空次数后才能改回自动显示。
        </p>
      ) : null}
      <div className="inline-fields">
        <TextField label="总取码次数" inputMode="numeric" placeholder="不限" value={draft.maxTotal} error={errors.maxTotal} hint="按不同邮件计；用尽后链接对买家显示“已失效”" onChange={(event) => onChange({ maxTotal: event.target.value })} />
        <TextField label="每 24 小时次数" inputMode="numeric" placeholder="不限" value={draft.maxPerDay} error={errors.maxPerDay} hint="滚动 24 小时" onChange={(event) => onChange({ maxPerDay: event.target.value })} />
      </div>
    </fieldset>
  );
}

function TurnstileField({ draft, onChange }: Pick<StepProps, "draft" | "onChange">) {
  const config = useQuery(publicConfigQuery());
  const turnstile = config.data?.turnstile;
  const available = turnstile !== undefined && turnstile.enabled && turnstile.site_key !== "" && turnstile.scopes.includes("pickup");
  const reason = config.isPending ? "正在读取系统设置…" : config.isError ? "读取系统设置失败，暂时无法开启" : "系统还没有启用 Turnstile，或范围不含“取件页”。到“系统设置 → 人机验证”配置后才能开启。";
  return (
    <div className="field">
      <label className="check-row" data-disabled={!available}>
        <input type="checkbox" checked={available && draft.turnstile} disabled={!available} onChange={(event) => onChange({ turnstile: event.target.checked })} />
        <span>
          <b>{available ? "开启人机验证（Turnstile）" : <><Lock className="inline-icon" aria-hidden="true" />开启人机验证（Turnstile）</>}</b>
          <span className="field-hint">{available ? "买家点“开始取码”时需要先通过验证；已登记的设备不再验证。" : reason}</span>
        </span>
      </label>
    </div>
  );
}

export const API_TOGGLE_LABEL = "允许 API 取码";
export const API_TOGGLE_HINT = "脚本可以用链接调接口直接取最新验证码；口令、设备数、取码次数与取件页一样生效（接口占 1 台设备）。开了人机验证的链接接口不可用。";

function ApiField({ draft, onChange }: Pick<StepProps, "draft" | "onChange">) {
  return (
    <div className="field">
      <label className="check-row">
        <input type="checkbox" checked={draft.api} onChange={(event) => onChange({ api: event.target.checked })} />
        <span>
          <b>{API_TOGGLE_LABEL}</b>
          <span className="field-hint">{API_TOGGLE_HINT}</span>
        </span>
      </label>
    </div>
  );
}

function AccessLists({ draft, errors, onChange }: StepProps) {
  return (
    <fieldset className="form-section">
      <legend className="section-title">来源限制与刷新</legend>
      <TextField label="设备数上限" inputMode="numeric" placeholder="不限" value={draft.maxDevices} error={errors.maxDevices} hint="1 = 第一个打开的设备独占；换了手机需要你重置设备" onChange={(event) => onChange({ maxDevices: event.target.value })} />
      <div className="field">
        <label className="field-label" htmlFor="create-ip">IP 白名单</label>
        <textarea id="create-ip" className="input textarea" rows={2} placeholder="每行一个 IP 或 CIDR，留空 = 不限" value={draft.ipAllow} aria-invalid={errors.ipAllow ? "true" : undefined} onChange={(event) => onChange({ ipAllow: event.target.value })} />
        {errors.ipAllow ? <p className="field-error">{errors.ipAllow}</p> : null}
      </div>
      <TextField label="国家白名单" mono placeholder="如 CN US，留空 = 不限" value={draft.countryAllow} error={errors.countryAllow} hint="ISO 3166-1 两位国家代码，空格或逗号分隔" onChange={(event) => onChange({ countryAllow: event.target.value })} />
      <TextField label="轮询间隔（秒）" inputMode="numeric" placeholder="默认" value={draft.pollInterval} error={errors.pollInterval} hint="取件页多久自动刷新一次；最小 10 秒，不填用系统默认" onChange={(event) => onChange({ pollInterval: event.target.value })} />
    </fieldset>
  );
}

/** 第 3 步：访问约束与买家看到的标题、说明 */
export function AccessStep(props: StepProps) {
  const { draft, errors, onChange } = props;
  return (
    <div className="step-body">
      <fieldset className="form-section">
        <legend className="section-title">给买家看的内容与备注</legend>
        <TextField label="名称（仅管理员可见）" placeholder="如：11 月 ChatGPT 订单" value={draft.name} error={errors.name} onChange={(event) => onChange({ name: event.target.value })} />
        <TextField label="订单号（仅管理员可见）" mono value={draft.orderRef} error={errors.orderRef} onChange={(event) => onChange({ orderRef: event.target.value })} />
        <TextField label="买家看到的标题" placeholder="如：ChatGPT 共享号" value={draft.publicTitle} error={errors.publicTitle} onChange={(event) => onChange({ publicTitle: event.target.value })} />
        <div className="field">
          <label className="field-label" htmlFor="create-note">买家看到的说明</label>
          <textarea id="create-note" className="input textarea" rows={3} placeholder="使用说明与联系方式，纯文本" value={draft.publicNote} onChange={(event) => onChange({ publicNote: event.target.value })} />
          <p className="field-hint">显示在取件页，也显示在“设备已满 / 每日上限”页面里。</p>
        </div>
      </fieldset>
      <ExpiryFields {...props} />
      <fieldset className="form-section">
        <legend className="section-title">口令</legend>
        <TextField label="访问口令" autoComplete="off" placeholder="不设置 = 不需要口令" value={draft.password} error={errors.password} hint="买家“开始取码”时输入；设了口令，口令通过前不显示收件地址。保存后只存哈希，请自己记下。" onChange={(event) => onChange({ password: event.target.value })} />
      </fieldset>
      <DeliveryFields {...props} />
      <AccessLists {...props} />
      <fieldset className="form-section">
        <legend className="section-title">人机验证</legend>
        <TurnstileField draft={draft} onChange={onChange} />
      </fieldset>
      <fieldset className="form-section">
        <legend className="section-title">API 取码</legend>
        <ApiField draft={draft} onChange={onChange} />
      </fieldset>
    </div>
  );
}

import * as RadixDialog from "@radix-ui/react-dialog";
import { describeError } from "../../lib/messages";
import { Button, ErrorCallout } from "../../ui";
import { AccessStep } from "./CreateAccessStep";
import { CreateResult } from "./CreateResult";
import { AddressesStep, RuleGroupStep } from "./CreateSteps";
import { LAST_STEP, STEPS, useCreateForm } from "./useCreateForm";

function Stepper({ step }: { step: number }) {
  return (
    <ol className="stepper" aria-label="创建步骤">
      {STEPS.map((label, index) => (
        <li key={label} aria-current={index === step ? "step" : undefined} data-done={index < step}>
          <span className="step-no num">{index + 1}</span>
          {label}
        </li>
      ))}
    </ol>
  );
}

type Props = { preselected: number[]; onClose: () => void; onCreated: (ids: number[]) => void };

function Steps({ form }: { form: ReturnType<typeof useCreateForm> }) {
  const { draft, errors, step, patch } = form;
  return (
    <>
      <Stepper step={step} />
      {step === 0 ? <AddressesStep draft={draft} errors={errors} onChange={patch} /> : null}
      {step === 1 ? <RuleGroupStep draft={draft} errors={errors} onChange={patch} /> : null}
      {step === LAST_STEP ? <AccessStep draft={draft} errors={errors} onChange={patch} /> : null}
      {form.create.isError ? <ErrorCallout title="生成失败" {...describeError(form.create.error)} /> : null}
    </>
  );
}

function Footer({ form, onClose }: { form: ReturnType<typeof useCreateForm>; onClose: () => void }) {
  const { step, create } = form;
  if (create.data !== undefined) return <Button variant="primary" onClick={onClose}>完成</Button>;
  return (
    <>
      <Button onClick={onClose} disabled={create.isPending}>取消</Button>
      {step > 0 ? <Button onClick={form.back} disabled={create.isPending}>上一步</Button> : null}
      {step < LAST_STEP ? (
        <Button variant="primary" onClick={form.next}>下一步</Button>
      ) : (
        <Button variant="primary" onClick={form.submit} busy={create.isPending} busyLabel="生成中…">生成取件链接</Button>
      )}
    </>
  );
}

/**
 * 创建取件链接：选收件地址 → 选规则组 → 访问约束 → 结果页。
 * 宽对话框（可滚动）；结果页之后完整链接不再显示。
 */
export function CreateLinkDialog({ preselected, onClose, onCreated }: Props) {
  const form = useCreateForm(preselected, onCreated);
  const result = form.create.data;
  return (
    <RadixDialog.Root open onOpenChange={(open) => !open && onClose()}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="overlay" />
        <RadixDialog.Content className="dialog" data-size="wide" aria-describedby="create-link-desc">
          <div className="dialog-head">
            <RadixDialog.Title className="dialog-title">{result ? "取件链接已生成" : "生成取件链接"}</RadixDialog.Title>
          </div>
          <div className="dialog-body">
            <RadixDialog.Description id="create-link-desc" className="dialog-desc">
              {result ? "复制链接发给买家，或导出成文件 / 发卡平台的库存行。" : "选择收件地址与规则组，设置访问约束，一次生成一个或多个链接。"}
            </RadixDialog.Description>
            {result ? <CreateResult result={result} /> : <Steps form={form} />}
          </div>
          <div className="dialog-foot">
            <Footer form={form} onClose={onClose} />
          </div>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

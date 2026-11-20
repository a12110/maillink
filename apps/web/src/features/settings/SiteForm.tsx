import { SITE_DESCRIPTION_MAX_LENGTH, SITE_FOOTER_MAX_LENGTH, SITE_NAME_MAX_LENGTH, SITE_NOTICE_MAX_LENGTH } from "@maillink/shared";
import { TextField } from "../../ui";
import { bindText, TextAreaField } from "./fields";
import { LogoField } from "./LogoField";
import { SettingsGroupForm } from "./SettingsGroupForm";
import type { FormContext } from "./SettingsGroupForm";

function SiteFields(context: FormContext<"site">) {
  const { draft, update, errors, disabled } = context;
  const bind = (name: keyof typeof draft) => bindText(context, name);
  return (
    <>
      <TextField label="站点名称" maxLength={SITE_NAME_MAX_LENGTH} {...bind("name")} />
      <LogoField value={draft.logo} onChange={(logo) => update({ logo })} error={errors.logo} disabled={disabled} />
      <TextAreaField label="站点描述" rows={2} maxLength={SITE_DESCRIPTION_MAX_LENGTH} {...bind("description")} />
      <TextField label="页脚文字" maxLength={SITE_FOOTER_MAX_LENGTH} {...bind("footer")} />
      <TextAreaField label="登录页公告" rows={3} maxLength={SITE_NOTICE_MAX_LENGTH}
        hint="显示在登录页；留空则不显示。" {...bind("login_notice")} />
      <TextAreaField label="取件页公告" rows={3} maxLength={SITE_NOTICE_MAX_LENGTH}
        hint="显示在取件页；留空则不显示。" {...bind("pickup_notice")} />
    </>
  );
}

export function SiteForm() {
  return <SettingsGroupForm group="site">{(context) => <SiteFields {...context} />}</SettingsGroupForm>;
}

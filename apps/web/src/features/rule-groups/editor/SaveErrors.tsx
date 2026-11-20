import { describeError } from "../../../lib/messages";
import { Button, Callout, ErrorCallout } from "../../../ui";

type Props = {
  error: unknown;
  conflict: boolean;
  /** 名称重复在名称输入框旁说明，这里不重复 */
  nameTaken: boolean;
  /** 校验问题（400 rule_group_invalid）已并入问题清单，这里不重复 */
  invalidConfig: boolean;
  reloading: boolean;
  reloadError: unknown;
  onReload: () => void;
};

/** 保存失败的就地提示：409（别人改过）给重新加载；其余带错误码显示，不吞 */
export function SaveErrors({ error, conflict, nameTaken, invalidConfig, reloading, reloadError, onReload }: Props) {
  if (error === null) return null;
  if (conflict) {
    return (
      <Callout tone="danger" title="这个规则组已被其他人修改，你的修改没有保存"
        actions={<Button size="sm" busy={reloading} busyLabel="重新加载中…" onClick={onReload}>重新加载最新版本</Button>}>
        重新加载会用服务器上的最新内容替换当前页面，你尚未保存的修改会丢失；如果想保留，先把需要的内容复制出来（JSON 模式可整份复制）。
        {reloadError ? ` 重新加载失败：${describeError(reloadError).message}` : ""}
      </Callout>
    );
  }
  if (nameTaken || invalidConfig) return null;
  return <ErrorCallout title="保存失败" {...describeError(error)} />;
}

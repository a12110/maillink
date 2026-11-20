import { useId } from "react";

type Props = {
  target: string;
  anchor: string;
  suggestions: readonly string[];
  onTarget: (value: string) => void;
  onAnchor: (value: string) => void;
};

/** 选收件地址（或粘贴邮件 id）+ 可选的锚点时间 */
export function TesterControls({ target, anchor, suggestions, onTarget, onAnchor }: Props) {
  const listId = useId();
  const targetId = useId();
  const anchorId = useId();
  return (
    <>
      <div className="field">
        <label className="field-label" htmlFor={targetId}>收件地址或邮件 id</label>
        <input id={targetId} className="input" data-mono="true" list={listId} value={target} placeholder="alias@icloud.com，或 123, 124"
          autoComplete="off" spellCheck={false} onChange={(event) => onTarget(event.target.value)} />
        <datalist id={listId}>{suggestions.map((address) => <option key={address} value={address} />)}</datalist>
      </div>
      <div className="field">
        <label className="field-label" htmlFor={anchorId}>模拟的链接创建 / 首次取码时间（可选）</label>
        <input id={anchorId} className="input" type="datetime-local" value={anchor} onChange={(event) => onAnchor(event.target.value)} />
        <p className="field-hint">留空 = 现在，相当于刚创建的链接。用来看“起始锚点”对历史邮件的影响。</p>
      </div>
    </>
  );
}

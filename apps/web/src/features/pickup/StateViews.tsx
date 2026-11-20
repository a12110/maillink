import { Ban, CalendarClock, Clock, MailX, Smartphone } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { formatDateTime } from "../../lib/format";
import { Button, ErrorCallout } from "../../ui";
import { describePickupError } from "./failures";
import { formatCountdown } from "./time";
import { useNowSeconds } from "./hooks";

// 受限状态页：图标圈 + 标题 + 一句原因，不显示任何邮件内容。联系方式一律是 public_note（纯文本，保留换行）。

type ScreenProps = { icon: LucideIcon; tone?: "warning"; title: string; children: ReactNode };

function StateScreen({ icon: Icon, tone, title, children }: ScreenProps) {
  return (
    <section className="pk-state">
      <span className="icon-wrap" data-tone={tone}>
        <Icon className="icon-lg" />
      </span>
      <h1>{title}</h1>
      <p>{children}</p>
    </section>
  );
}

function SellerNote({ note }: { note: string | null }) {
  if (note === null || note.trim() === "") return null;
  return (
    <div className="pk-contact">
      <span className="muted">卖家留言</span>
      <span className="note">{note}</span>
    </div>
  );
}

/** 404：链接不存在 */
export function NotFoundView() {
  return (
    <StateScreen icon={MailX} title="链接不存在">
      请检查链接是否完整，或联系把链接发给你的人。
    </StateScreen>
  );
}

/** 410：撤销、暂停、过期、总次数用尽、来源不在白名单统一显示这一页，不透露具体原因 */
export function UnavailableView() {
  return (
    <StateScreen icon={Ban} title="链接已失效">
      这个链接无法继续使用。如有疑问，请联系把链接发给你的人。
    </StateScreen>
  );
}

export function NotYetValidView({ validFrom }: { validFrom: number | null }) {
  return (
    <StateScreen icon={CalendarClock} title="还没到生效时间">
      {validFrom === null ? (
        "这个链接还没有生效，请稍后再打开。"
      ) : (
        <>
          这个链接将在 <span className="mono">{formatDateTime(validFrom)}</span> 生效，到时再打开即可。
        </>
      )}
    </StateScreen>
  );
}

export function NoMailboxView() {
  return (
    <StateScreen icon={MailX} title="暂时没有可用的收件地址">
      请联系把链接发给你的人。
    </StateScreen>
  );
}

export function DeviceLimitView({ publicNote }: { publicNote: string | null }) {
  return (
    <>
      <StateScreen icon={Smartphone} tone="warning" title="这个链接已在其他设备上使用">
        设备名额已满。换了手机或浏览器的话，需要卖家重置设备。
      </StateScreen>
      <SellerNote note={publicNote} />
    </>
  );
}

type DailyLimitProps = { retryAfterAt: number | null; dailyLimit: number | null; publicNote: string | null };

export function DailyLimitView({ retryAfterAt, dailyLimit, publicNote }: DailyLimitProps) {
  const now = useNowSeconds();
  return (
    <>
      <StateScreen icon={Clock} tone="warning" title="今天的取码次数用完了">
        {dailyLimit === null ? "这个链接每 24 小时的取码次数有上限。" : `这个链接每 24 小时最多取 ${dailyLimit} 次。`}
        {retryAfterAt === null ? null : (
          <>
            {" "}最早的一次取码会在 <span className="mono">{formatDateTime(retryAfterAt)}</span> 满 24 小时，到时恢复 1 次（约 {formatCountdown(retryAfterAt, now)}后）。
          </>
        )}
      </StateScreen>
      <p className="pk-note" style={{ textAlign: "center" }}>
        这是每日上限，不是链接失效，到时间后回来就行。
      </p>
      <SellerNote note={publicNote} />
    </>
  );
}

/** 状态接口本身失败（网络、5xx、限流等）：就地显示原因与错误码，可重试；不冒充"已失效" */
export function LoadFailedView({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  return (
    <>
      <ErrorCallout title="页面加载失败" {...describePickupError(error)} />
      <Button size="lg" variant="secondary" onClick={onRetry}>
        重试
      </Button>
    </>
  );
}

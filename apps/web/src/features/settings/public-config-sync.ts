import type { QueryClient } from "@tanstack/react-query";
import type { SettingGroup, SettingsByGroup } from "@maillink/shared";
import { publicConfigQuery, queryKeys } from "../../api/queries";

const PUBLIC_GROUPS: ReadonlySet<SettingGroup> = new Set(["site", "appearance", "auth", "turnstile"]);

/**
 * 保存带“公开”标记的分组后，让 /api/public/config 的缓存跟上：外观先直接写入缓存（主题立刻与保存值一致，不等重取），
 * 再整体失效重取，侧栏站点名、登录页公告等用到公开配置的地方随之更新。
 */
export async function syncPublicConfig<G extends SettingGroup>(client: QueryClient, group: G, saved: SettingsByGroup[G]): Promise<void> {
  if (!PUBLIC_GROUPS.has(group)) return;
  if (group === "appearance") {
    const appearance = saved as SettingsByGroup["appearance"];
    client.setQueryData(publicConfigQuery().queryKey, (current) => (current ? { ...current, appearance } : current));
  }
  await client.invalidateQueries({ queryKey: queryKeys.publicConfig });
}

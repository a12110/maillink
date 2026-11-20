import type { EffectiveGrantRow } from "../db/grants";
import { notFoundError } from "../errors";
import { expandAddressForms, getCandidateById, type MailCandidate } from "../mail-source";

// 详情与附件：由邮件定位到"这封邮件属于当前用户的哪个授权"。
// 选择：mailbox（授权 id）可选。给了就只在那个授权里找；没给就按邮件自己的收件地址在用户的有效授权里定位。
// 一封邮件只属于一个收件地址、一个用户对一个地址最多一条授权（UNIQUE），所以结果唯一，不存在"取第一个可见的"的歧义。
// 这里只做定位；可见性（时间下界、规则、max_mails）由调用方随后在该授权的作用域里重走完整流水线判定，
// 定位错了或定位不到只会得到 404，不会放行。

const hidden = () => notFoundError("邮件不存在");

/** 与 access/detail.ts 的归属口径一致：to_address 非空时按它匹配，否则按 address；每个地址只认两种写法 */
function recipientOf(candidate: MailCandidate): string {
  return candidate.to_address || candidate.address;
}

export async function locateGrantForMail(
  mailDb: D1Database,
  grants: readonly EffectiveGrantRow[],
  mailId: number,
  mailbox: number | undefined,
): Promise<EffectiveGrantRow> {
  if (mailbox !== undefined) {
    const grant = grants.find((row) => row.id === mailbox);
    if (!grant) throw hidden();
    return grant;
  }
  const candidate = await getCandidateById(mailDb, mailId);
  if (!candidate) throw hidden();
  const recipient = recipientOf(candidate);
  const grant = grants.find((row) => expandAddressForms([row.address]).includes(recipient));
  if (!grant) throw hidden();
  return grant;
}

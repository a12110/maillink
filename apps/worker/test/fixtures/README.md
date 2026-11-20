# 测试样本

**这里的 `.eml` 全部是合成样本，不是真实邮件。** 域名、地址、验证码、链接均为虚构（`example.*` 保留域名）。每个文件都带 `X-Synthetic-Sample` 头作标记。

`X-ICLOUD-HME` 头的格式仿照参考项目 `worker/src/email/recipient_policy.ts` 的注释，**不是**从真实 Apple 转发邮件里抄来的。设计文档（01 §4.1）要求 M2 用一封脱敏后的真实 HME 转发邮件定稿 `From` 与 `s=` 的关系，这里的合成样本不能替代它。

| 文件 | 用途 | 种子里的存放方式 |
| --- | --- | --- |
| `icloud-hme-forward.eml` | iCloud 隐私邮箱转发邮件，`to_address` 为别名，`p=` 与别名一致（采用 `s=`） | `raw` |
| `icloud-hme-mismatch.eml` | HME 头的 `p=` 与收件别名**不一致**，带一个伪造的 `s=`（不得采用） | `raw` |
| `verification-code.eml` | 中文验证码邮件（纯文本，主题里也有码） | `raw` |
| `verification-code-zh.eml` / `verification-code-ja.eml` | 中文 / 日文验证码，RFC 2047 编码的主题与发件人名 | `raw` |
| `verification-code-spaced.eml` | 数字带空格（`123 456`），应提取为 `123456` | `raw` |
| `password-reset-code.eml` | "重设密码的验证码"：有验证码，但分类必须是 `password_reset` | `raw` |
| `password-reset.eml` | 重设密码邮件（含链接） | `raw` |
| `email-change.eml` / `security-notice.eml` / `billing-receipt.eml` | 分类：`email_change` / `security_change` / `billing` | `raw` |
| `no-code-distractors.eml` | 年份、金额、订单号、电话、优惠码等干扰项，没有验证码 | `raw` |
| `ai-extract-priority.eml` | 正文码 `112233`，种子行的 `metadata.ai_extract` 给 `445566`（验证 ai_extract 优先） | `raw` + `metadata` |
| `attachment.eml` | multipart/mixed，一个 RFC 2231 中文文件名的附件 | `raw` |
| `multiline-text.eml` | 多行纯文本（缩进、连续空行），验证展示正文保留换行、判定用 body 是单行 | `raw` |
| `masked-code.eml` | `Code sent to ****1234. Enter the code: 908172`：掩码尾号不能当验证码 | `raw` |
| `attachment-emoji.eml` | 文件名含 emoji（`📎report😀.txt`）的附件，验证下载头不会 500 | `raw` |
| `html-newsletter.eml` | multipart/alternative，含 HTML 与跟踪像素 | `raw` |
| `gzip-blob.eml` | 与开启 `ENABLE_MAIL_GZIP` 时一致：gzip 后放 `raw_blob`，`raw` 为空 | `raw_blob` |
| `malformed.eml` | 没有邮件头的畸形原文，解析必须失败（`parse_status='failed'`） | `raw` |
| `build-large-mail.ts` | 生成正文超过 32 KB 的邮件（体积大，不放静态文件），种子与测试共用 | `raw_blob`（gzip） |
| `risky-code-mails.ts` | 分类器样本（只给单测用）：最终验收的 13 封带验证码高危邮件、补充的多语言高危邮件、各语言普通登录码邮件 | 不进种子 |

种子脚本另外生成一行"原文丢失"的记录（`raw` 与 `raw_blob` 都为空），用来演示"两列都空要明确报错"。

种子脚本见 `apps/worker/scripts/seed-mail-db.ts`。

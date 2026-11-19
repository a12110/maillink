# 测试样本

**这里的 `.eml` 全部是合成样本，不是真实邮件。** 域名、地址、验证码、链接均为虚构（`example.*` 保留域名）。每个文件都带 `X-Synthetic-Sample` 头作标记。

`X-ICLOUD-HME` 头的格式仿照参考项目 `worker/src/email/recipient_policy.ts` 的注释，**不是**从真实 Apple 转发邮件里抄来的。设计文档（01 §4.1）要求 M2 用一封脱敏后的真实 HME 转发邮件定稿 `From` 与 `s=` 的关系，这里的合成样本不能替代它。

| 文件 | 用途 | 种子里的存放方式 |
| --- | --- | --- |
| `icloud-hme-forward.eml` | iCloud 隐私邮箱转发邮件，`to_address` 为别名 | `raw` |
| `verification-code.eml` | 普通验证码邮件（纯文本） | `raw` |
| `password-reset.eml` | 重设密码邮件（含链接） | `raw` |
| `html-newsletter.eml` | multipart/alternative，含 HTML 与跟踪像素 | `raw` |
| `gzip-blob.eml` | 与开启 `ENABLE_MAIL_GZIP` 时一致：gzip 后放 `raw_blob`，`raw` 为空 | `raw_blob` |

种子脚本见 `apps/worker/scripts/seed-mail-db.ts`。

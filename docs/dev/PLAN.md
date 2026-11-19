# 开发台账

由主 agent（claude-fable-5-2）维护。主 agent 只做调度与验收，具体实现由子 agent 完成。

## 模型分工

| 角色 | 模型 |
| --- | --- |
| 主 agent：调度、验收命令、提交 | `txapi-copy/claude-fable-5-2` |
| 子 agent：常规实现任务 | `txapi-copy/claude-sonnet-5-5` |
| 子 agent：复杂任务，或 sonnet 结果不达标时重做 | `txapi-copy/claude-opus-5-5` |
| 验收评审（里程碑评审与最终整体验收） | `txapi-copy/claude-opus-5-5` |

## 采用的默认决策

用户未逐项确认，按 `docs/design/README.md` §6 的默认值执行：

- D1 前端：React 19 + Vite + Tailwind v4 + Radix + TanStack Router/Query
- D2 按 Workers Paid 设计；D3 两个项目同账号；D4 `MAIL_DB` 严格只读
- D5 中文为主，保留 i18n 结构；D6 链接可多地址，上限 50
- D7 OAuth 登录后不再要求本地 2FA（可配）；D8 名称 MailLink
- D9 API 令牌放二期；D10 平台预设用文档里的 9 个
- 视觉方向：用户尚未确认。暂按"A 分拣台为底 + B 的密度与批量工具栏"实现（Agent 推断），所有取值走语义 CSS 变量，便于之后更换。
- 取件页：验证码卡片与列表加详情两种状态都做，由规则组视图决定。

## 里程碑

状态：待办 / 进行中 / 待验收 / 通过 / 退回

| 阶段 | 内容 | 执行模型 | 状态 | 证据 |
| --- | --- | --- | --- | --- |
| M0 | 脚手架、两个 D1、迁移、健康检查、本地种子 | sonnet-5-5 | 进行中 | |
| M1 | 初始化、账号密码登录、会话、用户与角色 | sonnet-5-5 | 待办 | |
| M2 | mail-source / 解析 / mail_index、管理员全部邮件 | sonnet-5-5 | 待办 | |
| M3a | 规则引擎（schema、求值、trace、分类、提取、呈现） | opus-5-5 | 待办 | |
| M3b | 收件地址、规则组、取件链接 API 与公开接口 | sonnet-5-5 | 待办 | |
| M4 | 用户授权、用户收件箱 | sonnet-5-5 | 待办 | |
| M5 | TOTP、Passkey、OAuth2/OIDC | opus-5-5 | 待办 | |
| M6 | 系统设置、外观、注册、Turnstile | sonnet-5-5 | 待办 | |
| UI | 前端各页面（随后端里程碑推进） | sonnet-5-5 | 待办 | |
| M7 | 审计、cron、限流、加固 | sonnet-5-5 | 待办 | |
| 终验 | 整体验收 | opus-5-5 | 待办 | |

## 记录

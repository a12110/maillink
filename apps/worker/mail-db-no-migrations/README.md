# 此目录必须保持为空

`MAIL_DB` 是 cloudflare_temp_email 的数据库，本项目只读它，**永远不迁移它**。

`wrangler.jsonc` 把 `MAIL_DB` 的 `migrations_dir` 指向这里，只是为了防误操作：wrangler 在 D1 绑定没配
`migrations_dir` 时默认用 `./migrations`，也就是本项目 `APP_DB` 的迁移；误敲
`wrangler d1 migrations apply MAIL_DB --remote` 会把本项目的建表语句执行到 temp_email 的库里。
指向这个空目录后，误操作找不到任何迁移文件，不会执行建表语句。

- 不要在这里放任何 `.sql` 文件（`test/mail-db-migrations-guard.test.ts` 会检查）。
- 即使目录为空，`wrangler d1 migrations list/apply MAIL_DB` 仍会在该库里建一张空的 `d1_migrations` 记录表；
  清理方法见 `docs/deploy.md` §2.2。迁移命令只写 `APP_DB`。

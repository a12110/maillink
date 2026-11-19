-- M2：mail_index 补列（只新增，不改 0001_init.sql）。
-- sender_address / sender_domain 沿用原列，内容为 JSON 数组（发件人候选列表与其域名）。
-- from_address：From 头地址，列表里"展示用发件人"取它；候选里排第一的不一定是 From（From 缺失时只有 HME 的 s=）。
-- code_source：验证码来源，规则引擎据此实现"ai_extract → 规则组 code_regex → 内置"的优先级（02 §4.6）。
-- link_domains：全部可解析链接的域名（JSON 数组），不受 links 列的数量/长度上限影响，防止用多余或超长链接让 link.domains 规则漏掉域名。
ALTER TABLE mail_index ADD COLUMN link_domains TEXT;
ALTER TABLE mail_index ADD COLUMN from_address TEXT;
ALTER TABLE mail_index ADD COLUMN code_source TEXT CHECK (code_source IN ('ai_extract', 'builtin'));

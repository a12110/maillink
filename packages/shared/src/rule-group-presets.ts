// 平台预设（06 §4）：只是"新建规则组"时的表单默认值，不是特殊代码。
// 这些发件人域名是凭常识填的初始值，没有用真实邮件核对过（verified: false）。
// 每个平台上线前都要拿一封经 iCloud 转发后的真实登录邮件在测试器里跑一遍；
// 主题模式与验证码正则一律从真实邮件生成（"以此邮件创建规则"），预设里先留空。

export type PlatformPreset = {
  key: string;
  name: string;
  /** 只填可注册域名，domain_is 会自动覆盖子域名 */
  sender_domains: readonly string[];
  subject_patterns: readonly string[];
  code_regex: string | null;
  /** 是否已用真实邮件核对过 */
  verified: boolean;
};

const preset = (key: string, name: string, domain: string): PlatformPreset => ({
  key,
  name,
  sender_domains: [domain],
  subject_patterns: [],
  code_regex: null,
  verified: false,
});

export const PLATFORM_PRESETS: readonly PlatformPreset[] = [
  preset("openai", "OpenAI", "openai.com"),
  preset("anthropic", "Anthropic", "anthropic.com"),
  preset("google", "Google", "google.com"),
  preset("apple", "Apple", "apple.com"),
  preset("microsoft", "Microsoft", "microsoft.com"),
  preset("netflix", "Netflix", "netflix.com"),
  preset("steam", "Steam", "steampowered.com"),
  preset("discord", "Discord", "discord.com"),
  preset("spotify", "Spotify", "spotify.com"),
];

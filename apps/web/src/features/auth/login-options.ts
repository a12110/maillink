import type { PublicConfig, PublicOAuthProvider } from "@maillink/shared";

export type LoginOptions = { password: boolean; passkey: boolean; providers: PublicOAuthProvider[] };

/** 按公开配置得出登录页能提供的登录方式：oauth 只有在列出了启用中的提供方时才算 */
export function loginOptionsOf(config: Pick<PublicConfig, "login_methods" | "oauth_providers">): LoginOptions {
  const providers = config.login_methods.includes("oauth") ? config.oauth_providers : [];
  return { password: config.login_methods.includes("password"), passkey: config.login_methods.includes("passkey"), providers };
}

export function hasAnyLoginOption(options: LoginOptions): boolean {
  return options.password || options.passkey || options.providers.length > 0;
}

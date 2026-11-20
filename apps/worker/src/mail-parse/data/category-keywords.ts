// 邮件分类关键词表（02 §3.6）：中、英、日、法、德、西、葡、意、韩、俄。词表任何改动都要递增 constants.ts 的 PARSER_VERSION。
// 全部小写（匹配前会把文本转小写）。
// subject：只在主题里匹配，可以放比较宽的词；
// body：在主题与正文里匹配，必须是具体短语——正文页脚常有"如非本人操作请修改密码"，宽泛的词会把普通验证码邮件误判成高危类别。
// 取舍：宁可把登录码误判成高危（买家拿不到码会找卖家），不要把高危漏判成登录码（直接交出账号控制权）；
// 但"修改密码 / change your password / 开启两步验证"这类会出现在登录邮件页脚或安全提示里的祈使句不进 body，
// 改收"…的验证码 / code to …"、"已被关闭 / has been disabled"这类只在敏感操作邮件里出现的说法。
// 页脚条件句"If you didn't request this, you can reset your password"：以 NOT_YOU_MARKERS 开头的句子里，
// 只有紧跟引导语逗号、以建议动词（reset / change / update / secure，修改 / 重置 / 更改 / 重设）开头、不超过 80 字符的
// 那一个分句不参与匹配（category.ts）；引导部分与之后的分句照常匹配。
// 法语、意大利语里的撇号同时收 ' 与 ’（NFKC 不会把 ’ 归一成 '）。

export type CategoryKeywords = { subject: readonly string[]; body: readonly string[] };

const RIGHT_SINGLE_QUOTE = "\u2019";

/** 含撇号的短语同时收 ' 与 ’ 两种写法 */
const withApostrophes = (words: readonly string[]): string[] =>
  words.flatMap((word) => (word.includes("'") ? [word, word.replaceAll("'", RIGHT_SINGLE_QUOTE)] : [word]));

export const EMAIL_CHANGE: CategoryKeywords = {
  subject: withApostrophes([
    "email change", "change of email", "change your email", "update your email", "email address change",
    "e-mail change", "email address update", "new email address", "email updated", "email changed", "update the email",
    "邮箱变更", "更换邮箱", "修改邮箱", "更改邮箱", "变更邮箱", "邮箱更换", "換綁信箱", "更改電子郵件", "變更電子郵件",
    "メールアドレス変更", "メールアドレスの変更", "メールアドレスを変更",
    "adresse e-mail modifiée", "changement d'e-mail", "modification de l'e-mail",
    "e-mail-adresse ändern", "e-mail-adresse geändert", "e-mail-änderung",
    "cambio de correo", "cambiar correo", "cambio de email",
    "alteração de e-mail", "alteração do e-mail", "alterar e-mail", "mudança de e-mail",
    "modifica email", "modifica e-mail", "cambio email", "cambio e-mail", "modifica dell'indirizzo email",
    "이메일 변경", "이메일 주소 변경",
    "смена email", "изменение email", "смена e-mail", "смена почты", "изменение почты",
  ]),
  body: withApostrophes([
    // English
    "change your email", "change of email address", "email address change", "update your email address",
    "confirm your new email", "verify your new email", "new email address", "email address was changed",
    "update the email on", "change the email on", "update the email address on", "change the email address on",
    "update the email address for", "change the email address for", "change your account email", "update your account email",
    "change your login email", "update your login email", "change your e-mail", "change of e-mail", "e-mail address change",
    "update your e-mail address", "new e-mail address", "email change request", "confirm your email change",
    "email address has been changed", "email address has been updated", "email address was updated", "email was changed",
    "change to your email", "change to your e-mail", "change to your sign-in email", "change to your account email",
    "change to your login email", "change your sign-in email", "update your sign-in email", "new sign-in email",
    // 中文
    "更换邮箱", "更改邮箱", "修改邮箱", "变更邮箱", "新邮箱", "邮箱变更", "换绑邮箱", "更换绑定邮箱", "修改绑定邮箱", "绑定新邮箱",
    "邮箱地址变更", "修改邮箱地址", "更改电子邮件", "更改电子邮箱", "更换电子邮箱", "修改电子邮箱", "新的电子邮箱",
    "更改電子郵件", "變更電子郵件", "更換電子郵件", "更換信箱", "變更信箱", "新的電子郵件地址",
    // 日本語
    "メールアドレスを変更", "メールアドレスの変更", "新しいメールアドレス", "メールアドレス変更", "メールアドレスが変更",
    // Français
    "changement d'adresse e-mail", "changement d'adresse email", "changement d'adresse électronique", "changement d'adresse courriel",
    "changement d'e-mail", "modifier votre adresse e-mail", "modifier votre adresse email", "modifier votre adresse courriel",
    "modifier votre e-mail", "modification de votre adresse e-mail", "modification de l'adresse e-mail",
    "changer votre adresse e-mail", "changer d'adresse e-mail", "mettre à jour votre adresse e-mail",
    "nouvelle adresse e-mail", "nouvelle adresse email", "nouvelle adresse électronique", "nouvelle adresse courriel",
    "adresse e-mail a été modifiée", "adresse email a été modifiée",
    // Deutsch
    "e-mail-adresse ändern", "e-mail-adresse zu ändern", "e-mail-adresse geändert", "e-mail-adresse aktualisieren",
    "e-mail adresse ändern", "emailadresse ändern", "änderung der e-mail-adresse", "änderung ihrer e-mail-adresse",
    "änderung ihrer e-mail", "neue e-mail-adresse", "neue e-mail adresse", "neue emailadresse", "e-mail-änderung",
    // Español
    "cambiar tu correo electrónico", "cambiar su correo electrónico", "cambiar tu dirección de correo",
    "cambiar su dirección de correo", "cambiar el correo electrónico", "cambiar tu email", "cambiar el email",
    "cambio de correo electrónico", "cambio de dirección de correo", "cambio de email", "nueva dirección de correo",
    "nueva dirección de email", "actualizar tu correo electrónico", "actualizar tu dirección de correo",
    "actualizar el correo electrónico", "correo electrónico ha sido cambiado", "dirección de correo electrónico ha cambiado",
    // Português
    "alterar seu e-mail", "alterar seu email", "alterar o seu e-mail", "alterar o e-mail", "alterar o endereço de e-mail",
    "alteração de e-mail", "alteração do e-mail", "alteração do endereço de e-mail", "alteração de endereço de e-mail",
    "novo endereço de e-mail", "novo endereço de email", "novo endereço de correio eletrónico", "atualizar seu e-mail",
    "atualizar seu endereço de e-mail", "mudança de e-mail", "trocar seu e-mail", "troca de e-mail", "e-mail foi alterado",
    "endereço de e-mail foi alterado",
    // Italiano
    "modifica dell'indirizzo email", "modifica dell'indirizzo e-mail", "modificare l'indirizzo email",
    "modificare il tuo indirizzo email", "modifica il tuo indirizzo email", "cambia il tuo indirizzo email",
    "cambiare l'indirizzo email", "cambiare il tuo indirizzo email", "nuovo indirizzo email", "nuovo indirizzo e-mail",
    "aggiornare l'indirizzo email", "aggiorna il tuo indirizzo email", "modifica indirizzo email", "cambio indirizzo email",
    "cambio dell'indirizzo email", "indirizzo email è stato modificato", "indirizzo email è stato cambiato",
    // 한국어
    "이메일 변경", "이메일 주소 변경", "이메일을 변경", "이메일 주소를 변경", "새 이메일 주소", "이메일 주소가 변경", "이메일이 변경",
    // Русский
    "смена email", "смены email", "смена e-mail", "изменение email", "изменить email", "сменить email", "новый email",
    "смена адреса электронной почты", "смены адреса электронной почты", "изменение адреса электронной почты",
    "изменения адреса электронной почты", "изменить адрес электронной почты", "сменить адрес электронной почты",
    "новый адрес электронной почты", "смена почты", "изменение почты", "сменить почту", "изменить почту",
    "адрес электронной почты изменен", "адрес электронной почты изменён", "адрес электронной почты был изменен",
  ]),
};

export const PASSWORD_RESET: CategoryKeywords = {
  subject: [
    "reset your password", "password reset", "reset password", "forgot password", "forgot your password",
    "recover your password", "change your password", "change password", "password change", "password changed",
    "重设密码", "重置密码", "找回密码", "修改密码", "密码重置", "忘记密码", "重設密碼", "重置密碼", "修改密碼", "變更密碼", "更改密码",
    "パスワードのリセット", "パスワード再設定", "パスワードを再設定", "パスワードをリセット", "パスワード変更",
    "パスワードの変更", "パスワードをお忘れ",
    "réinitialiser", "réinitialisation", "mot de passe oublié", "modifier votre mot de passe", "changer votre mot de passe",
    "changement de mot de passe", "modification du mot de passe", "nouveau mot de passe",
    "passwort zurücksetzen", "passwort ändern", "passwortänderung", "passwort vergessen", "passwort-reset", "neues passwort",
    "kennwort zurücksetzen", "kennwort ändern", "kennwortänderung",
    "restablecer", "restablecimiento de contraseña", "cambiar tu contraseña", "cambio de contraseña", "recuperar contraseña",
    "contraseña olvidada", "olvidaste tu contraseña",
    "redefinir", "redefinição de senha", "alterar sua senha", "alteração de senha", "recuperar senha", "recuperação de senha",
    // 不收单独的 palavra-passe："palavra-passe de uso único" 是一次性登录密码
    "esqueceu sua senha", "redefinir a palavra-passe", "repor a palavra-passe", "alterar a palavra-passe",
    "reimposta", "reimpostazione", "cambia la password", "modifica password", "modifica della password", "recupero password",
    "password dimenticata",
    "비밀번호 재설정", "비밀번호 변경", "비밀번호 찾기", "암호 재설정", "비밀번호를 재설정",
    "сброс пароля", "восстановление пароля", "смена пароля", "изменение пароля", "забыли пароль", "новый пароль",
  ],
  body: [
    // English
    "reset your password", "password reset", "reset password", "forgot your password", "recover your password",
    "set a new password", "create a new password", "choose a new password", "enter a new password", "your new password",
    "reset the password", "password recovery", "code to change your password", "change your password using",
    "password change request", "requested a password change", "request to change your password",
    "requested to change your password", "confirm your password change", "change your login credentials",
    "update your login credentials", "change your steam login credentials",
    // 目的状语"…to change your password"（"code is 123456 to change your password"）；页脚"If this wasn't you, change your password"
    // 是祈使句，不含 to；条件句后半句的建议由 category.ts 去掉
    "to change your password", "to update your password",
    // 中文
    "重设密码", "重置密码", "找回密码", "密码重置", "忘记密码", "重設密碼", "重置密碼", "忘記密碼", "密碼重設",
    "正在修改密码", "修改密码的验证码", "修改密码验证码", "更改密码的验证码", "修改密碼的驗證碼", "變更密碼的驗證碼",
    "设置新密码", "新密码", "修改登录密码", "密码找回",
    // 日本語
    "パスワードのリセット", "パスワードを再設定", "パスワードの再設定", "パスワードをリセット", "パスワード再設定",
    "パスワードを変更するための", "パスワードをお忘れ", "新しいパスワード",
    // Français
    "réinitialiser votre mot de passe", "réinitialiser le mot de passe", "réinitialisation du mot de passe",
    "réinitialisation de votre mot de passe", "reinitialiser votre mot de passe", "reinitialisation du mot de passe",
    "mot de passe oublié", "nouveau mot de passe", "récupérer votre mot de passe", "récupération du mot de passe",
    "code pour modifier votre mot de passe", "code pour changer votre mot de passe", "changement de mot de passe",
    "modification de votre mot de passe", "modification du mot de passe",
    // Deutsch
    "passwort zurücksetzen", "passwort zurückzusetzen", "zurücksetzen des passworts", "zurücksetzen ihres passworts",
    "passwort-reset", "passwort reset", "passwort vergessen", "neues passwort", "kennwort zurücksetzen",
    "kennwort zurückzusetzen", "kennwort vergessen", "neues kennwort", "passwortänderung", "änderung ihres passworts",
    "änderung des passworts", "passwort-wiederherstellung", "passwortwiederherstellung", "passwort wiederherstellen",
    // Español
    "restablecer tu contraseña", "restablecer su contraseña", "restablecer la contraseña", "restablecer contraseña",
    "restablecimiento de contraseña", "restablecimiento de la contraseña", "recuperar tu contraseña",
    "recuperar su contraseña", "recuperación de contraseña", "olvidaste tu contraseña", "olvidó su contraseña",
    "nueva contraseña", "cambio de contraseña", "código para cambiar tu contraseña", "código para cambiar su contraseña",
    // Português
    "redefinir sua senha", "redefinir a sua senha", "redefinir a senha", "redefinir senha", "redefinição de senha",
    "redefinição da senha", "recuperar sua senha", "recuperação de senha", "esqueceu sua senha", "esqueceu a senha",
    "esqueceu a sua senha", "nova senha", "alteração de senha", "alteração da senha", "código para alterar sua senha",
    "repor a sua palavra-passe", "redefinir a sua palavra-passe", "redefinição da palavra-passe", "nova palavra-passe",
    "esqueceu-se da palavra-passe", "recuperar a palavra-passe",
    // Italiano
    "reimposta la password", "reimpostare la password", "reimpostare la tua password", "reimposta la tua password",
    "reimpostazione della password", "reimpostazione password", "recupera la password", "recuperare la password",
    "recupero password", "recupero della password", "password dimenticata", "nuova password", "modifica della password",
    "codice per modificare la password", "codice per cambiare la password",
    // 한국어
    "비밀번호 재설정", "비밀번호를 재설정", "비밀번호 찾기", "비밀번호를 잊", "새 비밀번호", "비밀번호 변경 요청",
    "비밀번호 변경을 위한", "비밀번호 변경 인증", "암호 재설정", "암호를 재설정", "패스워드 재설정",
    // Русский
    "сброс пароля", "сброса пароля", "сбросить пароль", "сбросить ваш пароль", "восстановление пароля",
    "восстановления пароля", "восстановить пароль", "забыли пароль", "новый пароль", "смена пароля", "смены пароля",
    "изменение пароля", "изменения пароля",
  ],
};

export const SECURITY_CHANGE: CategoryKeywords = {
  subject: withApostrophes([
    "security alert", "two-factor authentication disabled", "two-step verification disabled", "account recovery",
    "recover your account", "delete your account", "account deletion", "new passkey", "sign-in method",
    "two-factor authentication enabled", "two-step verification enabled", "2fa enabled", "2fa disabled", "phone number",
    "authenticator app", "security key", "recovery email", "recovery phone", "security info", "backup codes",
    "recovery codes", "passkey added", "passkey removed",
    "安全提醒", "安全警报", "安全通知", "关闭两步验证", "停用两步验证", "账号恢复", "找回账号", "删除账号", "注销账号",
    "新的登录方式", "更换手机号", "修改手机号", "换绑手机", "安全性警示", "刪除帳號", "註銷帳號",
    "セキュリティ通知", "セキュリティ警告", "2段階認証をオフ", "二段階認証を無効", "アカウントの復旧", "アカウントを削除",
    "新しいログイン方法", "電話番号の変更", "電話番号の追加", "退会",
    "alerte de sécurité", "numéro de téléphone", "suppression de votre compte", "récupération de compte",
    "sicherheitswarnung", "sicherheitshinweis", "sicherheitsbenachrichtigung", "telefonnummer", "konto löschen",
    "alerta de seguridad", "aviso de seguridad", "número de teléfono", "eliminar tu cuenta",
    "alerta de segurança", "aviso de segurança", "número de telefone", "excluir sua conta",
    "avviso di sicurezza", "avviso di protezione", "numero di telefono", "eliminazione dell'account",
    "보안 알림", "보안 경고", "전화번호", "휴대폰 번호", "계정 삭제",
    "оповещение безопасности", "предупреждение безопасности", "уведомление безопасности",
    "оповещение системы безопасности", "предупреждение системы безопасности", "номер телефона", "удаление аккаунта",
  ]),
  body: withApostrophes([
    // English：两步验证 / 验证器 / 安全密钥 / 通行密钥
    "two-factor authentication has been disabled", "two-factor authentication was turned off",
    "two-step verification has been turned off", "turned off two-step verification", "turned off two-factor",
    "disabled two-factor", "disable two-factor", "remove two-factor", "turn off two-factor", "turn off two-step",
    "disable two-step", "remove two-step", "two-factor authentication has been enabled", "two-factor authentication was enabled",
    "two-factor authentication was turned on", "two-step verification has been turned on", "two-step verification was turned on",
    "enabled two-factor", "turned on two-factor", "to enable two-factor", "to set up two-factor", "to turn on two-factor",
    "reset two-factor", "reset your two-factor", "change your two-factor", "2-step verification has been",
    "2-step verification was", "turn off 2-step", "disable 2fa", "enable 2fa", "turn off 2fa", "turn on 2fa", "set up 2fa",
    "remove 2fa", "reset 2fa", "reset your 2fa", "2fa has been", "2fa was",
    "remove your authenticator", "remove the authenticator", "remove an authenticator", "authenticator app was",
    "authenticator app has been", "authenticator was", "authenticator has been", "add an authenticator",
    "set up an authenticator", "set up your authenticator", "set up authenticator", "new authenticator",
    "change your authenticator", "reset your authenticator", "disable your authenticator", "turn off your authenticator",
    "link an authenticator", "security key was added", "security key has been added", "security key was removed",
    "security key has been removed", "add a security key", "register a security key", "new security key",
    "remove a security key", "remove your security key", "passkey was added", "added a passkey", "passkey has been added",
    "add a passkey", "create a passkey", "passkey was removed", "passkey has been removed", "remove a passkey", "new passkey",
    "new sign-in method", "new backup codes", "backup codes were", "backup codes have been", "generate new backup codes",
    "new recovery codes", "recovery codes were", "recovery codes have been",
    // English：手机号 / 恢复邮箱 / 安全信息 / 账号恢复与删除
    "add a phone number", "add a new phone number", "add your phone number", "add this phone number",
    "verify your phone number", "verify this phone number", "confirm your phone number", "confirm this phone number",
    "change your phone number", "update your phone number", "new phone number", "phone number was added",
    "phone number has been added", "phone number to your account", "phone number was changed", "phone number has been changed",
    "recovery email", "recovery phone", "backup email", "secondary email", "alternate email", "recovery contact",
    "recovery information", "recovery info", "recovery options", "security info was added", "security info was changed",
    "add security info", "security information was", "security settings were changed", "security settings have been changed",
    "changes to your security settings", "security question was changed", "security questions were changed",
    "recover your account", "restore your account", "delete your account", "account deletion", "permanently delete",
    "close your account", "deactivate your account",
    // English：账号转让、付款方式、会话与安全设置（终验复核补充）
    "transfer of account ownership", "account ownership", "transfer ownership", "ownership transfer",
    "update your payment method", "change your payment method", "add a payment method", "add a new payment method",
    "remove your payment method", "remove a payment method", "new payment method", "payment method was",
    "payment method has been", "reset security settings", "reset your security settings", "sign out of all other devices",
    "sign out of all devices", "sign out of all other sessions", "log out of all devices", "log out of all other devices",
    // 中文
    "关闭两步验证", "停用两步验证", "关闭双重验证", "关闭二次验证", "开启两步验证", "启用两步验证", "开启双重验证",
    "启用双重验证", "开启二次验证", "关闭登录保护", "身份验证器", "验证器应用", "安全密钥", "账号恢复", "找回账号", "恢复账号",
    "删除账号", "注销账号", "删除账户", "注销账户", "新增登录方式", "添加登录方式", "新的登录方式", "通行密钥已添加",
    "更换手机号", "修改手机号", "换绑手机", "更换绑定手机", "解绑手机", "绑定新手机", "绑定手机号的验证码", "添加手机号",
    "新手机号", "备用邮箱", "辅助邮箱", "密保邮箱", "密保手机", "辅助手机", "修改密保", "安全问题已修改",
    "雙重驗證已停用", "停用雙重驗證", "關閉雙重驗證", "兩步驟驗證已關閉", "關閉兩步驟驗證", "刪除帳號", "刪除帳戶",
    "註銷帳號", "恢復帳號", "復原帳戶", "帳戶復原", "備用電子郵件", "復原電子郵件", "新增電話號碼", "變更電話號碼",
    "安全金鑰", "驗證器應用程式", "密碼金鑰已新增", "新增密碼金鑰",
    // 日本語
    "2段階認証をオフ", "二段階認証を無効", "二段階認証をオフ", "2段階認証を有効", "二段階認証を有効", "2段階認証を設定",
    "2段階認証の設定", "2段階認証を解除", "二段階認証を解除", "2段階認証の解除", "2要素認証を無効", "2要素認証をオフ",
    "2要素認証を有効", "二要素認証を無効", "アカウントの復旧", "アカウントを削除", "アカウント削除", "新しいログイン方法",
    "パスキーが追加", "パスキーを追加", "パスキーが削除", "パスキーを削除", "電話番号を追加", "電話番号の追加",
    "電話番号を変更", "電話番号の変更", "新しい電話番号", "電話番号を確認", "電話番号の確認", "認証アプリを削除",
    "認証アプリが追加", "認証アプリを変更", "認証アプリの変更", "認証アプリを登録", "セキュリティキー",
    "再設定用のメールアドレス", "再設定用の電話番号", "予備のメールアドレス", "復旧用のメールアドレス", "復旧用の電話番号",
    // Français
    "ajouter un numéro de téléphone", "ajouter votre numéro de téléphone", "nouveau numéro de téléphone",
    "vérifier votre numéro de téléphone", "confirmer votre numéro de téléphone", "modifier votre numéro de téléphone",
    "changer votre numéro de téléphone", "numéro de téléphone a été ajouté", "numéro de téléphone a été modifié",
    "authentification à deux facteurs a été désactivée", "authentification à deux facteurs a été activée",
    "authentification à deux facteurs désactivée", "désactiver l'authentification à deux facteurs",
    "pour activer l'authentification à deux facteurs", "validation en deux étapes a été désactivée",
    "désactiver la validation en deux étapes", "validation en deux étapes désactivée",
    "vérification en deux étapes a été désactivée", "désactiver la vérification en deux étapes",
    "double authentification désactivée", "désactiver la double authentification",
    "application d'authentification a été", "supprimer l'application d'authentification",
    "nouvelle application d'authentification", "configurer une application d'authentification",
    "e-mail de récupération", "adresse e-mail de récupération", "adresse de récupération", "numéro de récupération",
    "téléphone de récupération", "clé de sécurité", "supprimer votre compte", "suppression de votre compte",
    "suppression du compte", "fermer votre compte", "récupérer votre compte", "récupération de compte",
    "récupération du compte", "récupération de votre compte", "nouvelle clé d'accès", "clé d'accès a été ajoutée",
    "ajouter une clé d'accès",
    // Deutsch
    "telefonnummer hinzufügen", "telefonnummer hinzuzufügen", "neue telefonnummer", "telefonnummer bestätigen",
    "telefonnummer zu bestätigen", "telefonnummer verifizieren", "telefonnummer ändern", "telefonnummer zu ändern",
    "telefonnummer wurde", "handynummer hinzufügen", "mobilnummer hinzufügen", "neue handynummer", "neue mobilnummer",
    "zwei-faktor-authentifizierung wurde", "zwei-faktor-authentifizierung deaktiviert", "zwei-faktor-authentifizierung aktiviert",
    "zwei-faktor-authentifizierung deaktivieren", "zwei-faktor-authentifizierung zu aktivieren",
    "2-faktor-authentifizierung wurde", "2-faktor-authentifizierung deaktiviert", "2-faktor-authentifizierung aktiviert",
    "bestätigung in zwei schritten wurde", "bestätigung in zwei schritten deaktiviert", "zweistufige verifizierung wurde",
    "authenticator-app entfernt", "authenticator-app hinzugefügt", "authenticator-app wurde", "authenticator-app einrichten",
    "authenticator-app zu entfernen", "authentifizierungs-app wurde", "sicherheitsschlüssel",
    "wiederherstellungs-e-mail", "wiederherstellungstelefonnummer", "wiederherstellungsnummer", "konto wiederherstellen",
    "kontowiederherstellung", "konto löschen", "kontolöschung", "ihr konto zu löschen", "neuer passkey", "passkey hinzugefügt",
    // Español
    "agregar un número de teléfono", "añadir un número de teléfono", "agregar tu número de teléfono",
    "añadir tu número de teléfono", "nuevo número de teléfono", "verificar tu número de teléfono",
    "confirmar tu número de teléfono", "cambiar tu número de teléfono", "número de teléfono ha sido", "número de teléfono se ha",
    "autenticación de dos factores ha sido desactivada", "autenticación de dos factores se ha desactivado",
    "autenticación de dos factores ha sido activada", "autenticación de dos factores desactivada",
    "desactivar la autenticación de dos factores", "para activar la autenticación de dos factores",
    "verificación en dos pasos ha sido desactivada", "verificación en dos pasos se ha desactivado",
    "desactivar la verificación en dos pasos", "verificación en dos pasos desactivada",
    "aplicación de autenticación ha sido", "eliminar la aplicación de autenticación", "nueva aplicación de autenticación",
    "configurar una aplicación de autenticación", "correo de recuperación", "correo electrónico de recuperación",
    "teléfono de recuperación", "número de recuperación", "clave de seguridad", "llave de seguridad", "eliminar tu cuenta",
    "eliminar su cuenta", "eliminación de tu cuenta", "eliminación de la cuenta", "eliminación de cuenta", "cerrar tu cuenta",
    "recuperar tu cuenta", "recuperar su cuenta", "recuperación de cuenta", "recuperación de la cuenta",
    "nueva clave de acceso", "clave de acceso agregada", "llave de acceso",
    // Português
    "adicionar um número de telefone", "adicionar seu número de telefone", "novo número de telefone",
    "verificar seu número de telefone", "confirmar seu número de telefone", "alterar seu número de telefone",
    "número de telefone foi", "adicionar um número de telemóvel", "novo número de telemóvel",
    "adicionar um número de celular", "novo número de celular", "alterar seu número de celular",
    "autenticação de dois fatores foi desativada", "autenticação de dois fatores foi ativada",
    "autenticação de dois fatores desativada", "desativar a autenticação de dois fatores",
    "para ativar a autenticação de dois fatores", "verificação em duas etapas foi desativada",
    "verificação em duas etapas desativada", "desativar a verificação em duas etapas", "aplicativo autenticador foi",
    "remover o aplicativo autenticador", "novo aplicativo autenticador", "aplicativo de autenticação foi",
    "remover o aplicativo de autenticação", "aplicação de autenticação foi", "e-mail de recuperação", "email de recuperação",
    "telefone de recuperação", "número de recuperação", "chave de segurança", "excluir sua conta", "excluir a sua conta",
    "exclusão da conta", "exclusão de conta", "eliminar a sua conta", "eliminação da conta", "encerrar sua conta",
    "recuperar sua conta", "recuperar a sua conta", "recuperação de conta", "recuperação da conta", "nova chave de acesso",
    "chave de acesso adicionada",
    // Italiano
    "aggiungere un numero di telefono", "aggiungi un numero di telefono", "nuovo numero di telefono",
    "verifica il tuo numero di telefono", "verificare il tuo numero di telefono", "conferma il tuo numero di telefono",
    "confermare il tuo numero di telefono", "modificare il numero di telefono", "modifica del numero di telefono",
    "numero di telefono è stato", "autenticazione a due fattori è stata disattivata",
    "autenticazione a due fattori è stata attivata", "autenticazione a due fattori disattivata",
    "disattivare l'autenticazione a due fattori", "per attivare l'autenticazione a due fattori",
    "verifica in due passaggi è stata disattivata", "verifica in due passaggi disattivata",
    "disattivare la verifica in due passaggi", "app di autenticazione è stata", "rimuovere l'app di autenticazione",
    "nuova app di autenticazione", "configurare un'app di autenticazione", "email di recupero", "e-mail di recupero",
    "indirizzo email di recupero", "telefono di recupero", "numero di telefono di recupero", "chiave di sicurezza",
    "eliminare il tuo account", "elimina il tuo account", "eliminazione dell'account", "eliminazione del tuo account",
    "chiudere il tuo account", "recuperare il tuo account", "recupera il tuo account", "recupero dell'account",
    "recupero account", "nuova passkey", "passkey è stata aggiunta",
    // 한국어
    "전화번호 추가", "전화번호를 추가", "휴대폰 번호 추가", "휴대폰 번호를 추가", "휴대전화 번호 추가", "휴대전화 번호를 추가",
    "전화번호 변경", "전화번호를 변경", "휴대폰 번호 변경", "휴대폰 번호를 변경", "휴대전화 번호 변경", "새 전화번호",
    "새 휴대폰 번호", "전화번호 인증", "전화번호를 인증", "휴대폰 번호 인증", "전화번호 확인",
    "2단계 인증 해제", "2단계 인증을 해제", "2단계 인증이 해제", "2단계 인증을 설정", "2단계 인증이 설정",
    "2단계 인증 사용 중지", "2단계 인증을 사용 중지", "2차 인증 해제", "2차 인증을 해제", "이중 인증 해제", "이중 인증을 해제",
    "인증 앱을 삭제", "인증 앱이 삭제", "인증 앱을 변경", "인증 앱이 변경", "인증 앱 변경", "인증 앱을 등록", "인증 앱이 등록",
    "새 인증 앱", "otp 해제", "복구 이메일", "복구 전화번호", "복구용 이메일", "보조 이메일", "보안 키", "계정 삭제",
    "계정을 삭제", "계정 복구", "계정을 복구", "회원 탈퇴", "회원탈퇴", "패스키가 추가", "새 패스키", "패스키를 추가",
    // Русский
    "добавить номер телефона", "добавления номера телефона", "новый номер телефона", "подтвердить номер телефона",
    "подтвердите номер телефона", "подтверждения номера телефона", "изменить номер телефона", "сменить номер телефона",
    "смена номера телефона", "смены номера телефона", "изменение номера телефона", "изменения номера телефона",
    "привязать номер телефона", "привязки номера телефона", "привязка номера телефона",
    "двухфакторная аутентификация отключена", "двухфакторная аутентификация включена", "отключить двухфакторную",
    "отключение двухфакторной", "отключения двухфакторной", "включить двухфакторную", "включение двухфакторной",
    "двухэтапная аутентификация отключена", "отключить двухэтапную", "отключение двухэтапной", "двухэтапная проверка отключена",
    "отвязать аутентификатор", "удалить аутентификатор", "аутентификатор удален", "аутентификатор удалён",
    "аутентификатор привязан", "привязать аутентификатор", "новый аутентификатор", "приложение для аутентификации",
    "резервный адрес электронной почты", "резервной почты", "резервная почта", "резервный адрес", "резервный номер",
    "резервного номера", "ключ безопасности", "ключа безопасности", "удалить аккаунт", "удаление аккаунта",
    "удаления аккаунта", "удалить учетную запись", "удаление учетной записи", "удаления учетной записи",
    "удалить учётную запись", "удаление учётной записи", "удаления учётной записи", "восстановление аккаунта",
    "восстановления аккаунта", "восстановить аккаунт", "восстановление доступа", "восстановления доступа",
    "новый ключ доступа", "ключ доступа добавлен",
  ]),
};

export const BILLING: CategoryKeywords = {
  subject: [
    "invoice", "receipt", "payment", "billing", "subscription", "renewal", "refund", "your order",
    "账单", "收据", "发票", "订阅", "续费", "付款", "支付", "扣款", "退款", "订单",
    "請求書", "領収書", "ご請求", "お支払い", "支払い", "定期購入", "サブスクリプション", "返金", "ご注文",
  ],
  body: [
    // 正文里单独的 subscription / 订阅 / サブスクリプション 太宽（"Manage your email subscription preferences" 是营销页脚），只收具体短语
    "your receipt", "payment receipt", "payment successful", "payment failed", "invoice", "billing",
    "subscription renewed", "subscription receipt", "subscription payment", "your subscription has", "your subscription will",
    "renewal receipt", "you were charged", "you have been charged", "refund",
    "账单", "收据", "发票", "订阅已", "订阅将", "订阅成功", "订阅续费", "付款成功", "支付成功", "扣款", "退款",
    "請求書", "領収書", "お支払い", "サブスクリプションの更新", "サブスクリプションが更新", "返金",
  ],
};

/** 页脚"如非本人操作"一类条件句的开头（全部小写，只收中、英）；见文件头对建议分句的说明 */
export const NOT_YOU_MARKERS: readonly string[] = withApostrophes([
  "if you didn't", "if you did not", "if this wasn't you", "if this was not you", "if it wasn't you", "if it was not you",
  "if you don't recognize", "if you do not recognize",
  "如非本人", "若非本人", "如果不是您本人", "如果不是你本人", "如果这不是您",
]);

/** 没有验证码但有链接时，出现这些词也算 verification（登录链接类邮件） */
export const LOGIN_LINK_KEYWORDS: readonly string[] = [
  "sign in", "log in", "login link", "magic link", "sign-in link", "confirm your email", "verify your email",
  "登录链接", "登录", "验证邮箱", "确认邮箱", "ログイン", "メールアドレスの確認",
];

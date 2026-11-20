// 分类器的合成样本（不是真实邮件）：带验证码的高危邮件，与各语言的普通登录码邮件。
// RISKY_FINAL_REVIEW 是最终验收（C1）原样灌进库的 13 封，#112 / #116 / #123 当时被模板 A（L2）交给了买家。

export type CodeMailSample = {
  /** 用例名里显示的编号 */
  id: string;
  lang: string;
  subject: string;
  text: string;
  html?: string;
  /** 这封邮件里的验证码（模拟 temp_email 的 ai_extract 提取到它） */
  code: string;
};

export const RISKY_FINAL_REVIEW: readonly CodeMailSample[] = [
  { id: "#110", lang: "en", subject: "Your verification code", text: "Use this code to change your password: 110110. If you did not request this, ignore this email.", code: "110110" },
  { id: "#111", lang: "en", subject: "Your Steam account: verification", text: "Here is the Steam Guard code you need to change your Steam login credentials: 111999", code: "111999" },
  { id: "#112", lang: "en", subject: "Security code", text: "Please use the following security code to add a new phone number to your account. Security code: 112112", code: "112112" },
  { id: "#113", lang: "en", subject: "Verify it's you", text: "Enter 113113 to confirm you want to remove your authenticator app. This verification code expires in 10 minutes.", code: "113113" },
  { id: "#114", lang: "es", subject: "Código de verificación", text: "Usa este código para restablecer tu contraseña. Código de verificación: 114114", code: "114114" },
  { id: "#115", lang: "ko", subject: "인증 코드", text: "비밀번호 재설정을 위한 인증 코드: 115115", code: "115115" },
  { id: "#116", lang: "en", subject: "Your verification code", text: "Use verification code 116116 to update the email on your account to a different address.", code: "116116" },
  { id: "#118", lang: "en", subject: "Microsoft account password reset", text: "Please use this code to reset the password for the Microsoft account. Here is your code: 1181181", code: "1181181" },
  {
    id: "#119",
    lang: "en",
    subject: "Your verification code",
    text: "Your verification code is 119119.",
    html: '<p>Your verification code is 119119.</p><p style="display:none">reset your password</p>',
    code: "119119",
  },
  { id: "#120", lang: "en", subject: "Your verification code", text: "Your verification code is 120120. re\u200Bset your pass\u00ADword now.", code: "120120" },
  { id: "#121", lang: "en", subject: "Ｙour verification code", text: "Ｒｅｓｅｔ ｙｏｕｒ ｐａｓｓｗｏｒｄ with code 121121", code: "121121" },
  { id: "#122", lang: "en", subject: "Your verification code", text: "Your verification code to delete your account is 122122", code: "122122" },
  { id: "#123", lang: "fr", subject: "Your verification code", text: "Vérification: utilisez le code 123123 pour réinitialiser votre mot de passe.", code: "123123" },
];

/** 补充的高危样本：主题都是"验证码"一类的中性说法，只有正文点明用途 */
export const RISKY_EXTRA: readonly CodeMailSample[] = [
  { id: "en-email", lang: "en", subject: "Your code", text: "Enter 204511 to change the email address on your account.", code: "204511" },
  { id: "en-phone", lang: "en", subject: "Your code", text: "Use code 204512 to verify your phone number.", code: "204512" },
  { id: "en-2fa-on", lang: "en", subject: "Your code", text: "Use code 204513 to set up two-factor authentication on your account.", code: "204513" },
  { id: "en-2fa-off", lang: "en", subject: "Your code", text: "Use code 204514 to turn off 2FA for your account.", code: "204514" },
  { id: "en-key", lang: "en", subject: "Your code", text: "Use code 204515 to add a security key to your account.", code: "204515" },
  { id: "en-recovery", lang: "en", subject: "Your code", text: "Code 204516: confirm the change to your recovery email.", code: "204516" },
  { id: "en-passkey", lang: "en", subject: "Your code", text: "Use code 204517 to create a passkey.", code: "204517" },
  { id: "fr-email", lang: "fr", subject: "Votre code", text: "Utilisez le code 304511 pour confirmer votre nouvelle adresse e-mail.", code: "304511" },
  { id: "fr-phone", lang: "fr", subject: "Votre code", text: "Code 304512 pour ajouter un numéro de téléphone à votre compte.", code: "304512" },
  { id: "fr-2fa", lang: "fr", subject: "Votre code", text: "Code 304513 pour désactiver l’authentification à deux facteurs.", code: "304513" },
  { id: "de-reset", lang: "de", subject: "Ihr Code", text: "Verwenden Sie den Code 404511, um Ihr Passwort zurückzusetzen.", code: "404511" },
  { id: "de-email", lang: "de", subject: "Ihr Code", text: "Mit dem Code 404512 bestätigen Sie Ihre neue E-Mail-Adresse.", code: "404512" },
  { id: "de-phone", lang: "de", subject: "Ihr Code", text: "Code 404513, um eine neue Telefonnummer hinzuzufügen.", code: "404513" },
  { id: "es-email", lang: "es", subject: "Tu código", text: "Usa el código 504511 para cambiar tu dirección de correo electrónico.", code: "504511" },
  { id: "es-2fa", lang: "es", subject: "Tu código", text: "Código 504512 para desactivar la verificación en dos pasos.", code: "504512" },
  { id: "pt-reset", lang: "pt", subject: "Seu código", text: "Use o código 604511 para redefinir sua senha.", code: "604511" },
  { id: "pt-email", lang: "pt", subject: "Seu código", text: "Código 604512 para alterar o endereço de e-mail da sua conta.", code: "604512" },
  { id: "pt-phone", lang: "pt", subject: "Seu código", text: "Código 604513 para adicionar um número de telefone.", code: "604513" },
  { id: "it-reset", lang: "it", subject: "Il tuo codice", text: "Usa il codice 704511 per reimpostare la password.", code: "704511" },
  { id: "it-email", lang: "it", subject: "Il tuo codice", text: "Codice 704512 per confermare il nuovo indirizzo email.", code: "704512" },
  { id: "it-delete", lang: "it", subject: "Il tuo codice", text: "Codice 704513 per eliminare il tuo account.", code: "704513" },
  { id: "ko-email", lang: "ko", subject: "인증 코드", text: "이메일 주소 변경을 위한 인증 코드: 804511", code: "804511" },
  { id: "ko-phone", lang: "ko", subject: "인증 코드", text: "휴대폰 번호 변경 인증 코드: 804512", code: "804512" },
  { id: "ko-2fa", lang: "ko", subject: "인증 코드", text: "2단계 인증 해제를 위한 인증 코드: 804513", code: "804513" },
  { id: "ru-reset", lang: "ru", subject: "Код подтверждения", text: "Код для сброса пароля: 904511", code: "904511" },
  { id: "ru-email", lang: "ru", subject: "Код подтверждения", text: "Код для смены адреса электронной почты: 904512", code: "904512" },
  { id: "ru-phone", lang: "ru", subject: "Код подтверждения", text: "Код для привязки номера телефона: 904513", code: "904513" },
  { id: "ru-2fa", lang: "ru", subject: "Код подтверждения", text: "Код для отключения двухфакторной аутентификации: 904514", code: "904514" },
  { id: "zh-phone", lang: "zh", subject: "验证码", text: "您正在更换手机号，验证码 114514", code: "114514" },
  { id: "zh-2fa", lang: "zh", subject: "验证码", text: "您正在关闭两步验证，验证码 114515", code: "114515" },
  { id: "zh-tw", lang: "zh-TW", subject: "驗證碼", text: "您正在變更電子郵件，驗證碼 114516", code: "114516" },
  { id: "ja-phone", lang: "ja", subject: "認証コード", text: "電話番号を変更するための認証コード：224511", code: "224511" },
  { id: "ja-2fa", lang: "ja", subject: "認証コード", text: "2段階認証を解除するための認証コード：224512", code: "224512" },
];

/** 终验复核（fable，06b）另写的 10 封新措辞高危邮件，原样搬来；当时 #130 / #134 / #137 / #138 / #139 漏判 */
export const RISKY_RECHECK: readonly CodeMailSample[] = [
  { id: "#130", lang: "en", subject: "Your verification code", text: "Your verification code is 130130. Use it to confirm the change to your sign-in email.", code: "130130" },
  { id: "#131", lang: "en", subject: "Your verification code", text: "Your verification code is 131131. Enter it to turn off 2-step verification.", code: "131131" },
  { id: "#132", lang: "en", subject: "Your verification code", text: "Your verification code is 132132. Enter it to verify your new phone number.", code: "132132" },
  { id: "#133", lang: "en", subject: "Your verification code", text: "Your verification code is 133133. Use it to add a new passkey to your account.", code: "133133" },
  { id: "#134", lang: "en", subject: "Your verification code", text: "Your verification code is 134134. Use it to approve the transfer of account ownership.", code: "134134" },
  { id: "#135", lang: "de", subject: "Ihr Code", text: "Ihr Verification code: 135135. Verwenden Sie ihn, um Ihr Passwort zurückzusetzen.", code: "135135" },
  { id: "#136", lang: "en", subject: "Your verification code", text: "Your verification code is 136136. Use it to permanently close your account.", code: "136136" },
  { id: "#137", lang: "en", subject: "Your verification code", text: "Your verification code is 137137 to change your password.", code: "137137" },
  { id: "#138", lang: "en", subject: "Your verification code", text: "Your verification code is 138138. Use this code to update your payment method.", code: "138138" },
  {
    id: "#139",
    lang: "en",
    subject: "Your verification code",
    text: "Your verification code is 139139. Use it to sign out of all other devices and reset security settings.",
    code: "139139",
  },
];

/**
 * 普通登录码邮件：必须仍判为 verification。builtin 标记的样本内置提取就能拿到验证码；
 * 其余语言的验证码关键词不在内置词表里（只覆盖中英日），靠 temp_email 的 ai_extract。
 * 有几封故意带上会出现在登录邮件页脚里的安全提示，锁住"页脚不触发高危"。
 */
export const LOGIN_SAMPLES: ReadonlyArray<CodeMailSample & { builtin: boolean }> = [
  { id: "#117", lang: "en", subject: "Your login code", text: "Your login code is 117117. It expires in 10 minutes.", code: "117117", builtin: true },
  { id: "en-chatgpt", lang: "en", subject: "Your ChatGPT code is 382915", text: "Enter this temporary verification code to continue: 382915", code: "382915", builtin: true },
  { id: "en-footer", lang: "en", subject: "Your sign-in code", text: "Code 482913. If this wasn't you, change your password and review your account activity.", code: "482913", builtin: true },
  { id: "en-2fa-code", lang: "en", subject: "Your two-factor authentication code", text: "Your two-factor authentication code is 593104. Never share your login credentials with anyone.", code: "593104", builtin: true },
  { id: "en-steam", lang: "en", subject: "Your Steam account: Access from new computer", text: "Here is the Steam Guard code you need to login to account examplebuyer: F7K2P", code: "F7K2P", builtin: false },
  { id: "en-verify", lang: "en", subject: "Verify your email", text: "Your verification code is 640218. Enter it to finish signing in.", code: "640218", builtin: true },
  { id: "zh-login", lang: "zh", subject: "登录验证码", text: "您的验证码是 704512，10 分钟内有效。如非本人操作，请及时修改密码。", code: "704512", builtin: true },
  { id: "zh-tw-login", lang: "zh-TW", subject: "登入驗證碼", text: "您的驗證碼為 715320。", code: "715320", builtin: true },
  { id: "ja-login", lang: "ja", subject: "認証コード", text: "認証コード：538204。心当たりがない場合はパスワードを変更してください。", code: "538204", builtin: true },
  { id: "fr-login", lang: "fr", subject: "Votre code de connexion", text: "Votre code de vérification est 381920. Si ce n'était pas vous, modifiez votre mot de passe.", code: "381920", builtin: false },
  { id: "fr-login-2", lang: "fr", subject: "Code de vérification", text: "Saisissez 381921 pour vous connecter. Ce code expire dans 10 minutes.", code: "381921", builtin: false },
  { id: "de-login", lang: "de", subject: "Ihr Anmeldecode", text: "Ihr Bestätigungscode lautet 482019. Wenn Sie das nicht waren, ändern Sie Ihr Passwort.", code: "482019", builtin: false },
  { id: "de-login-2", lang: "de", subject: "Bestätigungscode", text: "Geben Sie 482020 ein, um sich anzumelden.", code: "482020", builtin: false },
  { id: "es-login", lang: "es", subject: "Tu código de inicio de sesión", text: "Tu código de verificación es 573910. Si no fuiste tú, cambia tu contraseña.", code: "573910", builtin: false },
  { id: "es-login-2", lang: "es", subject: "Código de verificación", text: "Introduce 573911 para iniciar sesión.", code: "573911", builtin: false },
  { id: "pt-login", lang: "pt", subject: "Seu código de login", text: "Seu código de verificação é 664802. Se não foi você, altere sua senha.", code: "664802", builtin: false },
  { id: "pt-login-2", lang: "pt", subject: "A sua palavra-passe de uso único", text: "Utilize 664803 para iniciar sessão.", code: "664803", builtin: false },
  { id: "it-login", lang: "it", subject: "Il tuo codice di accesso", text: "Il tuo codice di verifica è 750193. Se non sei stato tu, cambia la password.", code: "750193", builtin: false },
  { id: "it-login-2", lang: "it", subject: "Codice di verifica", text: "Inserisci 750194 per accedere.", code: "750194", builtin: false },
  { id: "ko-login", lang: "ko", subject: "로그인 인증 코드", text: "인증 코드: 846201. 본인이 아닌 경우 비밀번호를 변경하세요.", code: "846201", builtin: false },
  { id: "ko-login-2", lang: "ko", subject: "2단계 인증 코드", text: "2단계 인증 코드는 846202 입니다.", code: "846202", builtin: false },
  { id: "ru-login", lang: "ru", subject: "Код для входа", text: "Ваш код подтверждения: 937104. Если это были не вы, смените пароль.", code: "937104", builtin: false },
  { id: "ru-login-2", lang: "ru", subject: "Одноразовый пароль", text: "Ваш одноразовый пароль для входа: 937105", code: "937105", builtin: false },
];

/** 终验复核（06b）的 4 封登录码，原样搬来；当时 #140（页脚提到 reset your password）被误藏 */
export const LOGIN_RECHECK: ReadonlyArray<CodeMailSample & { builtin: boolean }> = [
  {
    id: "#140",
    lang: "en",
    subject: "Your verification code",
    text: "Your verification code is 140140. Use it to sign in. If you didn't request this, you can reset your password.",
    code: "140140",
    builtin: true,
  },
  { id: "#141", lang: "en", subject: "Your ChatGPT code is 141141", text: "Your ChatGPT code is 141141. This code expires in 10 minutes.", code: "141141", builtin: true },
  {
    id: "#142",
    lang: "en",
    subject: "Your login code",
    text: "Enter this login code: 142142. Never share this code. Didn't request this? Secure your account by changing your password.",
    code: "142142",
    builtin: true,
  },
  {
    id: "#143",
    lang: "en",
    subject: "Your verification code",
    text: "Your verification code is 143143. For your security we recommend enabling two-factor authentication.",
    code: "143143",
    builtin: true,
  },
];

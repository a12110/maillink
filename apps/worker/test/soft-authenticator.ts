import { isoBase64URL, isoCBOR } from "@simplewebauthn/server/helpers";
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from "@simplewebauthn/server";

// 测试用软件认证器：WebCrypto ES256 密钥 + 手工拼装的 authenticatorData / attestationObject。
// 生成的是真实可验证的注册与断言数据，服务端用 @simplewebauthn/server 原样校验（不 mock 校验函数）。

const FLAG_UP = 0x01;
const FLAG_UV = 0x04;
const FLAG_AT = 0x40;
const COSE_KTY_EC2 = 2;
const COSE_ALG_ES256 = -7;
const COSE_CRV_P256 = 1;
const COORD_BYTES = 32;

function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function uint32(value: number): Uint8Array {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, value);
  return out;
}

function uint16(value: number): Uint8Array {
  const out = new Uint8Array(2);
  new DataView(out.buffer).setUint16(0, value);
  return out;
}

async function sha256(data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(data)));
}

/** WebCrypto 的 ECDSA 签名是 r||s，WebAuthn 要求 ASN.1 DER */
function derInteger(raw: Uint8Array): Uint8Array {
  let start = 0;
  while (start < raw.length - 1 && raw[start] === 0) start += 1;
  let body = raw.slice(start);
  if ((body[0] ?? 0) & 0x80) body = concat(new Uint8Array([0]), body);
  return concat(new Uint8Array([0x02, body.length]), body);
}

function rawToDer(raw: Uint8Array): Uint8Array<ArrayBuffer> {
  const r = derInteger(raw.slice(0, COORD_BYTES));
  const s = derInteger(raw.slice(COORD_BYTES));
  return concat(new Uint8Array([0x30, r.length + s.length]), r, s);
}

export type AssertionOverrides = { counter?: number; origin?: string; userVerified?: boolean; userHandle?: string | null; challenge?: string };

export class SoftAuthenticator {
  counter = 0;
  userHandle: string | undefined;

  private constructor(
    readonly credentialId: Uint8Array<ArrayBuffer>,
    private readonly keys: CryptoKeyPair,
  ) {}

  static async create(): Promise<SoftAuthenticator> {
    const keys = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
    return new SoftAuthenticator(crypto.getRandomValues(new Uint8Array(16)), keys);
  }

  get id(): string {
    return isoBase64URL.fromBuffer(this.credentialId);
  }

  private async coseKey(): Promise<Uint8Array> {
    const raw = new Uint8Array((await crypto.subtle.exportKey("raw", this.keys.publicKey)) as ArrayBuffer);
    const cose = new Map<number, number | Uint8Array>([
      [1, COSE_KTY_EC2],
      [3, COSE_ALG_ES256],
      [-1, COSE_CRV_P256],
      [-2, raw.slice(1, 1 + COORD_BYTES)],
      [-3, raw.slice(1 + COORD_BYTES)],
    ]);
    return isoCBOR.encode(cose);
  }

  async register(
    options: { challenge: string; rp: { id?: string }; user: { id: string } },
    origin: string,
    flags = FLAG_UP | FLAG_UV | FLAG_AT,
  ): Promise<RegistrationResponseJSON> {
    this.userHandle = options.user.id;
    const rpIdHash = await sha256(new TextEncoder().encode(options.rp.id ?? ""));
    const attested = concat(new Uint8Array(16), uint16(this.credentialId.length), this.credentialId, await this.coseKey());
    const authData = concat(rpIdHash, new Uint8Array([flags]), uint32(this.counter), attested);
    const attestationObject = isoCBOR.encode(
      new Map<string, string | Uint8Array | Map<string, string>>([
        ["fmt", "none"],
        ["attStmt", new Map<string, string>()],
        ["authData", authData],
      ]),
    );
    const clientData = { type: "webauthn.create", challenge: options.challenge, origin, crossOrigin: false };
    return {
      id: this.id,
      rawId: this.id,
      type: "public-key",
      response: {
        clientDataJSON: isoBase64URL.fromUTF8String(JSON.stringify(clientData)),
        attestationObject: isoBase64URL.fromBuffer(attestationObject),
        transports: ["internal"],
      },
      clientExtensionResults: {},
    };
  }

  async assert(
    options: { challenge: string; rpId?: string },
    origin: string,
    overrides: AssertionOverrides = {},
  ): Promise<AuthenticationResponseJSON> {
    if (overrides.counter !== undefined) this.counter = overrides.counter;
    const flags = overrides.userVerified === false ? FLAG_UP : FLAG_UP | FLAG_UV;
    const rpIdHash = await sha256(new TextEncoder().encode(options.rpId ?? ""));
    const authData = concat(rpIdHash, new Uint8Array([flags]), uint32(this.counter));
    const clientData = { type: "webauthn.get", challenge: overrides.challenge ?? options.challenge, origin: overrides.origin ?? origin, crossOrigin: false };
    const clientDataBytes = new TextEncoder().encode(JSON.stringify(clientData));
    const signed = concat(authData, await sha256(clientDataBytes));
    const raw = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, this.keys.privateKey, signed));
    const userHandle = overrides.userHandle === null ? undefined : (overrides.userHandle ?? this.userHandle);
    return {
      id: this.id,
      rawId: this.id,
      type: "public-key",
      response: {
        clientDataJSON: isoBase64URL.fromBuffer(new Uint8Array(clientDataBytes)),
        authenticatorData: isoBase64URL.fromBuffer(authData),
        signature: isoBase64URL.fromBuffer(rawToDer(raw)),
        ...(userHandle === undefined ? {} : { userHandle }),
      },
      clientExtensionResults: {},
    };
  }
}

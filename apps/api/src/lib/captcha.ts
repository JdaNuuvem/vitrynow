// NG-08 (B19): captcha do pedido público, atrás de uma INTERFACE PLUGÁVEL. Hoje só existem o modo `off` (padrão: nada muda) e o `fake` (dev/teste: nenhuma chamada
// externa e nenhuma chave real). Um provedor de verdade (hCaptcha, Turnstile...) entra depois como outra implementação de `CaptchaVerifier` e uma linha em `captchaVerifier()`.
// O captcha só é cobrado quando há RISCO (ver `CAPTCHA_AT_PENDING` na rota): cliente normal nunca vê.

export const CAPTCHA_HEADER = "x-captcha-token";
/** Token que o provedor FAKE aceita (dev/teste). Qualquer outro valor é recusado. */
export const FAKE_CAPTCHA_OK = "fake-captcha-ok";

export type CaptchaMode = "off" | "fake";

export interface CaptchaVerifier {
  readonly mode: CaptchaMode;
  /** `true` só se o token for válido para esta origem. Nunca lança por token ruim; erro do provedor vira `false` (fail-closed). */
  verify(token: string | undefined, clientKey: string): Promise<boolean>;
}

class OffCaptcha implements CaptchaVerifier {
  readonly mode = "off" as const;
  async verify(): Promise<boolean> {
    return true; // desligado: nunca cobra (a rota nem chama quando o modo é `off`)
  }
}

class FakeCaptcha implements CaptchaVerifier {
  readonly mode = "fake" as const;
  async verify(token: string | undefined): Promise<boolean> {
    return token === FAKE_CAPTCHA_OK;
  }
}

const devLike = (env: NodeJS.ProcessEnv) => env.NODE_ENV === "development" || env.NODE_ENV === "test";

/** Modo efetivo. `fake` só em dev/teste explícitos (NODE_ENV ausente conta como produção); valor desconhecido derruba o boot em vez de virar `off` em silêncio. */
export function captchaMode(env: NodeJS.ProcessEnv = process.env): CaptchaMode {
  const raw = env.CAPTCHA_MODE?.trim();
  if (!raw || raw === "off") return "off";
  if (raw === "fake") {
    if (!devLike(env)) throw new Error("CAPTCHA_MODE=fake só roda em dev/teste (NODE_ENV=development ou test, explícito): em produção use `off` ou um provedor real.");
    return "fake";
  }
  throw new Error(`CAPTCHA_MODE inválido: "${raw}" (use off ou, só em dev/teste, fake; provedor real ainda não implementado).`);
}

let override: CaptchaVerifier | undefined;
/** Só para testes: injeta um verificador (por exemplo, um que falha). */
export function setCaptchaVerifier(verifier?: CaptchaVerifier) {
  override = verifier;
}

export function captchaVerifier(env: NodeJS.ProcessEnv = process.env): CaptchaVerifier {
  if (override) return override;
  return captchaMode(env) === "fake" ? new FakeCaptcha() : new OffCaptcha();
}

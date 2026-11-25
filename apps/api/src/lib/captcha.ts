// NG-08 (B19): captcha do pedido público, atrás de uma INTERFACE PLUGÁVEL. Modos:
//   `off`       (padrão) nada muda;
//   `fake`      só dev/teste: nenhuma chamada externa e nenhuma chave real;
//   `turnstile` Cloudflare Turnstile (produção): exige TURNSTILE_SECRET_KEY; o site precisa de NEXT_PUBLIC_TURNSTILE_SITE_KEY.
// O captcha só é cobrado quando há RISCO (ver `CAPTCHA_AT_PENDING` na rota): cliente normal nunca vê.

export const CAPTCHA_HEADER = "x-captcha-token";
/** Token que o provedor FAKE aceita (dev/teste). Qualquer outro valor é recusado. */
export const FAKE_CAPTCHA_OK = "fake-captcha-ok";
export const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const TURNSTILE_TIMEOUT_MS = 5_000;

export type CaptchaMode = "off" | "fake" | "turnstile";

export interface CaptchaVerifier {
  readonly mode: CaptchaMode;
  /** `true` só se o token for válido para esta origem. Nunca lança por token ruim; erro do provedor vira `false` (fail-closed). */
  verify(token: string | undefined, clientKey: string, remoteIp?: string): Promise<boolean>;
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

/** Cloudflare Turnstile. O token é de uso único e vale 5 min (o próprio provedor recusa reuso). */
export class TurnstileCaptcha implements CaptchaVerifier {
  readonly mode = "turnstile" as const;
  constructor(
    private readonly secret: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly timeoutMs = TURNSTILE_TIMEOUT_MS,
  ) {}

  async verify(token: string | undefined, _clientKey: string, remoteIp?: string): Promise<boolean> {
    if (!token) return false;
    const body = new URLSearchParams({ secret: this.secret, response: token });
    if (remoteIp) body.set("remoteip", remoteIp);
    try {
      const response = await this.fetchImpl(TURNSTILE_VERIFY_URL, {
        method: "POST",
        body,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!response.ok) return false;
      const json = (await response.json()) as { success?: unknown };
      return json.success === true;
    } catch {
      return false; // provedor fora do ar ou lento: recusa (fail-closed); nunca registra o token nem a chave
    }
  }
}

const devLike = (env: NodeJS.ProcessEnv) => env.NODE_ENV === "development" || env.NODE_ENV === "test";

/** Modo efetivo. `fake` só em dev/teste explícitos (NODE_ENV ausente conta como produção); valor desconhecido ou sem chave derruba o boot em vez de virar `off` em silêncio. */
export function captchaMode(env: NodeJS.ProcessEnv = process.env): CaptchaMode {
  const raw = env.CAPTCHA_MODE?.trim();
  if (!raw || raw === "off") return "off";
  if (raw === "fake") {
    if (!devLike(env)) throw new Error("CAPTCHA_MODE=fake só roda em dev/teste (NODE_ENV=development ou test, explícito): em produção use `off` ou `turnstile`.");
    return "fake";
  }
  if (raw === "turnstile") {
    if (!env.TURNSTILE_SECRET_KEY?.trim()) throw new Error("CAPTCHA_MODE=turnstile exige TURNSTILE_SECRET_KEY (chave secreta do widget no painel da Cloudflare).");
    return "turnstile";
  }
  throw new Error(`CAPTCHA_MODE inválido: "${raw}" (use off, turnstile ou, só em dev/teste, fake).`);
}

let override: CaptchaVerifier | undefined;
/** Só para testes: injeta um verificador (por exemplo, um que falha). */
export function setCaptchaVerifier(verifier?: CaptchaVerifier) {
  override = verifier;
}

export function captchaVerifier(env: NodeJS.ProcessEnv = process.env): CaptchaVerifier {
  if (override) return override;
  const mode = captchaMode(env);
  if (mode === "fake") return new FakeCaptcha();
  if (mode === "turnstile") return new TurnstileCaptcha(env.TURNSTILE_SECRET_KEY!.trim());
  return new OffCaptcha();
}

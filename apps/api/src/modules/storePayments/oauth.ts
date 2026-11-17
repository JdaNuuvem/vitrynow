// Porta do OAuth do Mercado Pago (ADR-0001 §3.2). Em desenvolvimento e teste vale o FAKE; o real só liga com credencial
// (CL-13, ainda pendente) e NUNCA foi exercitado contra o provedor: os endpoints abaixo seguem a documentação oficial
// citada no ADR e ficam marcados como NÃO VERIFICADOS até o sandbox.

export type OAuthTokens = {
  accessToken: string;
  refreshToken: string;
  /** Fim do access_token. */
  expiresAt: Date;
  /** Id do vendedor no provedor. */
  sellerUserId: string;
};

export class OAuthError extends Error {
  constructor(
    message: string,
    /** `revoked`: o provedor recusou o refresh_token (vínculo desfeito) ⇒ a conta pede reconexão. */
    readonly kind: "invalid_code" | "revoked" | "unavailable",
  ) {
    super(message);
    this.name = "OAuthError";
  }
}

export interface MercadoPagoOAuth {
  readonly mode: "fake" | "real";
  /** URL para onde o navegador do dono é levado (o `redirectUri` é fixo por configuração, nunca vem do cliente). */
  authorizationUrl(input: { state: string; redirectUri: string }): string;
  exchangeCode(input: { code: string; redirectUri: string }): Promise<OAuthTokens>;
  /** O refresh_token é ROTATIVO: o par novo precisa ser gravado antes de ser usado. */
  refresh(refreshToken: string): Promise<OAuthTokens>;
}

// ───────────── Fake (dev e testes) ─────────────
// O "provedor" é a própria API: a URL de autorização já devolve o navegador ao callback com `code=fake:<vendedor>`.
// Códigos: `fake:<id>` conecta o vendedor <id>; `fake-invalid` é recusado; tokens `fake-access-<id>-<n>`.

const DAY = 24 * 60 * 60 * 1000;

export class FakeMercadoPagoOAuth implements MercadoPagoOAuth {
  readonly mode = "fake" as const;
  /** Tokens de renovação que o "provedor" passa a recusar (simula revogação). */
  readonly revoked = new Set<string>();
  /** Liga/desliga para simular o provedor fora do ar. */
  unavailable = false;
  private counter = 0;

  constructor(private readonly now: () => Date = () => new Date()) {}

  authorizationUrl({ state, redirectUri }: { state: string; redirectUri: string }) {
    return `${redirectUri}?code=${encodeURIComponent("fake:vendedor-1")}&state=${encodeURIComponent(state)}`;
  }

  private issue(sellerUserId: string): OAuthTokens {
    this.counter += 1;
    return {
      accessToken: `fake-access-${sellerUserId}-${this.counter}`,
      refreshToken: `fake-refresh-${sellerUserId}-${this.counter}`,
      expiresAt: new Date(this.now().getTime() + 180 * DAY), // 180 dias (ADR-0001 §2)
      sellerUserId,
    };
  }

  async exchangeCode({ code }: { code: string; redirectUri: string }) {
    if (this.unavailable) throw new OAuthError("provedor indisponível", "unavailable");
    const match = /^fake:([A-Za-z0-9_-]{1,40})$/.exec(code);
    if (!match) throw new OAuthError("código inválido", "invalid_code");
    return this.issue(match[1]);
  }

  async refresh(refreshToken: string) {
    if (this.unavailable) throw new OAuthError("provedor indisponível", "unavailable");
    const match = /^fake-refresh-([A-Za-z0-9_-]+)-\d+$/.exec(refreshToken);
    if (!match || this.revoked.has(refreshToken)) throw new OAuthError("vínculo revogado", "revoked");
    this.revoked.add(refreshToken); // rotativo: o antigo deixa de valer assim que o novo é emitido
    return this.issue(match[1]);
  }
}

// ───────────── Real (NÃO VERIFICADO — depende do sandbox, CL-13) ─────────────

export class RealMercadoPagoOAuth implements MercadoPagoOAuth {
  readonly mode = "real" as const;

  constructor(
    private readonly config: { clientId: string; clientSecret: string },
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  authorizationUrl({ state, redirectUri }: { state: string; redirectUri: string }) {
    const url = new URL("https://auth.mercadopago.com.br/authorization");
    url.searchParams.set("client_id", this.config.clientId);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("platform_id", "mp");
    url.searchParams.set("state", state);
    url.searchParams.set("redirect_uri", redirectUri);
    return url.toString();
  }

  private async token(body: Record<string, string>): Promise<OAuthTokens> {
    let response: Response;
    try {
      response = await this.fetchImpl("https://api.mercadopago.com/oauth/token", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ client_id: this.config.clientId, client_secret: this.config.clientSecret, ...body }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      // Nunca repassa o erro bruto do cliente HTTP: ele pode carregar cabeçalhos e o corpo (segredos) (D1-5).
      throw new OAuthError("provedor indisponível", "unavailable");
    }
    if (response.status === 400 || response.status === 401) {
      throw new OAuthError("código ou vínculo recusado pelo provedor", body.grant_type === "refresh_token" ? "revoked" : "invalid_code");
    }
    if (!response.ok) throw new OAuthError("provedor indisponível", "unavailable");
    const json = (await response.json()) as { access_token?: string; refresh_token?: string; expires_in?: number; user_id?: number | string };
    if (!json.access_token || !json.refresh_token || json.user_id === undefined) throw new OAuthError("resposta inesperada do provedor", "unavailable");
    return {
      accessToken: json.access_token,
      refreshToken: json.refresh_token,
      expiresAt: new Date(Date.now() + (json.expires_in ?? 180 * 24 * 3600) * 1000),
      sellerUserId: String(json.user_id),
    };
  }

  exchangeCode({ code, redirectUri }: { code: string; redirectUri: string }) {
    return this.token({ grant_type: "authorization_code", code, redirect_uri: redirectUri });
  }

  refresh(refreshToken: string) {
    return this.token({ grant_type: "refresh_token", refresh_token: refreshToken });
  }
}

// ───────────── Seleção por ambiente ─────────────

let override: MercadoPagoOAuth | undefined;
/** Só para testes: injeta o provedor (por exemplo, um `FakeMercadoPagoOAuth` com falhas simuladas). */
export function setOAuthProvider(provider?: MercadoPagoOAuth) {
  override = provider;
}

let sharedFake: FakeMercadoPagoOAuth | undefined;

/** `MP_OAUTH_MODE=real` exige MP_CLIENT_ID e MP_CLIENT_SECRET; o padrão é fake — e o fake NUNCA sobe em produção. */
export function oauthProvider(env: NodeJS.ProcessEnv = process.env): MercadoPagoOAuth {
  if (override) return override;
  if (env.MP_OAUTH_MODE === "real") {
    if (!env.MP_CLIENT_ID || !env.MP_CLIENT_SECRET) throw new Error("MP_OAUTH_MODE=real exige MP_CLIENT_ID e MP_CLIENT_SECRET (credenciais pendentes: CL-13).");
    return new RealMercadoPagoOAuth({ clientId: env.MP_CLIENT_ID, clientSecret: env.MP_CLIENT_SECRET });
  }
  if (env.NODE_ENV === "production") {
    throw new Error("O provedor FAKE de OAuth não pode rodar em produção: configure MP_OAUTH_MODE=real com as credenciais do aplicativo.");
  }
  return (sharedFake ??= new FakeMercadoPagoOAuth());
}

// API-26: provedor de e-mail do cadastro. Hoje SÓ existe o falso: nada sai pela rede (brief: e-mail real é ação do Claudio).
// O Resend de produção entra depois como outra implementação desta interface, sem mexer nas rotas.
export type OutgoingEmail = { to: string; subject: string; html: string; link?: string };

export interface EmailSender {
  // `true` = aceito para entrega; `false` = NÃO saiu (o chamador devolve a tentativa ao usuário).
  send(email: OutgoingEmail): Promise<boolean>;
}

// Guarda as mensagens na memória (caixa de saída de teste). Nunca fala com a rede.
export class FakeEmailSender implements EmailSender {
  readonly outbox: OutgoingEmail[] = [];
  async send(email: OutgoingEmail): Promise<boolean> {
    this.outbox.push(email);
    if (this.outbox.length > 200) this.outbox.shift();
    return true;
  }
  last(to: string): OutgoingEmail | undefined {
    return [...this.outbox].reverse().find((m) => m.to === to);
  }
}

// Sem provedor configurado fora de dev/teste: não envia e não registra o conteúdo (o link vale como senha da conta).
class UnconfiguredEmailSender implements EmailSender {
  async send(): Promise<boolean> {
    console.error("[email] nenhum provedor de e-mail configurado: e-mail de verificação NÃO enviado.");
    return false;
  }
}

function defaultSender(): EmailSender {
  const env = process.env.NODE_ENV;
  const dev = env === "development" || env === "test" || process.env.EMAIL_LOG_LINKS === "true";
  return dev ? new FakeEmailSender() : new UnconfiguredEmailSender();
}

let current: EmailSender = defaultSender();
export const getEmailSender = (): EmailSender => current;
export function setEmailSender(sender: EmailSender): void {
  current = sender;
}

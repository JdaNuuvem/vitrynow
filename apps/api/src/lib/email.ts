import { Resend } from "resend";

// Sem RESEND_API_KEY configurado, cai no modo dev: loga o link no console em vez de
// mandar e-mail de verdade. Isso é intencional (não quer gastar quota do Resend em dev
// nem exigir chave pra rodar o projeto localmente).
function client() {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return null;
  return new Resend(apiKey);
}

// LGPD (ST-62): nos logs de ERRO o destinatário vai mascarado (primeira letra + domínio); o endereço inteiro só no modo de
// desenvolvimento, que o desenvolvedor precisa ver.
export function maskEmail(address: string): string {
  const at = address.lastIndexOf("@");
  if (at < 1) return "***";
  return `${address.slice(0, 1)}***${address.slice(at)}`;
}

// Só em desenvolvimento/teste o "modo sem chave" pode escrever no log o que seria o conteúdo do e-mail (link de recuperação,
// código de confirmação): fora disso esse log iria para `docker logs` e para o coletor de logs, e quem lê o log tomaria a
// conta. NODE_ENV ausente conta como produção (mesma regra da SEC-22). `EMAIL_LOG_LINKS=true` é o aceite explícito para
// quem roda local sem NODE_ENV; nunca vai para o compose.
function mayLogEmailSecrets(): boolean {
  const env = process.env.NODE_ENV;
  return env === "development" || env === "test" || process.env.EMAIL_LOG_LINKS === "true";
}

const FROM = process.env.EMAIL_FROM ?? "MeuCardapio <onboarding@resend.dev>";

// SEC-28b (ST-66): quem pede duas vezes (o 1º e-mail demorou, a caixa de spam) recebe dois e-mails e o primeiro link morre quando o segundo é
// emitido; o texto diz isso para a pessoa não clicar no link velho e achar que o sistema quebrou.
export function passwordResetEmailHtml(resetUrl: string): string {
  return `
      <p>Você pediu para redefinir sua senha.</p>
      <p><a href="${resetUrl}">Clique aqui para criar uma nova senha</a> (válido por 1 hora).</p>
      <p>Se você pediu mais de uma vez, use apenas o e-mail mais recente: os links anteriores deixam de valer.</p>
      <p>Se não foi você, pode ignorar este e-mail.</p>
    `;
}

// Devolve `true` quando o e-mail foi aceito pelo provedor (ou, só em desenvolvimento, quando o link foi para o console) e `false` quando NÃO
// saiu (sem chave fora de dev, ou erro do provedor). O chamador usa isso para devolver a tentativa ao usuário (SEC-28b, ST-65).
export async function sendPasswordResetEmail(input: { to: string; resetUrl: string }): Promise<boolean> {
  const resend = client();
  if (!resend) {
    if (mayLogEmailSecrets()) {
      console.warn(`[email] RESEND_API_KEY não configurado — link de recuperação para ${input.to}: ${input.resetUrl}`);
      return true;
    }
    console.error("[email] RESEND_API_KEY não configurado: o e-mail de recuperação de senha NÃO foi enviado (o link não é registrado no log).");
    return false;
  }

  const { error } = await resend.emails.send({
    from: FROM,
    to: input.to,
    subject: "Recuperação de senha — MeuCardapio",
    html: passwordResetEmailHtml(input.resetUrl),
  });

  if (error) {
    // Não derruba o fluxo de forgot-password por isso — a resposta já é genérica
    // (nunca revela se o e-mail existe), só registramos a falha de envio.
    console.error(`[email] falha ao enviar recuperação de senha para ${maskEmail(input.to)}:`, error);
    return false;
  }
  return true;
}

export async function sendMfaCodeEmail(input: { to: string; code: string; purposeLabel: string }) {
  const resend = client();
  if (!resend) {
    if (mayLogEmailSecrets()) console.warn(`[email] RESEND_API_KEY não configurado — código de confirmação (${input.purposeLabel}) para ${input.to}: ${input.code}`);
    else console.error("[email] RESEND_API_KEY não configurado: o código de confirmação NÃO foi enviado (o código não é registrado no log).");
    return;
  }

  const { error } = await resend.emails.send({
    from: FROM,
    to: input.to,
    subject: "Código de confirmação — MeuCardapio",
    html: `
      <p>Seu código para confirmar a ação <b>${input.purposeLabel}</b>:</p>
      <p style="font-size:24px;letter-spacing:4px"><b>${input.code}</b></p>
      <p>Ele vale por 10 minutos. Se não foi você, ignore este e-mail.</p>
    `,
  });
  if (error) console.error(`[email] falha ao enviar código de confirmação para ${maskEmail(input.to)}:`, error);
}

// SEC-20 / ST-33: aviso ao dono quando a conta recebe muitas tentativas de senha errada (de vários IPs).
// Texto genérico: não traz IP, horário exato nem qualquer dado que ajude um atacante.
export async function sendLoginAlertEmail(input: { to: string }) {
  const resend = client();
  if (!resend) {
    console.warn(`[email] RESEND_API_KEY não configurado — aviso de tentativas de login para ${mayLogEmailSecrets() ? input.to : maskEmail(input.to)}`);
    return;
  }
  const { error } = await resend.emails.send({
    from: FROM,
    to: input.to,
    subject: "Tentativas de entrada na sua conta — MeuCardapio",
    html: `
      <p>Detectamos várias tentativas de entrada na sua conta com senha incorreta.</p>
      <p>Se foi você, pode ignorar. Se não foi, use "Esqueci a senha" para trocar a sua senha agora e,
      depois de entrar, escolha "Sair de todos os dispositivos".</p>
    `,
  });
  if (error) console.error(`[email] falha ao enviar aviso de tentativas de login para ${maskEmail(input.to)}:`, error);
}

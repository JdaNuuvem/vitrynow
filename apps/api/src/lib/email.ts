import { Resend } from "resend";

// Sem RESEND_API_KEY configurado, cai no modo dev: loga o link no console em vez de
// mandar e-mail de verdade. Isso é intencional (não quer gastar quota do Resend em dev
// nem exigir chave pra rodar o projeto localmente).
function client() {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return null;
  return new Resend(apiKey);
}

const FROM = process.env.EMAIL_FROM ?? "MeuCardapio <onboarding@resend.dev>";

export async function sendPasswordResetEmail(input: { to: string; resetUrl: string }) {
  const resend = client();
  if (!resend) {
    console.warn(`[email] RESEND_API_KEY não configurado — link de recuperação para ${input.to}: ${input.resetUrl}`);
    return;
  }

  const { error } = await resend.emails.send({
    from: FROM,
    to: input.to,
    subject: "Recuperação de senha — MeuCardapio",
    html: `
      <p>Você pediu para redefinir sua senha.</p>
      <p><a href="${input.resetUrl}">Clique aqui para criar uma nova senha</a> (válido por 1 hora).</p>
      <p>Se não foi você, pode ignorar este e-mail.</p>
    `,
  });

  if (error) {
    // Não derruba o fluxo de forgot-password por isso — a resposta já é genérica
    // (nunca revela se o e-mail existe), só registramos a falha de envio.
    console.error(`[email] falha ao enviar recuperação de senha para ${input.to}:`, error);
  }
}

export async function sendMfaCodeEmail(input: { to: string; code: string; purposeLabel: string }) {
  const resend = client();
  if (!resend) {
    console.warn(`[email] RESEND_API_KEY não configurado — código de confirmação (${input.purposeLabel}) para ${input.to}: ${input.code}`);
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
  if (error) console.error(`[email] falha ao enviar código de confirmação para ${input.to}:`, error);
}

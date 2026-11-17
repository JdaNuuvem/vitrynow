// SEC-29 / ST-63 (spec 16 da Da Vinci): senha mínima de 10 caracteres, SEM exigir composição (decisão do Atlas).
// O servidor é a fonte da regra; a tela só antecipa. O número mora AQUI, num lugar só, e as frases saem dele.
// (Quando a Nightingale exportar a constante em shared-types, este arquivo passa a importá-la.)
// Contas existentes não são forçadas: o LOGIN não tem regra de tamanho.
export const PASSWORD_MIN_LENGTH = 10;

export const PASSWORD_TOO_SHORT_MESSAGE = `A senha precisa ter pelo menos ${PASSWORD_MIN_LENGTH} caracteres.`;
// Textos aprovados pelo Ogilvy (17/11).
export const PASSWORD_HELP = `Pelo menos ${PASSWORD_MIN_LENGTH} caracteres. Dica: junte três palavras sem relação entre si.`;
// Nome do card de troca de senha na conta. UMA constante: o título do card e a frase do convite leem daqui e não divergem (Ogilvy).
export const CHANGE_PASSWORD_CARD_TITLE = "Minha senha";

// Convite de equipe: quem digita não é quem vai usar a senha, e o funcionário troca a própria senha depois nesse card (Leonardo).
export const PASSWORD_HELP_STAFF = `Pelo menos ${PASSWORD_MIN_LENGTH} caracteres. Combine com o funcionário como ele vai receber a senha. Ele pode trocá-la depois em ${CHANGE_PASSWORD_CARD_TITLE}.`;

// Mesmo critério do servidor (Zod .min conta unidades de texto, como `length`).
export const isPasswordLongEnough = (password: string) => password.length >= PASSWORD_MIN_LENGTH;

// Recusa do servidor por causa do TAMANHO (ex.: "newPassword: String must contain at least 10 character(s)"). Só estas viram a frase
// do campo; "Senha atual incorreta" e outros erros continuam como vieram. Nunca mostra código nem texto técnico da validação.
const RULE_ERROR = /(newPassword|password).*(at least|least \d+|\bmin\b|short|character)|pelo menos \d+ caracteres|ao menos \d+ caracteres|senha.*(curta|caracteres)/i;
export const isPasswordRuleError = (message: string | null | undefined): boolean => Boolean(message && RULE_ERROR.test(message));

// ---- Confirmação do e-mail na redefinição (SEC-29 parte 2, ST-67; spec 16 §6, textos aprovados pelo Ogilvy) ----
export const CONFIRM_EMAIL_LABEL = "Confirme o e-mail desta conta";
export const CONFIRM_EMAIL_HELP = "Digite o e-mail completo da conta, como você o usa para entrar.";
// UMA frase para "e-mail não bate" e "link inválido no envio": nunca diz qual dos dois falhou (senão o e-mail certo sairia por tentativa e erro).
export const RESET_REFUSED_MESSAGE = "Não foi possível redefinir a senha. Confira o e-mail e o link e tente de novo.";
export const RESET_REFUSED_NEW_LINK = "Pedir um novo link";
export const RESET_RATE_LIMITED_MESSAGE = "Muitas tentativas. Aguarde alguns minutos e tente de novo.";

// Só confere a FORMA para liberar o botão; quem decide se o e-mail é o da conta é o servidor.
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const isEmailShapeValid = (email: string) => EMAIL_SHAPE.test(email.trim());

export type ResetFailure = "rule" | "rate" | "server" | "refused";
/** Como a tela trata a recusa do servidor no envio (a 1ª regra que casar vale). */
export function classifyResetFailure(status: number | null, error: string | null): ResetFailure | null {
  if (!error) return null;
  if (isPasswordRuleError(error)) return "rule"; // tamanho da senha: a frase do campo
  if (status === 429) return "rate";
  if (status !== null && status >= 500) return "server"; // rede ou erro do servidor: o texto da API/rede, sem acusar e-mail nem link
  return "refused"; // qualquer outra recusa (e-mail que não bate, link vencido/usado): a MESMA frase, sempre
}

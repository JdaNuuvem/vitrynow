// ST-56 / NG-17: o link de redefinição de senha passa a ser /reset-senha#token=<token>. O fragmento (#...) nunca é enviado
// ao servidor: fica fora do log de acesso, do log de erro do proxy e do cabeçalho Referer. O token vive só em memória e a
// barra de endereço é limpa na hora, para não ficar no histórico, em captura de tela nem em "copiar link".

// E-mails já enviados trazem /reset-senha?token=<token> (query). Aceitos só na transição, com FIM marcado em código (ST-60:
// sem data, a transição de 1 h viraria permanente se ninguém tirasse). O token do e-mail vale 1 h, então depois desta data
// não há mais e-mail antigo utilizável. Passada a data a query nem é lida; ela continua sendo apagada da barra.
// Para remover de vez: apague LEGACY_QUERY_ACCEPTED_UNTIL e o ramo `search` de readResetToken.
export const LEGACY_QUERY_ACCEPTED_UNTIL = Date.parse("2026-11-19T23:59:00Z");
export const acceptLegacyQueryNow = (now: number = Date.now()) => now < LEGACY_QUERY_ACCEPTED_UNTIL;

const MAX_TOKEN_LENGTH = 512;

function valid(raw: string | null | undefined): string {
  const token = (raw ?? "").trim();
  // Só o alfabeto de um token (hex, base64 e base64url): nada de < > " ' ( ) espaço ou controle. O token nunca é desenhado na
  // página, e mesmo assim um valor com cara de HTML ou script é recusado aqui (DOM-XSS, Sun Tzu): vira "Link inválido".
  return token.length > 0 && token.length <= MAX_TOKEN_LENGTH && /^[A-Za-z0-9_\-+/=.~]+$/.test(token) ? token : "";
}

// Lê `token=` de "#a=1&token=x" ou "?token=x". Manual de propósito: URLSearchParams troca "+" por espaço e um token
// base64 comum perderia o "+". Só %XX é decodificado; decodificação inválida usa o texto cru (a API decide).
function paramFrom(fragmentOrQuery: string, name: string): string {
  const text = fragmentOrQuery.replace(/^[#?]/, "");
  for (const part of text.split("&")) {
    if (!part.startsWith(`${name}=`)) continue;
    const raw = part.slice(name.length + 1);
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }
  return "";
}

/** Lê o token da URL: fragmento primeiro; query legada só na transição. Não altera a URL. */
export function readResetToken(location: Pick<Location, "hash" | "search">, acceptLegacyQuery: boolean = acceptLegacyQueryNow()): string {
  const fromHash = valid(paramFrom(location.hash, "token"));
  if (fromHash) return fromHash;
  return acceptLegacyQuery ? valid(paramFrom(location.search, "token")) : "";
}

/** Apaga fragmento e query da barra de endereço sem recarregar e sem criar entrada no histórico. */
export function clearResetTokenFromUrl(win: Pick<Window, "history" | "location"> = window) {
  try {
    win.history.replaceState(null, "", win.location.pathname);
  } catch {
    // sem History API (ambiente restrito): o token já está em memória; não há o que apagar
  }
}

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

// Toda página chama isto e só verifica `!response.ok` — sem o try/catch, uma falha de rede
// (API fora do ar, sem internet) faz o fetch rejeitar a promise, e como nenhuma página trata
// isso, a ação para em silêncio (parece que o clique não fez nada, sem nenhum erro na tela).
// Normalizamos a falha de rede num Response sintético pra todo `!response.ok` já existente
// nas páginas passar a funcionar sozinho.
export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(`${API_URL}${path}`, {
      ...init,
      credentials: "include",
      headers: { "Content-Type": "application/json", ...init?.headers },
    });
  } catch {
    // 503 (não um status real do servidor) só pra passar pelo `!response.ok` que toda
    // página já checa — status 0 pareceria mais correto, mas o construtor de Response só
    // aceita 200-599.
    return new Response(JSON.stringify({ error: "Não foi possível conectar ao servidor. Verifique sua internet e tente de novo." }), {
      status: 503,
      statusText: "Network Error",
      headers: { "Content-Type": "application/json" },
    });
  }
}

// Iniciais do logo quando a loja não tem imagem (spec 09 §2.2): primeira letra das duas
// primeiras palavras significativas, em caixa alta. "Pizzaria Boa Massa" -> "PB"; "Zé" -> "Z".
const IGNORED = new Set(["de", "da", "do", "das", "dos", "e"]);

export function storeInitials(name: string | null | undefined): string {
  const words = (name ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const significant = words.filter((word) => !IGNORED.has(word.toLowerCase()));
  // Nome só de palavras ignoradas ("De Da"): usa as palavras como estão em vez de ficar vazio.
  const base = significant.length > 0 ? significant : words;
  return base
    .slice(0, 2)
    .map((word) => Array.from(word.replace(/^[^\p{L}\p{N}]+/u, ""))[0] ?? "")
    .join("")
    .toLocaleUpperCase("pt-BR");
}

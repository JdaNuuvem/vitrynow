// Endereço de imagem (logo, capa, foto do produto): só https. O servidor recusa o resto (SEC-14/ST-17) e o CSP
// do navegador (NG-07, `img-src`) já não carrega http://; validar aqui dá a mensagem na hora, antes de salvar.
export const IMAGE_URL_HTTPS_MESSAGE = "Use um endereço que comece com https://";
export const IMAGE_URL_TOO_LONG_MESSAGE = "Endereço muito longo (máximo de 500 caracteres).";
const MANAGED_IMAGE = /^\/media\/stores\/[A-Za-z0-9_-]{1,64}\/[a-f0-9-]{36}-\d{2,5}\.webp$/;

// Vazio é válido (o campo é opcional). Mesma regra do servidor: prefixo literal "https://" (o parser aceita
// "https:host/x", mas o navegador o trata como caminho relativo), host presente e sem usuário/senha na URL.
export function validateImageUrl(value: string): string | null {
  const text = value.trim();
  if (text === "") return null;
  if (text.length > 500) return IMAGE_URL_TOO_LONG_MESSAGE;
  if (!/^https:\/\//i.test(text)) return IMAGE_URL_HTTPS_MESSAGE;
  try {
    const url = new URL(text);
    if (url.protocol !== "https:" || url.hostname === "" || url.username !== "" || url.password !== "") return IMAGE_URL_HTTPS_MESSAGE;
  } catch {
    return IMAGE_URL_HTTPS_MESSAGE;
  }
  return null;
}

export function validateStoreImageUrl(value: string): string | null {
  return MANAGED_IMAGE.test(value.trim()) ? null : validateImageUrl(value);
}

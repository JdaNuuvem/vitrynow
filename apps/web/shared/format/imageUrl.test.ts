import { describe, expect, it } from "vitest";
import { IMAGE_URL_HTTPS_MESSAGE, IMAGE_URL_TOO_LONG_MESSAGE, validateImageUrl } from "./imageUrl";

describe("validateImageUrl (mesma regra do servidor, SEC-14/ST-17)", () => {
  it("vazio e só espaços valem: o campo é opcional", () => {
    expect(validateImageUrl("")).toBeNull();
    expect(validateImageUrl("   ")).toBeNull();
  });

  it("https com host vale, com espaços em volta também", () => {
    expect(validateImageUrl("https://exemplo.com/foto.png")).toBeNull();
    expect(validateImageUrl("  HTTPS://exemplo.com/foto.png  ")).toBeNull();
  });

  it.each([
    "http://exemplo.com/foto.png",
    "exemplo.com/foto.png",
    "//exemplo.com/foto.png",
    "javascript:alert(1)",
    "data:image/png;base64,AAAA",
    "file:///C:/foto.png",
    "https:exemplo.com/foto.png",
    "https://",
    "https://usuario:senha@exemplo.com/foto.png",
    "https://usuario@exemplo.com/foto.png",
  ])("recusa %s com a mensagem do https", (value) => {
    expect(validateImageUrl(value)).toBe(IMAGE_URL_HTTPS_MESSAGE);
  });

  it("recusa endereço acima de 500 caracteres", () => {
    expect(validateImageUrl(`https://exemplo.com/${"a".repeat(500)}`)).toBe(IMAGE_URL_TOO_LONG_MESSAGE);
  });
});

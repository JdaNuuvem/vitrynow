import localFont from "next/font/local";

// Fonte de título do cardápio público (spec 12 §6, decisão do Atlas): Plus Jakarta Sans 700/800, latin, servida do
// próprio repositório (`./fonts`, licença OFL junto). Sem download no build e sem chamada ao Google em runtime.
// `display: swap` mostra o texto na hora; `adjustFontFallback` iguala as métricas da fonte reserva (CLS 0).
// Só o cardápio público importa este arquivo: o painel não carrega nada daqui.
export const lojaTitleFont = localFont({
  src: [
    { path: "./fonts/plus-jakarta-sans-latin-700-normal.woff2", weight: "700", style: "normal" },
    { path: "./fonts/plus-jakarta-sans-latin-800-normal.woff2", weight: "800", style: "normal" },
  ],
  display: "swap",
  preload: true,
  adjustFontFallback: "Arial",
  fallback: ["Inter", "system-ui", "sans-serif"],
  variable: "--font-loja-title",
});

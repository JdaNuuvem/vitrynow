import type { CSSProperties } from "react";

// Cor da loja no cardápio público (spec 12 §6, D-01). Só o cardápio usa isto: a cor do painel não muda.
// O destaque vem da loja (`primaryColor`); sem ele, VERDE (decisão do Claudio, 17/11). O texto sobre o destaque e a
// "tinta" do destaque (preço, links) são calculados para sempre ter contraste ≥ 4,5:1, seja qual for a cor escolhida.

export const DEFAULT_ACCENT = "#1f7a54";
const MIN_CONTRAST = 4.5;

const HEX = /^#[0-9a-fA-F]{6}$/;

function channel(hex: string, start: number): number {
  return Number.parseInt(hex.slice(start, start + 2), 16);
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((start) => {
    const value = channel(hex, start) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

function darken(hex: string, amount: number): string {
  const part = (start: number) => Math.round(channel(hex, start) * (1 - amount)).toString(16).padStart(2, "0");
  return `#${part(1)}${part(3)}${part(5)}`;
}

// Cor inválida ou vazia cai no verde padrão: o cardápio nunca fica sem destaque nem quebra com um valor ruim.
export function normalizeAccent(primaryColor: string | null | undefined): string {
  return primaryColor && HEX.test(primaryColor) ? primaryColor.toLowerCase() : DEFAULT_ACCENT;
}

// Texto sobre o destaque (botão "+", chip ativo): branco se der 4,5:1; senão escuro.
export function accentOn(accent: string): string {
  return contrastRatio(accent, "#ffffff") >= MIN_CONTRAST ? "#ffffff" : "#111111";
}

// Destaque usado COMO TEXTO sobre branco (preço, "Ver todas ›"): escurece aos poucos até 4,5:1.
export function accentInk(accent: string): string {
  let ink = accent;
  for (let step = 0; step < 25 && contrastRatio(ink, "#ffffff") < MIN_CONTRAST; step++) ink = darken(ink, 0.08);
  return ink;
}

export function lojaThemeStyle(primaryColor: string | null | undefined): CSSProperties {
  const accent = normalizeAccent(primaryColor);
  return {
    "--loja-accent": accent,
    "--loja-accent-on": accentOn(accent),
    "--loja-accent-ink": accentInk(accent),
  } as CSSProperties;
}

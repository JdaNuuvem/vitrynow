"use client";

import { useHiddenValues } from "@/features/inicio/hooks/useHiddenValues";
import { moneyOrHidden } from "@/shared/format/money";

// Mesma preferência "Ocultar valores" do Início e dos Relatórios (rebrand: vale em toda tela que mostra dinheiro).
// Ocultar é só visual: quem pode ver custo e lucro continua sendo decidido pela API.
export function useMoney() {
  const { hidden, toggle } = useHiddenValues();
  const money = (cents: number) => moneyOrHidden(cents, hidden); // SSOT D11
  return { money, hidden, toggle };
}

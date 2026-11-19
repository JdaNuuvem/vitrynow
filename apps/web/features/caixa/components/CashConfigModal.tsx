"use client";

import { InfoModal, InfoSection } from "@/shared/ui/InfoModal";

export function CashConfigModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <InfoModal open={open} onClose={onClose} title="Ajuda com o caixa" titleId="cash-config-title">
      <InfoSection title="Abertura">O caixa é aberto por você antes da primeira venda, informando o saldo em dinheiro naquele momento.</InfoSection>
      <InfoSection title="Fechamento">
        Você fecha o caixa no fim do expediente. Compare o saldo esperado com o valor físico em mãos e finalize.
      </InfoSection>
      <h3 className="cash-config-subheader">Tire suas dúvidas</h3>
      <InfoSection title="O que é o controle de caixa?">
        Uma forma de acompanhar o dinheiro físico que entra e sai da sua loja durante o dia: saldo de abertura, entradas, saídas e conferência de
        diferenças no fechamento.
      </InfoSection>
      <InfoSection title="Entradas e saídas">
        Use Entrada e Saída para registrar suprimentos e sangrias. Toda movimentação tem um motivo.
      </InfoSection>
      <InfoSection title="E para quem não movimenta dinheiro?">
        Sem problemas. O resumo ainda mostra as vendas desde a abertura, separadas por tipo de pedido.
      </InfoSection>
    </InfoModal>
  );
}

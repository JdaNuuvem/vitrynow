"use client";

import type { CashMovementInput, CashMovementType } from "@/core/domain/cashier";
import { Button } from "@/shared/design/components";
import { CashMovementEditor } from "./CashEditors";
import { CashModalLayout } from "./CashModalLayout";

type Props = {
  type: CashMovementType | null;
  onClose: () => void;
  onConfirm: (input: CashMovementInput, idempotencyKey: string) => Promise<string | null>;
};

export function MovementModal({ type, onClose, onConfirm }: Props) {
  return (
    <CashModalLayout open={type !== null} onClose={onClose} title={type === "SANGRIA" ? "Saída de dinheiro" : "Entrada de dinheiro"}
      titleId="movement-title" footer={<Button variant="quiet" onClick={onClose}>Voltar</Button>}>
      {type && <CashMovementEditor key={type} fixedType={type} onConfirm={onConfirm} onSuccess={onClose} />}
    </CashModalLayout>
  );
}

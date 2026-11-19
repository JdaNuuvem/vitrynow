"use client";

import type { CashCloseInput, CashClosingPreview } from "@/core/domain/cashier";
import type { HttpResult } from "@/core/http/HttpClient";
import { Button } from "@/shared/design/components";
import { CashCloseEditor } from "./CashEditors";
import { CashModalLayout } from "./CashModalLayout";

type Props = {
  open: boolean;
  onClose: () => void;
  onPreview: (value: number) => Promise<HttpResult<CashClosingPreview>>;
  onConfirm: (input: CashCloseInput) => Promise<string | null>;
};

export function CloseCashModal({ open, onClose, onPreview, onConfirm }: Props) {
  return (
    <CashModalLayout open={open} onClose={onClose} title="Fechar caixa" titleId="close-cash-title"
      footer={<Button variant="quiet" onClick={onClose}>Voltar</Button>}>
      {open && <CashCloseEditor onPreview={onPreview} onConfirm={onConfirm} onSuccess={onClose} />}
    </CashModalLayout>
  );
}

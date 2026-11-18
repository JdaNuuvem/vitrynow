import type { Metadata } from "next";
import { AuthRoot } from "@/features/auth/AuthRoot";
import { ResetPasswordPage } from "@/features/auth/ResetPasswordPage";

// ST-56: a página recebe o token no fragmento da URL. `referrer: no-referrer` (além do cabeçalho em next.config) garante que
// nenhum link ou recurso desta página receba o endereço de volta; não entra no índice de busca.
export const metadata: Metadata = { referrer: "no-referrer", robots: { index: false, follow: false } };

export default function Page() {
  return (
    <AuthRoot>
      <ResetPasswordPage />
    </AuthRoot>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { usePanelServices } from "@/core/services/PanelServices";
import { useHelp } from "@/features/ajuda/HelpWidget";

export function SidebarFooter({ onNavigate }: { onNavigate: () => void }) {
  const router = useRouter();
  const { auth } = usePanelServices();
  const { openHelp } = useHelp();

  async function logout() {
    await auth.logout();
    router.push("/login");
  }

  return (
    <nav className="shell-footer">
      <button type="button" onClick={() => { onNavigate(); openHelp("feedback"); }}>
        Enviar sugestões
      </button>
      <button type="button" onClick={() => { onNavigate(); openHelp("suporte"); }}>
        Suporte
      </button>
      <button type="button" onClick={logout}>
        Sair da conta
      </button>
    </nav>
  );
}

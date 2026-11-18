"use client";

import { ChangePasswordCard } from "./components/ChangePasswordCard";
import { StoreSettingsCard } from "./components/StoreSettingsCard";
import { useConta } from "./hooks/useConta";
import "./conta.css";

export function ContaPage() {
  const { store, save, changePassword } = useConta();

  if (!store) return <main className="conta">Carregando...</main>;

  return (
    <main className="conta">
      <h1>Conta e personalização</h1>
      <StoreSettingsCard store={store} onSave={save} />
      <ChangePasswordCard onChangePassword={changePassword} />
    </main>
  );
}

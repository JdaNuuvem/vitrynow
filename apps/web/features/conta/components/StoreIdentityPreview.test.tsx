import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { StoreSettings } from "@/core/domain/store";
import { StoreIdentityPreview } from "./StoreIdentityPreview";

// A prévia da Aparência acompanha o modelo escolhido: clássico (cabeçalho + categorias) ou Reels (o feed do cardápio).
const store = { id: "s1", name: "Ramenku", slug: "ramenku", logoUrl: null, coverImageUrl: null, menuLayout: "CLASSIC" } as unknown as StoreSettings;
const draft = { url: "", file: null } as never;

describe("prévia da Aparência", () => {
  it("modelo clássico mostra a amostra da lista", () => {
    render(<StoreIdentityPreview store={store} primaryColor="#c0392b" logo={draft} cover={draft} />);
    expect(screen.getByText("Ver carrinho")).toBeInTheDocument();
    expect(document.querySelector(".reels-menu")).toBeNull();
  });
  it("modelo Reels mostra o feed do cardápio dentro da prévia", () => {
    render(<StoreIdentityPreview store={store} primaryColor="#c0392b" logo={draft} cover={draft} layout="REELS" />);
    expect(document.querySelector(".appearance-preview__reels .reels-menu")).not.toBeNull();
    expect(screen.queryByText("Ver carrinho")).toBeNull();
    expect(screen.getByText(/vídeos publicados em Reels/)).toBeInTheDocument();
  });
});

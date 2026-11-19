import Link from "next/link";
import { VitryBrand } from "@/shared/ui/VitryBrand";
import { ThemeControls } from "@/shared/design/ThemeControls";
import "@/shared/styles/panel-tokens.css";
import "./home.css";

export function HomePage() {
  const demoEnabled = process.env.NEXT_PUBLIC_LOCAL_RAMENKU === "1" && process.env.NODE_ENV === "development";
  return (
    <main className="home">
      <header className="home__nav"><VitryBrand /><ThemeControls /></header>
      <section className={"home__layout" + (demoEnabled ? " home__layout--demo" : "")}>
        <div>
          <h1 className="home__title">Painel do restaurante</h1>
          <p className="home__text">Acompanhe os pedidos, atualize seu cardápio e consulte as vendas da sua loja.</p>
          <div className="home__actions">
            <Link href="/login" className="ds-button ds-button--primary">Entrar no painel</Link>
            <Link href="/cadastro" className="ds-button ds-button--secondary">Criar loja</Link>
          </div>
        </div>
        {demoEnabled && (
          <Link href="/loja/ramenku" className="home__demo">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/local-ramenku/fachada.webp" alt="" width={840} height={500} />
            <span>Ver cardápio de demonstração</span>
          </Link>
        )}
      </section>
    </main>
  );
}

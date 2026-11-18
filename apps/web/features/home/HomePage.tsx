import Link from "next/link";
import "@/shared/styles/panel-tokens.css";
import "./home.css";

export function HomePage() {
  return (
    <main className="home">
      <h1 className="home__title">MeuCardapio</h1>
      <p className="home__text">
        Plataforma própria de pedidos: painel administrativo + cardápio online para estabelecimentos. Nome/marca ainda em
        definição (placeholder).
      </p>
      <Link href="/login" className="home__cta">
        Entrar no painel
      </Link>
    </main>
  );
}

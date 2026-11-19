import Link from "next/link";
import type { ReportTopProduct } from "@/core/domain/reports";
import { formatCents } from "@/shared/format/money";

export function TopProductsCard({ products, hidden, reportsHref }: { products: ReportTopProduct[]; hidden: boolean; reportsHref: string }) {
  return (
    <section className="inicio-card inicio-top">
      <div className="inicio-section-title"><h2>Mais vendidos do mês</h2><Link href={reportsHref}>Ver relatório</Link></div>
      {products.length === 0 && <p className="inicio-muted">O ranking aparece após os primeiros pedidos.</p>}
      <ol className="inicio-top__list">{products.map((product, index) => (
        <li key={`${index}-${product.productName}`}>
          <span>{index + 1}</span><strong>{product.productName}</strong><small>{product.quantity} un.</small>
          {product.revenueCents !== undefined && <b>{hidden ? "••••" : formatCents(product.revenueCents)}</b>}
        </li>
      ))}</ol>
    </section>
  );
}

import Link from "next/link";
import type { ReportTopProduct } from "@/core/domain/reports";
import { formatCents } from "@/shared/format/money";
import { Shine } from "@/shared/ui/Shine";

export function TopProductsCard({ products, reportsHref }: { products: ReportTopProduct[] | null; reportsHref: string }) {
  return (
    <div className="inicio-card inicio-top">
      <div className="inicio-top__header">
        <p>Produtos mais vendidos</p>
        <Link href={reportsHref}>Acessar relatório completo</Link>
      </div>
      {products === null && <Shine height={110} />}
      {products?.length === 0 && <p className="inicio-muted">Os produtos mais vendidos aparecem aqui depois dos primeiros pedidos.</p>}
      <div className="inicio-top__list">
        {products?.map((product) => (
          <div key={product.productName} className="inicio-product">
            <div>
              <p>{product.productName}</p>
              <p>{formatCents(product.revenueCents)}</p>
              <p>{product.quantity} vendido(s)</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

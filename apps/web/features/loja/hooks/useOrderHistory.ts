import { useEffect, useState } from "react";

export type PlacedOrder = { code: string; totalCents: number | null; placedAt: string };

// Histórico dos pedidos feitos neste navegador (o cliente não tem login). Só localStorage:
// pode vir vazio/bloqueado, então toda leitura/escrita é protegida.
export function useOrderHistory(slug: string) {
  const key = `orders:${slug}`;
  const [orders, setOrders] = useState<PlacedOrder[]>([]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw) setOrders(JSON.parse(raw));
    } catch {
      // sem histórico — segue vazio
    }
  }, [key]);

  function record(order: PlacedOrder) {
    setOrders((prev) => {
      const next = [order, ...prev].slice(0, 20);
      try {
        localStorage.setItem(key, JSON.stringify(next));
      } catch {
        // não persistiu — vale só nesta sessão
      }
      return next;
    });
  }

  return { orders, record };
}

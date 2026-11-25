export type Additional = { id?: string; name: string; priceCents: number };
export type ProductAvailability = "AVAILABLE" | "TODAY" | "MANUAL";

export type Product = {
  id: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
  priceCents: number;
  active: boolean;
  soldOut?: boolean;
  soldOutUntil?: string | null;
  featured: boolean;
  additionals: Additional[];
} & ProductOptions;

export type Category = { id: string; name: string; icon: string | null; products: Product[] };

export type ProductInput = {
  categoryId: string;
  name: string;
  description?: string;
  imageUrl?: string;
  priceCents: number;
  featured: boolean;
  active: boolean;
  additionals: Additional[];
};
import type { ProductOptions } from "./storefront";


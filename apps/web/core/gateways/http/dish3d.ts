import { FetchHttpClient } from "@/core/http/FetchHttpClient";
import type { Dish3dDetail, Dish3dList } from "@/core/domain/dish3d";

// PRATO 3D: chamadas do painel (só o dono).
const http = new FetchHttpClient();
const enc = encodeURIComponent;

export const dish3dApi = {
  list: () => http.get<Dish3dList>("/api/dish3d"),
  generate(productId: string, photos: File[]) {
    const form = new FormData();
    for (const photo of photos) form.append("photos", photo);
    return http.post<Dish3dDetail>(`/api/products/${enc(productId)}/3d`, form);
  },
  publish: (productId: string) => http.post<Dish3dDetail>(`/api/products/${enc(productId)}/3d/publish`, {}),
  unpublish: (productId: string) => http.post<Dish3dDetail>(`/api/products/${enc(productId)}/3d/unpublish`, {}),
  remove: (productId: string) => http.post<Dish3dDetail>(`/api/products/${enc(productId)}/3d/remove`, {}),
};

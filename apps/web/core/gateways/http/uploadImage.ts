import { FetchHttpClient } from "@/core/http/FetchHttpClient";

const http = new FetchHttpClient();

export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const IMAGE_FILE_ACCEPT = "image/jpeg,image/png,image/webp";

export function uploadImage(kind: "PRODUCT" | "LOGO" | "COVER", file: File) {
  const form = new FormData();
  form.append("file", file);
  return http.post<{ image: { id: string; url: string } }>(`/api/media/images?kind=${kind}`, form);
}

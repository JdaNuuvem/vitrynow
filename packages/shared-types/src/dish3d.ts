import { z } from "zod";
// PRATO 3D: limites compartilhados entre API e painel.
export const DISH3D_MAX_PHOTOS = 4;
export const DISH3D_MAX_PHOTO_BYTES = 8 * 1024 * 1024; // igual ao upload de imagem
// Códigos curtos de falha gravados na geração (a tela traduz).
export const DISH3D_FAILURE_LABELS: Record<string, string> = {
  TIMEOUT: "Demorou demais. Tente de novo com outras fotos.",
  PROVIDER_FAILED: "O serviço não conseguiu montar o prato com estas fotos.",
  MODEL_INVALID: "O arquivo gerado veio com defeito.",
  MODEL_TOO_LARGE: "O arquivo gerado ficou grande demais.",
  PROVIDER_AUTH: "O serviço de 3D recusou o acesso (configuração da plataforma).",
  PROVIDER_NO_BALANCE: "O serviço de 3D está sem saldo (configuração da plataforma).",
  PROVIDER_BUSY: "O serviço de 3D está ocupado.",
  PROVIDER_HTTP: "O serviço de 3D não respondeu.",
  PROVIDER_BAD_RESPONSE: "O serviço de 3D respondeu algo inesperado.",
};

// TAMANHO REAL (AR): a largura do prato é a maior medida vista de cima, em cm. De 3 cm (um docinho) a 80 cm (uma travessa).
export const DISH3D_SIZE_MIN_CM = 3;
export const DISH3D_SIZE_MAX_CM = 80;
export const dish3dSizeSchema = z.object({
  widthCm: z.number().min(DISH3D_SIZE_MIN_CM, "O prato precisa ter pelo menos 3 cm.").max(DISH3D_SIZE_MAX_CM, "O prato pode ter no máximo 80 cm.")
    .refine((v) => Number.isInteger(v * 2), "Use centímetros inteiros ou meio centímetro (ex.: 18 ou 18,5)."),
}).strict();
export type Dish3dSizeInput = z.infer<typeof dish3dSizeSchema>;

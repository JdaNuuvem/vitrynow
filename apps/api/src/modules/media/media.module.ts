import { prisma } from "@meucardapio/db";
import { getObjectStorage } from "../../lib/objectStorage";
import { buildMediaRoutes } from "./media.routes";
import { MediaService } from "./media.service";

// Raiz de composição: o storage é resolvido na primeira requisição (permite o Fake nos testes).
export const mediaService = new MediaService(
  prisma,
  new Proxy({} as ReturnType<typeof getObjectStorage>, { get: (_t, prop) => (getObjectStorage() as never)[prop] }),
);
export default buildMediaRoutes(mediaService);

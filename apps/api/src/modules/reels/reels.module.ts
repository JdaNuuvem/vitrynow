import { prisma } from "@meucardapio/db";
import { getObjectStorage } from "../../lib/objectStorage";
import { getReelTranscoder } from "../../lib/reelTranscoder";
import { buildReelsRoutes } from "./reels.routes";
import { ReelsService } from "./reels.service";

// Raiz de composição: storage e transcoder são resolvidos sob demanda (permite os Fakes nos testes).
const lazyStorage = new Proxy({} as ReturnType<typeof getObjectStorage>, { get: (_t, prop) => (getObjectStorage() as never)[prop] });
export const reelsService = new ReelsService(prisma, lazyStorage, getReelTranscoder);
export default buildReelsRoutes(reelsService);

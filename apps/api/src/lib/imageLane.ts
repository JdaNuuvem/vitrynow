import { HashLane } from "../shared/hashLane";

// Nightingale (#78 A): decodificar/redimensionar imagem é CPU pesada. Mesma ideia da hashLane (SEC-34): 1–2 em voo, fila CURTA,
// espera curta e no máximo 1 upload por loja (nem em voo nem na fila); o resto recebe 503 SERVER_BUSY na hora.
export const IMAGE_LANE_IN_FLIGHT = Math.max(1, Math.min(2, Number(process.env.MEDIA_LANE_IN_FLIGHT) || 1));

export function newImageLane(): HashLane {
  return new HashLane(
    { inFlight: IMAGE_LANE_IN_FLIGHT, maxQueue: 4, maxWaitMs: 2000, maxPerKey: 1 },
    (message) => console.warn(message.replace("[hashlane]", "[imagelane]")),
  );
}

export const imageLane = newImageLane();

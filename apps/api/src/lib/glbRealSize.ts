// PRATO 3D EM TAMANHO REAL: o modelo gerado (Rodin) vem numa escala arbitrária; na realidade aumentada o prato tem
// que aparecer com o tamanho de verdade. O dono informa a LARGURA real do prato (maior medida vista de cima) e aqui o
// .glb é reescrito para essa medida, em METROS (unidade do glTF e do AR), apoiado na superfície (base em y = 0) e
// centralizado. Só o JSON do .glb muda: a malha binária fica intacta (funciona com geometria comprimida, ex. Draco),
// e as medidas vêm do min/max que o glTF OBRIGA em todo POSITION.

const NODE_NAME = "vitry-tamanho-real";
export const REAL_SIZE_MIN_MM = 30; // 3 cm (ex.: um docinho)
export const REAL_SIZE_MAX_MM = 800; // 80 cm (ex.: uma travessa grande)

export class GlbRealSizeError extends Error {
  constructor(public readonly reason: "NOT_GLB" | "NO_GEOMETRY") {
    super(reason);
  }
}

type Vec3 = [number, number, number];
type Mat4 = number[]; // coluna-maior (como o glTF)
type GltfNode = { name?: string; mesh?: number; children?: number[]; matrix?: number[]; translation?: number[]; rotation?: number[]; scale?: number[] };
type Gltf = {
  scene?: number;
  scenes?: { nodes?: number[] }[];
  nodes?: GltfNode[];
  meshes?: { primitives: { attributes: Record<string, number> }[] }[];
  accessors?: { min?: number[]; max?: number[] }[];
};

export type RealSize = { widthMm: number; depthMm: number; heightMm: number };

const IDENTITY: Mat4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

function multiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Array<number>(16).fill(0);
  for (let col = 0; col < 4; col++) for (let row = 0; row < 4; row++) {
    let sum = 0;
    for (let k = 0; k < 4; k++) sum += a[k * 4 + row] * b[col * 4 + k];
    out[col * 4 + row] = sum;
  }
  return out;
}

function localMatrix(node: GltfNode): Mat4 {
  if (node.matrix && node.matrix.length === 16) return node.matrix;
  const [tx, ty, tz] = node.translation ?? [0, 0, 0];
  const [x, y, z, w] = node.rotation ?? [0, 0, 0, 1];
  const [sx, sy, sz] = node.scale ?? [1, 1, 1];
  // T * R * S (coluna-maior)
  return [
    (1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0,
    2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0,
    2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0,
    tx, ty, tz, 1,
  ];
}

function transform(m: Mat4, [x, y, z]: Vec3): Vec3 {
  return [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]];
}

function parseGlb(glb: Buffer): { json: Gltf; rest: Buffer } {
  if (glb.length < 20 || glb.toString("ascii", 0, 4) !== "glTF" || glb.readUInt32LE(4) !== 2) throw new GlbRealSizeError("NOT_GLB");
  const jsonLength = glb.readUInt32LE(12);
  if (glb.toString("ascii", 16, 20) !== "JSON" || 20 + jsonLength > glb.length) throw new GlbRealSizeError("NOT_GLB");
  try {
    return { json: JSON.parse(glb.toString("utf8", 20, 20 + jsonLength)) as Gltf, rest: glb.subarray(20 + jsonLength) };
  } catch {
    throw new GlbRealSizeError("NOT_GLB");
  }
}

function buildGlb(json: Gltf, rest: Buffer): Buffer {
  const raw = Buffer.from(JSON.stringify(json), "utf8");
  const jsonChunk = Buffer.concat([raw, Buffer.alloc((4 - (raw.length % 4)) % 4, 0x20)]);
  const header = Buffer.alloc(20);
  header.write("glTF", 0, "ascii");
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(20 + jsonChunk.length + rest.length, 8);
  header.writeUInt32LE(jsonChunk.length, 12);
  header.write("JSON", 16, "ascii");
  return Buffer.concat([header, jsonChunk, rest]);
}

/** Caixa (min/max) da cena em coordenadas do mundo, pelos min/max dos POSITION transformados pelos nós. */
function sceneBounds(json: Gltf, roots: number[], rootMatrix: Mat4): { min: Vec3; max: Vec3 } | null {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  const seen = new Set<number>();
  const visit = (index: number, parent: Mat4) => {
    const node = json.nodes?.[index];
    if (!node || seen.has(index)) return; // proteção contra ciclo em arquivo malformado
    seen.add(index);
    const world = multiply(parent, localMatrix(node));
    for (const primitive of node.mesh !== undefined ? json.meshes?.[node.mesh]?.primitives ?? [] : []) {
      const accessor = json.accessors?.[primitive.attributes.POSITION];
      if (!accessor?.min || !accessor.max || accessor.min.length < 3) continue;
      const [a, b] = [accessor.min, accessor.max];
      for (const corner of [[a[0], a[1], a[2]], [a[0], a[1], b[2]], [a[0], b[1], a[2]], [a[0], b[1], b[2]], [b[0], a[1], a[2]], [b[0], a[1], b[2]], [b[0], b[1], a[2]], [b[0], b[1], b[2]]] as Vec3[]) {
        const p = transform(world, corner);
        for (let i = 0; i < 3; i++) { min[i] = Math.min(min[i], p[i]); max[i] = Math.max(max[i], p[i]); }
      }
    }
    for (const child of node.children ?? []) visit(child, world);
  };
  for (const root of roots) visit(root, rootMatrix);
  return Number.isFinite(min[0]) ? { min, max } : null;
}

const mm = (meters: number) => Math.round(meters * 1000);

/**
 * Reescreve o .glb para que a maior medida vista de cima (largura ou profundidade) seja `widthMm`, em metros.
 * Pode ser chamada de novo com outra medida: reaproveita o nó de escala anterior (não empilha).
 */
export function rescaleGlbToRealWidth(glb: Buffer, widthMm: number): { glb: Buffer; size: RealSize } {
  const { json, rest } = parseGlb(glb);
  const sceneIndex = json.scene ?? 0;
  const scene = json.scenes?.[sceneIndex];
  if (!scene) throw new GlbRealSizeError("NO_GEOMETRY");
  json.nodes ??= [];

  // já ajustado antes? mede só o conteúdo (sem a escala antiga) e reaproveita o nó
  const previous = scene.nodes?.length === 1 && json.nodes[scene.nodes[0]]?.name === NODE_NAME ? scene.nodes[0] : null;
  const roots = previous !== null ? json.nodes[previous].children ?? [] : scene.nodes ?? [];
  const bounds = sceneBounds(json, roots, IDENTITY);
  if (!bounds) throw new GlbRealSizeError("NO_GEOMETRY");
  const footprint = Math.max(bounds.max[0] - bounds.min[0], bounds.max[2] - bounds.min[2]);
  if (!(footprint > 0)) throw new GlbRealSizeError("NO_GEOMETRY");

  const s = widthMm / 1000 / footprint;
  const wrapper: GltfNode = {
    name: NODE_NAME,
    children: roots,
    scale: [s, s, s],
    // centraliza em x/z e apoia a base na superfície (y = 0): é ali que o AR "pousa" o prato
    translation: [-((bounds.min[0] + bounds.max[0]) / 2) * s, -bounds.min[1] * s, -((bounds.min[2] + bounds.max[2]) / 2) * s],
  };
  if (previous !== null) json.nodes[previous] = wrapper;
  else {
    json.nodes.push(wrapper);
    scene.nodes = [json.nodes.length - 1];
  }
  const size: RealSize = {
    widthMm: mm((bounds.max[0] - bounds.min[0]) * s),
    depthMm: mm((bounds.max[2] - bounds.min[2]) * s),
    heightMm: mm((bounds.max[1] - bounds.min[1]) * s),
  };
  return { glb: buildGlb(json, rest), size };
}

/** Medida real atual do modelo (para conferir o arquivo publicado). */
export function measureGlb(glb: Buffer): RealSize {
  const { json } = parseGlb(glb);
  const scene = json.scenes?.[json.scene ?? 0];
  const bounds = scene ? sceneBounds(json, scene.nodes ?? [], IDENTITY) : null;
  if (!bounds) throw new GlbRealSizeError("NO_GEOMETRY");
  return { widthMm: mm(bounds.max[0] - bounds.min[0]), depthMm: mm(bounds.max[2] - bounds.min[2]), heightMm: mm(bounds.max[1] - bounds.min[1]) };
}

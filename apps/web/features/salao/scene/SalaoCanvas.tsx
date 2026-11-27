"use client";

import { Html, OrbitControls } from "@react-three/drei";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { memo, useMemo, useRef, useState } from "react";
import type { Mesh } from "three";
import { TABLE_STATUS_LABEL } from "@meucardapio/shared-types";
import type { FloorElement, SalaoTable, Selection } from "../types";
import { MATERIALS, statusColor } from "./palette";

// SALÃO 3D — a cena. Organização:
//  - SalaoCanvas: câmera, luz, controles e o piso (montados uma vez; `frameloop="demand"` só redesenha quando algo muda).
//  - TableObject: uma mesa (tampo + cadeiras conforme lugares + anel de status + etiqueta). Memo por mesa: mudar o status de
//    uma mesa re-renderiza só ela, nunca o salão inteiro.
//  - ElementObject: parede, balcão, planta ou porta.
// Formas simples geradas no código (sem baixar modelos): leve no celular.

const SNAP = 0.25;
const snap = (v: number) => Math.round(v / SNAP) * SNAP;
const deg = (d: number) => (d * Math.PI) / 180;

type Props = {
  tables: SalaoTable[];
  elements: FloorElement[];
  selection: Selection;
  editing: boolean;
  onSelect: (selection: Selection) => void;
  onMoveTable: (id: string, posX: number, posZ: number) => void;
  onMoveElement: (index: number, posX: number, posZ: number) => void;
};

function tableSize(t: SalaoTable) {
  const { shape, seats } = t.layout;
  if (shape === "ROUND") return { w: seats > 4 ? 1.3 : 0.9, d: seats > 4 ? 1.3 : 0.9 };
  if (shape === "RECT") return { w: Math.max(1.4, Math.ceil(seats / 2) * 0.65), d: 0.85 };
  return { w: seats > 4 ? 1.2 : 0.85, d: seats > 4 ? 1.2 : 0.85 };
}

/** Posições das cadeiras em volta do tampo (coordenadas locais da mesa). */
function chairSpots(t: SalaoTable): { x: number; z: number; ry: number }[] {
  const { shape, seats } = t.layout;
  const { w, d } = tableSize(t);
  if (shape === "ROUND") {
    const r = w / 2 + 0.35;
    return Array.from({ length: seats }, (_, i) => {
      const a = (i / seats) * Math.PI * 2;
      return { x: Math.cos(a) * r, z: Math.sin(a) * r, ry: -a - Math.PI / 2 };
    });
  }
  // retangular/quadrada: metade de cada lado comprido; sobra vai na cabeceira
  const spots: { x: number; z: number; ry: number }[] = [];
  const perSide = shape === "RECT" ? Math.floor(seats / 2) : Math.min(2, Math.ceil(seats / 4));
  const sides = shape === "RECT" ? 2 : 4;
  let left = seats;
  for (let s = 0; s < sides && left > 0; s++) {
    const n = s === sides - 1 ? left : Math.min(perSide, left);
    const horizontal = s % 2 === 0;
    const len = horizontal ? w : d;
    for (let i = 0; i < n; i++) {
      const off = (i + 1) / (n + 1) * len - len / 2;
      if (s === 0) spots.push({ x: off, z: d / 2 + 0.35, ry: Math.PI });
      if (s === 1) spots.push({ x: shape === "RECT" ? off : w / 2 + 0.35, z: shape === "RECT" ? -d / 2 - 0.35 : off, ry: shape === "RECT" ? 0 : -Math.PI / 2 });
      if (s === 2) spots.push({ x: off, z: -d / 2 - 0.35, ry: 0 });
      if (s === 3) spots.push({ x: -w / 2 - 0.35, z: off, ry: Math.PI / 2 });
    }
    left -= n;
  }
  return spots;
}

function elapsed(iso: string | null): string | null {
  if (!iso) return null;
  const min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${min % 60} min`;
}

const Chair = memo(function Chair({ x, z, ry }: { x: number; z: number; ry: number }) {
  return (
    <group position={[x, 0, z]} rotation={[0, ry, 0]}>
      <mesh position={[0, 0.45, 0]} castShadow>
        <boxGeometry args={[0.42, 0.06, 0.42]} />
        <meshStandardMaterial color={MATERIALS.chair} />
      </mesh>
      <mesh position={[0, 0.72, -0.19]} castShadow>
        <boxGeometry args={[0.42, 0.5, 0.05]} />
        <meshStandardMaterial color={MATERIALS.chair} />
      </mesh>
      <mesh position={[0, 0.22, 0]}>
        <cylinderGeometry args={[0.03, 0.03, 0.44, 6]} />
        <meshStandardMaterial color={MATERIALS.chair} />
      </mesh>
    </group>
  );
});

const PulseRing = ({ color, pulse, selected, radius }: { color: string; pulse: boolean; selected: boolean; radius: number }) => {
  const ref = useRef<Mesh>(null);
  const invalidate = useThree((s) => s.invalidate);
  useFrame(({ clock }) => {
    if (!pulse || !ref.current) return;
    const k = 1 + Math.sin(clock.elapsedTime * 4) * 0.06;
    ref.current.scale.set(k, k, k);
    invalidate(); // só as mesas com aviso pedem novos quadros
  });
  return (
    <mesh ref={ref} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
      <ringGeometry args={[radius, radius + (selected ? 0.16 : 0.09), 48]} />
      <meshBasicMaterial color={color} transparent opacity={selected ? 0.95 : 0.75} />
    </mesh>
  );
};

const TableObject = memo(function TableObject({ table, selected, editing, onPick }: { table: SalaoTable; selected: boolean; editing: boolean; onPick: (e: ThreeEvent<PointerEvent>, id: string) => void }) {
  const { w, d } = tableSize(table);
  const color = statusColor(table.status);
  const alert = table.status === "ASK_BILL" || table.status === "CALL_WAITER";
  const chairs = useMemo(() => chairSpots(table), [table.layout.shape, table.layout.seats]); // eslint-disable-line react-hooks/exhaustive-deps
  const radius = Math.max(w, d) / 2 + 0.75;
  const time = elapsed(table.openedAt);
  return (
    <group position={[table.layout.posX, 0, table.layout.posZ]} rotation={[0, deg(table.layout.rotation), 0]}>
      <group onPointerDown={(e) => onPick(e, table.id)}>
        <mesh position={[0, 0.75, 0]} castShadow receiveShadow>
          {table.layout.shape === "ROUND" ? <cylinderGeometry args={[w / 2, w / 2, 0.05, 32]} /> : <boxGeometry args={[w, 0.05, d]} />}
          <meshStandardMaterial color={MATERIALS.tableTop} />
        </mesh>
        <mesh position={[0, 0.37, 0]}>
          <cylinderGeometry args={[0.06, 0.12, 0.74, 8]} />
          <meshStandardMaterial color={MATERIALS.tableTop} />
        </mesh>
        {chairs.map((c, i) => (
          <Chair key={i} {...c} />
        ))}
        {/* área de clique generosa (invisível) */}
        <mesh position={[0, 0.5, 0]} visible={false}>
          <cylinderGeometry args={[radius - 0.2, radius - 0.2, 1, 16]} />
        </mesh>
      </group>
      <PulseRing color={color} pulse={alert} selected={selected} radius={radius} />
      <Html position={[0, 1.6, 0]} center zIndexRange={[20, 0]} style={{ pointerEvents: "none" }}>
        <div className={`salao-tag${selected ? " salao-tag--selected" : ""}`} data-status={table.status}>
          <span className="salao-tag__dot" />
          <strong>{table.label}</strong>
          {!editing && table.status !== "FREE" && table.status !== "INACTIVE" ? <span>{TABLE_STATUS_LABEL[table.status]}{table.guests ? ` · ${table.guests}p` : ""}{time ? ` · ${time}` : ""}</span> : null}
        </div>
      </Html>
    </group>
  );
});

const ElementObject = memo(function ElementObject({ el, index, selected, editing, onPick }: { el: FloorElement; index: number; selected: boolean; editing: boolean; onPick: (e: ThreeEvent<PointerEvent>, index: number) => void }) {
  const height = el.kind === "WALL" ? 2.4 : el.kind === "COUNTER" ? 1.05 : el.kind === "DOOR" ? 2.1 : 0.9;
  const color = el.kind === "WALL" ? MATERIALS.wall : el.kind === "COUNTER" ? MATERIALS.counter : el.kind === "DOOR" ? MATERIALS.door : MATERIALS.plant;
  return (
    <group position={[el.posX, 0, el.posZ]} rotation={[0, deg(el.rotation), 0]} onPointerDown={editing ? (e) => onPick(e, index) : undefined}>
      {el.kind === "PLANT" ? (
        <>
          <mesh position={[0, 0.2, 0]} castShadow>
            <cylinderGeometry args={[0.22, 0.17, 0.4, 12]} />
            <meshStandardMaterial color={MATERIALS.counter} />
          </mesh>
          <mesh position={[0, 0.75, 0]} castShadow>
            <icosahedronGeometry args={[Math.max(0.35, el.width / 2), 0]} />
            <meshStandardMaterial color={color} flatShading />
          </mesh>
        </>
      ) : (
        <mesh position={[0, height / 2, 0]} castShadow receiveShadow>
          <boxGeometry args={[el.width, height, el.depth]} />
          <meshStandardMaterial color={color} transparent={el.kind === "WALL"} opacity={el.kind === "WALL" ? 0.92 : 1} />
        </mesh>
      )}
      {selected ? (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
          <planeGeometry args={[el.width + 0.3, el.depth + 0.3]} />
          <meshBasicMaterial color={statusColor("WAITING")} transparent opacity={0.35} />
        </mesh>
      ) : null}
    </group>
  );
});

function bounds(tables: SalaoTable[], elements: FloorElement[]) {
  const xs = [...tables.map((t) => t.layout.posX), ...elements.map((e) => e.posX)];
  const zs = [...tables.map((t) => t.layout.posZ), ...elements.map((e) => e.posZ)];
  if (!xs.length) return { cx: 0, cz: 0, size: 8 };
  const [minX, maxX, minZ, maxZ] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
  // tamanho do salão = o que está ocupado + 2 m de cada lado (mínimo 8 m)
  return { cx: (minX + maxX) / 2, cz: (minZ + maxZ) / 2, size: Math.max(8, maxX - minX + 4, maxZ - minZ + 4) };
}

export default function SalaoCanvas({ tables, elements, selection, editing, onSelect, onMoveTable, onMoveElement }: Props) {
  const [drag, setDrag] = useState<{ kind: "table"; id: string } | { kind: "element"; index: number } | null>(null);
  // enquadramento calculado UMA vez por carga (mexer numa mesa não pula a câmera)
  const frame = useMemo(() => bounds(tables, elements), [tables.length, elements.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const mobile = typeof window !== "undefined" && window.matchMedia("(max-width: 720px)").matches;

  const pickTable = (e: ThreeEvent<PointerEvent>, id: string) => {
    e.stopPropagation();
    onSelect({ kind: "table", id });
    if (editing) setDrag({ kind: "table", id });
  };
  const pickElement = (e: ThreeEvent<PointerEvent>, index: number) => {
    e.stopPropagation();
    onSelect({ kind: "element", index });
    setDrag({ kind: "element", index });
  };

  return (
    <Canvas
      className="salao-canvas"
      frameloop="demand"
      shadows={!mobile}
      dpr={mobile ? [1, 1.5] : [1, 2]}
      camera={{ position: [frame.cx + frame.size * 0.35, frame.size * 0.6, frame.cz + frame.size * 0.75], fov: 45, near: 0.1, far: 500 }}
      onPointerMissed={() => onSelect(null)}
    >
      <ambientLight intensity={0.65} />
      <directionalLight position={[frame.cx + 8, 16, frame.cz + 6]} intensity={1.1} castShadow={!mobile} shadow-mapSize={[1024, 1024]} />
      <OrbitControls
        makeDefault
        enabled={!drag}
        target={[frame.cx, 0, frame.cz]}
        maxPolarAngle={Math.PI / 2.25}
        minDistance={3}
        maxDistance={frame.size * 3}
        enableDamping={false}
      />
      {/* piso: recebe o arraste no modo edição */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[frame.cx, 0, frame.cz]}
        receiveShadow
        onPointerMove={(e) => {
          if (!drag) return;
          e.stopPropagation();
          const x = snap(e.point.x);
          const z = snap(e.point.z);
          if (drag.kind === "table") onMoveTable(drag.id, x, z);
          else onMoveElement(drag.index, x, z);
        }}
        onPointerUp={() => setDrag(null)}
        onPointerLeave={() => setDrag(null)}
      >
        <planeGeometry args={[frame.size * 1.6, frame.size * 1.6]} />
        <meshStandardMaterial color={MATERIALS.floor} />
      </mesh>
      <gridHelper args={[Math.round(frame.size * 1.6), Math.round(frame.size * 1.6), MATERIALS.floorLine, MATERIALS.floorLine]} position={[frame.cx, 0.005, frame.cz]} />
      {elements.map((el, i) => (
        <ElementObject key={el.id ?? `new-${i}`} el={el} index={i} editing={editing} selected={selection?.kind === "element" && selection.index === i} onPick={pickElement} />
      ))}
      {tables.map((t) => (
        <TableObject key={t.id} table={t} editing={editing} selected={selection?.kind === "table" && selection.id === t.id} onPick={pickTable} />
      ))}
    </Canvas>
  );
}

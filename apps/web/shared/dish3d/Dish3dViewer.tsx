"use client";

import { createElement, useEffect, useRef, useState } from "react";
import "./dish3d.css";

// PRATO 3D: visualizador do GLB com <model-viewer> (girar com o dedo/mouse e "Ver na mesa" em AR).
// O componente só carrega a biblioteca no navegador (ela não roda no servidor). No iPhone o próprio
// model-viewer gera o USDZ do Quick Look a partir do GLB; no Android usa o Scene Viewer/WebXR.
//
// TAMANHO REAL: o .glb já vem do servidor na medida do prato, em metros. Na câmera a escala é FIXA (`ar-scale="fixed"`):
// o cliente não aumenta nem diminui com os dedos (Scene Viewer recebe `resizable=false`; Quick Look, sem escala). Chegar o
// celular perto faz o prato PARECER maior, como um prato de verdade, mas o tamanho dele na mesa não muda.
// Sem a medida (`realWidthMm`), não há câmera: um tamanho inventado enganaria o cliente.
let loader: Promise<unknown> | null = null;
function loadModelViewer() {
  loader ??= import("@google/model-viewer");
  return loader;
}

export function formatRealSize(widthMm: number) {
  const cm = widthMm / 10;
  return `${Number.isInteger(cm) ? cm : cm.toFixed(1).replace(".", ",")} cm`;
}

type ArElement = HTMLElement & { canActivateAR?: boolean; activateAR?: () => Promise<void> };

export function Dish3dViewer({ src, alt, poster, ar = true, realWidthMm = null, openArOnLoad = false }: {
  src: string;
  alt: string;
  poster?: string | null;
  ar?: boolean;
  realWidthMm?: number | null;
  /** iPhone: abre a câmera (Quick Look) assim que o modelo carregar; se o aparelho recusar, o botão da câmera fica na tela */
  openArOnLoad?: boolean;
}) {
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const element = useRef<ArElement | null>(null);

  useEffect(() => {
    let alive = true;
    loadModelViewer().then(
      () => alive && setReady(true),
      () => alive && setFailed(true),
    );
    return () => {
      alive = false;
    };
  }, []);

  const withAr = ar && !!realWidthMm;
  useEffect(() => {
    const el = element.current;
    if (!ready || !el || !withAr || !openArOnLoad) return;
    let done = false;
    const open = () => {
      if (done || !el.canActivateAR) return;
      done = true;
      void el.activateAR?.().catch(() => undefined);
    };
    el.addEventListener("load", open);
    return () => el.removeEventListener("load", open);
  }, [ready, withAr, openArOnLoad]);

  if (failed) return <p className="dish3d-viewer__fallback">Não foi possível abrir o 3D neste aparelho.</p>;
  if (!ready) return <div className="dish3d-viewer dish3d-viewer--loading" aria-busy="true">Carregando 3D…</div>;

  return createElement(
    "model-viewer",
    {
      ref: element,
      class: "dish3d-viewer",
      src,
      alt,
      poster: poster ?? undefined,
      "camera-controls": "",
      "touch-action": "pan-y",
      "auto-rotate": "",
      "shadow-intensity": "1",
      exposure: "1",
      ...(withAr ? { ar: "", "ar-modes": "webxr scene-viewer quick-look", "ar-placement": "floor", "ar-scale": "fixed" } : {}),
    },
    realWidthMm ? createElement("span", { className: "dish3d-viewer__size" }, `Tamanho real: ${formatRealSize(realWidthMm)}`) : null,
    withAr ? createElement("button", { slot: "ar-button", type: "button", className: "dish3d-viewer__ar" }, "Ver na mesa em tamanho real") : null,
  );
}

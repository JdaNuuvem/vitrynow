"use client";

import { createElement, useEffect, useState } from "react";
import "./dish3d.css";

// PRATO 3D: visualizador do GLB com <model-viewer> (girar com o dedo/mouse e "Ver na mesa" em AR).
// O componente só carrega a biblioteca no navegador (ela não roda no servidor). No iPhone o próprio
// model-viewer gera o USDZ do Quick Look a partir do GLB; no Android usa o Scene Viewer/WebXR.
let loader: Promise<unknown> | null = null;
function loadModelViewer() {
  loader ??= import("@google/model-viewer");
  return loader;
}

export function Dish3dViewer({ src, alt, poster, ar = true }: { src: string; alt: string; poster?: string | null; ar?: boolean }) {
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

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

  if (failed) return <p className="dish3d-viewer__fallback">Não foi possível abrir o 3D neste aparelho.</p>;
  if (!ready) return <div className="dish3d-viewer dish3d-viewer--loading" aria-busy="true">Carregando 3D…</div>;

  return createElement(
    "model-viewer",
    {
      class: "dish3d-viewer",
      src,
      alt,
      poster: poster ?? undefined,
      "camera-controls": "",
      "touch-action": "pan-y",
      "auto-rotate": "",
      "shadow-intensity": "1",
      exposure: "1",
      ...(ar ? { ar: "", "ar-modes": "webxr scene-viewer quick-look", "ar-placement": "floor" } : {}),
    },
    ar ? createElement("button", { slot: "ar-button", type: "button", className: "dish3d-viewer__ar" }, "Ver na mesa") : null,
  );
}

// PRATO 3D — abrir a CÂMERA direto (um toque) e mostrar o prato na mesa em TAMANHO REAL.
//
// Android: o Scene Viewer do Google abre por um link `intent://` NO PRÓPRIO TOQUE (sem carregar o 3D na página):
//   mode=ar_only        -> vai direto para a câmera (não abre a tela de girar)
//   resizable=false     -> o cliente NÃO aumenta nem diminui o prato com os dedos (o .glb já está na medida real, em metros)
//   S.browser_fallback_url -> sem o app de AR no celular, volta para o cardápio (com #sem-camera para avisar)
// iPhone: o Quick Look precisa de um USDZ, que o <model-viewer> gera a partir do .glb depois de carregar; por isso lá
//   o toque carrega o 3D e abre a câmera assim que fica pronto (ver Dish3dViewer `openArOnLoad`).
// Computador: sem câmera de AR, o botão nem aparece.

export type ArPlatform = "android" | "ios" | null;

export const NO_CAMERA_HASH = "#sem-camera";

/** Plataforma de AR do aparelho, pelo navegador. iPadOS se apresenta como Mac, então conta o toque. */
export function arPlatform(nav: { userAgent: string; maxTouchPoints?: number } | undefined = typeof navigator === "undefined" ? undefined : navigator): ArPlatform {
  if (!nav) return null;
  const ua = nav.userAgent;
  if (/android/i.test(ua)) return "android";
  if (/iPhone|iPad|iPod/i.test(ua) || (/Macintosh/i.test(ua) && (nav.maxTouchPoints ?? 0) > 1)) return "ios";
  return null;
}

/** Link do Scene Viewer que abre a câmera com o prato no tamanho real (escala travada). */
export function sceneViewerUrl({ fileUrl, title, fallbackUrl }: { fileUrl: string; title: string; fallbackUrl: string }): string {
  const params = new URLSearchParams({ file: fileUrl, mode: "ar_only", resizable: "false", disable_occlusion: "true", title });
  const fallback = encodeURIComponent(fallbackUrl);
  return `intent://arvr.google.com/scene-viewer/1.2?${params.toString()}#Intent;scheme=https;package=com.google.ar.core;action=android.intent.action.VIEW;S.browser_fallback_url=${fallback};end;`;
}

/** Android: abre a câmera agora (precisa ser chamado dentro do toque do cliente). */
export function openSceneViewer(modelUrl: string, title: string, navigate: (url: string) => void = (url) => window.location.assign(url)) {
  const page = window.location.href.split("#")[0];
  navigate(sceneViewerUrl({ fileUrl: new URL(modelUrl, window.location.origin).href, title, fallbackUrl: page + NO_CAMERA_HASH }));
}

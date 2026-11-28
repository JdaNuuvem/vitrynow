import { describe, expect, it, vi } from "vitest";
import { arPlatform, NO_CAMERA_HASH, openSceneViewer, sceneViewerUrl } from "./ar";

// Um toque abre a câmera com o prato na mesa em TAMANHO REAL, sem o cliente poder mudar o tamanho.
describe("câmera do prato 3D", () => {
  it("Android abre o Scene Viewer direto na câmera, com escala travada e volta ao cardápio se não tiver o app", () => {
    const url = sceneViewerUrl({ fileUrl: "https://vitry.com.br/media/stores/s/3d-x.glb", title: "Ramen", fallbackUrl: "https://vitry.com.br/loja/r#sem-camera" });
    expect(url.startsWith("intent://arvr.google.com/scene-viewer/1.2?")).toBe(true);
    const query = new URLSearchParams(url.slice(url.indexOf("?") + 1, url.indexOf("#Intent")));
    expect(query.get("file")).toBe("https://vitry.com.br/media/stores/s/3d-x.glb");
    expect(query.get("mode")).toBe("ar_only"); // vai direto para a câmera
    expect(query.get("resizable")).toBe("false"); // o cliente não aumenta nem diminui
    expect(query.get("title")).toBe("Ramen");
    expect(url).toContain("package=com.google.ar.core");
    expect(url).toContain(`S.browser_fallback_url=${encodeURIComponent("https://vitry.com.br/loja/r#sem-camera")}`);
  });

  it("o link usa o endereço completo do modelo e a página atual como volta", () => {
    const navigate = vi.fn();
    openSceneViewer("/media/stores/s/3d-x.glb", "Gyoza", navigate);
    const url = navigate.mock.calls[0][0] as string;
    expect(url).toContain(encodeURIComponent(`${window.location.origin}/media/stores/s/3d-x.glb`));
    expect(url).toContain(encodeURIComponent(NO_CAMERA_HASH));
  });

  it("plataforma: Android, iPhone, iPad (que se apresenta como Mac) e computador sem câmera de AR", () => {
    expect(arPlatform({ userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 7) Chrome/120 Mobile" })).toBe("android");
    expect(arPlatform({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari" })).toBe("ios");
    expect(arPlatform({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari", maxTouchPoints: 5 })).toBe("ios");
    expect(arPlatform({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari", maxTouchPoints: 0 })).toBeNull();
    expect(arPlatform({ userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120" })).toBeNull();
    expect(arPlatform(undefined)).toBeNull();
  });
});

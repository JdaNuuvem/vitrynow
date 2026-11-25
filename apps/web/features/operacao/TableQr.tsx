import { useMemo } from "react";
import qrcode from "qrcode-generator";
import { Modal } from "@/shared/ui/Modal";

export function TableQr({ label, href, onClose }: { label: string; href: string; onClose: () => void }) {
  const { size, pixels } = useMemo(() => {
    const code = qrcode(0, "M");
    code.addData(href);
    code.make();
    const count = code.getModuleCount();
    const pixels: string[] = [];
    for (let row = 0; row < count; row += 1) {
      for (let column = 0; column < count; column += 1) {
        if (code.isDark(row, column)) pixels.push(`M${column + 4},${row + 4}h1v1h-1z`);
      }
    }
    return { size: count + 8, pixels: pixels.join("") };
  }, [href]);

  return <Modal open onClose={onClose} labelledBy="vitrynow-table-qr-title" width={380}>
    <div className="table-qr">
      <div className="table-qr__paper">
        <h2 id="vitrynow-table-qr-title">{label}</h2>
        <p>Escaneie para abrir o cardápio</p>
        <svg width="224" height="224" viewBox={`0 0 ${size} ${size}`} shapeRendering="crispEdges" role="img" aria-label={`QR do cardápio de ${label}`}>
          <rect width={size} height={size} fill="white" />
          <path d={pixels} fill="black" />
        </svg>
      </div>
      <div className="operacao__row">
        <button type="button" onClick={onClose}>Voltar</button>
        <button type="button" className="operacao__primary" onClick={() => window.print()}>Imprimir QR</button>
      </div>
    </div>
  </Modal>;
}

import { Icon } from "@/shared/icons/Icon";

export function CatalogOrderButtons({ label, first, last, busy, onMove }: {
  label: string;
  first: boolean;
  last: boolean;
  busy: boolean;
  onMove: (direction: -1 | 1) => void;
}) {
  return (
    <div className="catalogo-order" role="group" aria-label={`Ordenar ${label}`}>
      <button type="button" className="catalogo__btn" aria-label={`Subir ${label}`} title={`Subir ${label}`} disabled={busy || first}
        onClick={() => onMove(-1)}><Icon name="arrowUp" size={16} aria-hidden="true" /></button>
      <button type="button" className="catalogo__btn" aria-label={`Descer ${label}`} title={`Descer ${label}`} disabled={busy || last}
        onClick={() => onMove(1)}><Icon className="catalogo-order__down" name="arrowUp" size={16} aria-hidden="true" /></button>
    </div>
  );
}

export function moveId(ids: string[], id: string, direction: -1 | 1): string[] | null {
  const index = ids.indexOf(id);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= ids.length) return null;
  const next = [...ids];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

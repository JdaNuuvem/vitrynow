import type { Coupon } from "@/core/domain/coupons";
import { Button, StatusBadge } from "@/shared/design/components";
import { formatCents } from "@/shared/format/money";
import { useStoreTimezone } from "@/features/shell/useStoreTimezone";
import { formatInStoreTimezone } from "@/shared/format/storeTime";

export function CouponRow({ coupon, onSetActive, onEdit, onDelete, busy }: {
  coupon: Coupon;
  onSetActive: () => void;
  onEdit: () => void;
  onDelete?: () => void;
  busy: boolean;
}) {
  const timeZone = useStoreTimezone();
  const expired = !!coupon.expiresAt && Date.parse(coupon.expiresAt) <= Date.now();
  const exhausted = coupon.maxUses !== null && coupon.usedCount >= coupon.maxUses;
  const discount = coupon.discountType === "PERCENT" ? `${coupon.discountValue}%` : formatCents(coupon.discountValue);
  const date = coupon.expiresAt ? formatInStoreTimezone(coupon.expiresAt, timeZone, { dateStyle: "short" }) : "Sem prazo";
  return <tr>
    <th scope="row">{coupon.code}</th><td>{discount}</td>
    <td>{coupon.usedCount}{coupon.maxUses !== null ? ` de ${coupon.maxUses}` : ""}</td><td>{date}</td>
    <td><StatusBadge tone={!coupon.active ? "neutral" : expired || exhausted ? "warning" : "success"}>
      {!coupon.active ? "Inativo" : expired ? "Expirado" : exhausted ? "Limite atingido" : "Ativo"}
    </StatusBadge></td>
    <td><div className="cupons-row__actions">
      <Button disabled={busy} onClick={onEdit}>Editar</Button>
      <Button disabled={busy} onClick={onSetActive}>{coupon.active ? "Desativar" : "Ativar"}</Button>
      {onDelete && <Button variant="quiet" disabled={busy} onClick={onDelete}>Excluir</Button>}
    </div></td>
  </tr>;
}

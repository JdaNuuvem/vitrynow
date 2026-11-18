"use client";

import type { TeamUser } from "@/core/domain/users";

export function MemberRow({ user, onRemove }: { user: TeamUser; onRemove: (id: string) => void }) {
  return (
    <div className="equipe-row">
      <div>
        <strong>{user.email}</strong> <span>({user.role === "OWNER" ? "dono" : "funcionário"})</span>
      </div>
      {user.role !== "OWNER" && (
        <button type="button" className="equipe-row__remove" onClick={() => onRemove(user.id)}>
          remover
        </button>
      )}
    </div>
  );
}

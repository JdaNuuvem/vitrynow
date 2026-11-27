import type { PanelRole } from "@meucardapio/shared-types/constants";
export type TeamUser = { id: string; email: string; role: PanelRole; createdAt: string; displayName?: string | null };

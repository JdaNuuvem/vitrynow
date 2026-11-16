export type DeviceToken = {
  id: string;
  token: string;
  label: string | null;
  revokedAt: string | null;
  lastSeenAt: string | null;
  online: boolean;
};

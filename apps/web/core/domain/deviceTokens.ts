export type DeviceToken = {
  id: string;
  // O valor completo só vem na resposta de criação (uma vez). A listagem pode trazer só um
  // trecho para reconhecer a chave (`tokenPreview`) ou nada (NG-06).
  token?: string;
  tokenPreview?: string;
  label: string | null;
  revokedAt: string | null;
  lastSeenAt: string | null;
  online: boolean;
};

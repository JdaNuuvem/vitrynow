import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RequestOptions } from "@/core/http/HttpClient";
import { PrivacyPage } from "./PrivacyPage";
import type { PrivacyPreview } from "./privacyApi";

const api = vi.hoisted(() => ({ status: vi.fn(), preview: vi.fn(), export: vi.fn(), anonymize: vi.fn() }));
const runProtected = vi.hoisted(() => vi.fn());
vi.mock("./privacyApi", () => ({ privacyApi: api }));
vi.mock("@/features/seguranca/SecurityConfirmProvider", () => ({ useSecurityConfirm: () => ({ runProtected }) }));

const preview: PrivacyPreview = {
  orders: 2, period: null, phoneMasked: "********321", phoneMatch: "EXACT_NUMBER", otherOrdersSamePhone: 0,
  blocked: false, blockers: [], nothingToRemove: false, reauth: "MFA",
};

describe("privacidade no CRM", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    api.status.mockResolvedValue({ ok: true, data: { reauth: "MFA" } });
    api.preview.mockResolvedValue({ ok: true, data: preview });
    runProtected.mockImplementation((_purpose: string, action: (options: RequestOptions) => unknown) => action({ headers: { "x-mfa-challenge": "qa-proof" } }));
  });

  it("respeita o sinalizador do servidor sem pedir dados do cliente", async () => {
    api.status.mockResolvedValue({ ok: false, status: 404, code: "FEATURE_DISABLED", error: "Recurso indisponível." });
    render(<PrivacyPage />);
    expect(await screen.findByText("Privacidade indisponível neste ambiente")).toBeInTheDocument();
    expect(screen.queryByLabelText("Telefone do cliente")).not.toBeInTheDocument();
    expect(api.preview).not.toHaveBeenCalled();
  });

  it("bloqueia a anonimização de pedidos abertos e mantém o acesso à exportação", async () => {
    api.preview.mockResolvedValue({ ok: true, data: {
      ...preview, blocked: true, blockers: [{ code: "0042", status: "NOVO", reason: "OPEN" }],
    } });
    const user = userEvent.setup();
    render(<PrivacyPage />);
    await user.type(await screen.findByLabelText("Telefone do cliente"), "11987654321");
    await user.click(screen.getByRole("button", { name: "Consultar pedidos" }));
    expect(await screen.findByText(/Pedido #0042/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Anonimizar dados" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Exportar JSON" })).toBeEnabled();
    expect(api.anonymize).not.toHaveBeenCalled();
  });

  it("confirma alvo e contagem da prévia por MFA e exige nova consulta se a contagem mudar", async () => {
    api.anonymize.mockResolvedValue({ ok: false, status: 409, code: "COUNT_CHANGED", error: "O número de pedidos mudou. Consulte novamente." });
    const user = userEvent.setup();
    render(<PrivacyPage />);
    await user.selectOptions(await screen.findByLabelText("Buscar por"), "orderCode");
    await user.type(screen.getByLabelText("Código do pedido"), "#0042");
    await user.click(screen.getByRole("button", { name: "Consultar pedidos" }));
    await user.click(await screen.findByRole("button", { name: "Anonimizar dados" }));
    const dialog = within(screen.getByRole("dialog"));
    expect(dialog.queryByLabelText("Sua senha")).not.toBeInTheDocument();
    await user.selectOptions(dialog.getByLabelText("Motivo"), "HOLDER_REQUEST");
    await user.click(dialog.getByRole("checkbox"));
    await user.click(dialog.getByRole("button", { name: "Anonimizar dados" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/O número de pedidos mudou/);
    expect(runProtected).toHaveBeenCalledWith("anonymize_customer", expect.any(Function));
    expect(api.anonymize).toHaveBeenCalledTimes(1);
    expect(api.anonymize).toHaveBeenCalledWith({ orderCode: "0042" }, 2, "HOLDER_REQUEST", undefined, { headers: { "x-mfa-challenge": "qa-proof" } });
    expect(screen.queryByRole("button", { name: "Anonimizar dados" })).not.toBeInTheDocument();
  });
});

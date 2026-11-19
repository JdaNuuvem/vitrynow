import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DeviceToken } from "@/core/domain/deviceTokens";
import type { DeviceTokensGateway } from "@/core/gateways/DeviceTokensGateway";
import type { PrintQueueGateway } from "@/core/gateways/PrintQueueGateway";
import type { HttpResult } from "@/core/http/HttpClient";
import { PanelServicesProvider, type PanelServices } from "@/core/services/PanelServices";
import { ImpressorasPage } from "./ImpressorasPage";

// Objeto estável: um novo a cada render refaria o `reload` do hook em laço.
const router = { push: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => router }));
// runProtected real faz o passo de MFA (testado em features/seguranca); aqui basta repassar a ação.
vi.mock("@/features/seguranca/SecurityConfirmProvider", () => ({
  useSecurityConfirm: () => ({ runProtected: async (_purpose: string, action: (options?: unknown) => Promise<unknown>) => action() }),
}));

const balcao: DeviceToken = { id: "t1", label: "Balcao", revokedAt: null, lastSeenAt: null, online: false, tokenPreview: "uIQA" };
const cozinha: DeviceToken = { id: "t2", label: "Cozinha", revokedAt: null, lastSeenAt: null, online: true, tokenPreview: "k9Zx" };
const antiga: DeviceToken = { id: "t3", label: "Antiga", revokedAt: "2026-11-01T10:00:00Z", lastSeenAt: null, online: false };

const ok = <T,>(data: T): HttpResult<T> => ({ ok: true, data });
const fail = (status: number, error = "x"): HttpResult<never> => ({ ok: false, status, error });

const conference = { pendingJobOfPrintedOrder: 0, printableOrderWithoutJob: 0, printedJobOfUnprintedOrder: 0 };

function setup(gateway: Partial<DeviceTokensGateway>, printGateway: Partial<PrintQueueGateway> = {}) {
  const confirmSpy = vi.spyOn(window, "confirm");
  const deviceTokens = {
    list: vi.fn().mockResolvedValue(ok({ tokens: [balcao, cozinha, antiga] })),
    create: vi.fn(),
    revoke: vi.fn().mockResolvedValue(ok({})),
    ...gateway,
  } as unknown as DeviceTokensGateway;
  const printQueue = {
    configuration: vi.fn().mockResolvedValue(ok({ mode: "LEGACY", conference })),
    alerts: vi.fn().mockResolvedValue(ok({ alerts: [], banner: { needsAttention: {
      queueWithoutPrinter: false, modeUnconfirmed: false, moneyAlert: false,
    } } })),
    setMode: vi.fn().mockResolvedValue(ok({ mode: "QUEUE", changed: true, conference,
      reconciled: { closedPendingJobs: 0, createdJobs: 1, markedOrdersPrinted: 0 } })),
    ...printGateway,
  };
  render(
    <PanelServicesProvider services={{ deviceTokens, printQueue } as unknown as PanelServices}>
      <ImpressorasPage />
    </PanelServicesProvider>,
  );
  return { deviceTokens, confirmSpy, printQueue };
}

beforeEach(() => vi.restoreAllMocks());

describe("Impressoras: revogar com janela de confirmação (WEB-20b, A1)", () => {
  it("revogar NÃO usa confirm() nativo nem revoga no primeiro toque: abre a janela com o nome da chave e o efeito", async () => {
    const { deviceTokens, confirmSpy } = setup({});
    await userEvent.click(await screen.findByRole("button", { name: "Revogar chave Balcao" }));
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(deviceTokens.revoke).not.toHaveBeenCalled();
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: 'Revogar a chave "Balcao"?' })).toBeInTheDocument();
    expect(within(dialog).getByText(/para de funcionar e deixa de imprimir/)).toBeInTheDocument();
    expect(within(dialog).getByText(/Não dá para desfazer/)).toBeInTheDocument();
  });

  it("Voltar fecha sem revogar", async () => {
    const { deviceTokens } = setup({});
    await userEvent.click(await screen.findByRole("button", { name: "Revogar chave Balcao" }));
    await userEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Voltar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(deviceTokens.revoke).not.toHaveBeenCalled();
  });

  it("confirmar revoga a chave certa, fecha a janela e recarrega a lista", async () => {
    const { deviceTokens } = setup({});
    await userEvent.click(await screen.findByRole("button", { name: "Revogar chave Cozinha" }));
    await userEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Revogar chave" }));
    await waitFor(() => expect(deviceTokens.revoke).toHaveBeenCalledWith("t2", undefined));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(deviceTokens.list).toHaveBeenCalledTimes(2);
  });

  it("falha que não é 403 aparece DENTRO da janela como alerta e a chave não some em silêncio", async () => {
    setup({ revoke: vi.fn().mockResolvedValue(fail(500, "Falha ao revogar no servidor.")) });
    await userEvent.click(await screen.findByRole("button", { name: "Revogar chave Balcao" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Revogar chave" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Falha ao revogar no servidor.");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("403 ao revogar: a janela fecha e o aviso 'restrito ao dono' aparece como alerta (A2)", async () => {
    setup({ revoke: vi.fn().mockResolvedValue(fail(403)) });
    await userEvent.click(await screen.findByRole("button", { name: "Revogar chave Balcao" }));
    await userEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Revogar chave" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByRole("alert")).toHaveTextContent("Essa ação é restrita ao dono da loja.");
  });
});

describe("Impressoras: acessibilidade da lista (WEB-20b, A2–A4)", () => {
  it("403 na lista (STAFF): o aviso é role=alert e o formulário some", async () => {
    const { printQueue } = setup({ list: vi.fn().mockResolvedValue(fail(403)) });
    expect(await screen.findByRole("alert")).toHaveTextContent("Essa ação é restrita ao dono da loja.");
    expect(screen.queryByRole("button", { name: "Gerar chave" })).not.toBeInTheDocument();
    expect(printQueue.configuration).not.toHaveBeenCalled();
    expect(printQueue.alerts).not.toHaveBeenCalled();
  });

  it("cada botão 'revogar' leva o nome da chave (leitor de tela distingue as linhas); revogada não tem botão", async () => {
    setup({});
    expect(await screen.findByRole("button", { name: "Revogar chave Balcao" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Revogar chave Cozinha" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^Revogar chave/ })).toHaveLength(2);
  });

  it("status e prévia da chave têm espaço entre si ('offline chave uIQA', não 'offlinechave')", async () => {
    setup({});
    const row = (await screen.findByText("Balcao")).closest(".impressoras-row") as HTMLElement;
    expect(row.textContent).toContain("○ offline chave uIQA");
    expect(row.textContent).not.toContain("offlinechave");
  });

  it("campo de identificação tem nome acessível e o erro de criação é alerta", async () => {
    setup({ create: vi.fn().mockResolvedValue(fail(400, "Identificação inválida.")) });
    await userEvent.click(await screen.findByRole("button", { name: "Gerar chave" }));
    expect(screen.getByRole("textbox", { name: "Identificação da chave" })).toBeInTheDocument();
    expect(await screen.findByRole("alert")).toHaveTextContent("Identificação inválida.");
  });
});

it("troca o modo somente depois da confirmação e apresenta o resultado da conciliação", async () => {
  const { printQueue } = setup({});
  await userEvent.click(await screen.findByRole("button", { name: "Ativar fila" }));
  const dialog = await screen.findByRole("dialog");
  expect(printQueue.setMode).not.toHaveBeenCalled();
  await userEvent.click(within(dialog).getByRole("button", { name: "Confirmar modo" }));
  expect(await screen.findByText("Modo de impressão atualizado")).toBeVisible();
  expect(printQueue.setMode).toHaveBeenCalledWith("QUEUE");
  expect(screen.getByRole("button", { name: "Voltar à impressão direta" })).toBeInTheDocument();
});

import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthGateway } from "@/core/gateways/AuthGateway";
import { AuthServicesProvider } from "@/core/services/AuthServices";
import { PASSWORD_TOO_SHORT_MESSAGE } from "@/shared/auth/passwordPolicy";
import { ResetPasswordPage } from "./ResetPasswordPage";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

type Inspect = { ok: true; data: { valid: boolean; email?: string } } | { ok: false; status: number; error: string };
const GOOD: Inspect = { ok: true, data: { valid: true, email: "m***@gmail.com" } };

function setup(url: string, { strict = false, inspect = GOOD as Inspect | Promise<Inspect>, reset = { ok: true, data: {} } as unknown } = {}) {
  window.history.replaceState(null, "", url);
  const resetPassword = vi.fn().mockResolvedValue(reset);
  const inspectResetToken = vi.fn().mockImplementation(async () => inspect);
  const auth = { resetPassword, inspectResetToken } as unknown as AuthGateway;
  const tree = (
    <AuthServicesProvider auth={auth}>
      <ResetPasswordPage />
    </AuthServicesProvider>
  );
  render(strict ? <StrictMode>{tree}</StrictMode> : tree);
  return { resetPassword, inspectResetToken };
}

const field = () => screen.findByLabelText("Nova senha");
const EMAIL = "maria@gmail.com";
const emailField = () => screen.findByLabelText("Confirme o e-mail desta conta");
const typeAndSend = async (password: string, email = EMAIL) => {
  await userEvent.type(await emailField(), email);
  await userEvent.type(await field(), password);
  await userEvent.click(screen.getByRole("button", { name: "Salvar nova senha" }));
};

describe("ResetPasswordPage: token no fragmento (ST-56 / NG-17)", () => {
  let before = 0;
  beforeEach(() => {
    before = window.history.length;
  });
  afterEach(() => window.history.replaceState(null, "", "/"));

  it("lê o token do fragmento, mostra o formulário e APAGA a barra de endereço na hora", async () => {
    setup("/reset-senha#token=segredo-do-fragmento");
    expect(window.location.hash).toBe("");
    expect(window.location.href).not.toContain("segredo-do-fragmento");
    expect(await field()).toBeInTheDocument();
    expect(window.location.pathname + window.location.search).toBe("/reset-senha");
  });

  it("aceita a query legada (e-mails já enviados) e a apaga da barra", async () => {
    setup("/reset-senha?token=segredo-da-query");
    expect(window.location.search).toBe("");
    expect(window.location.href).not.toContain("segredo-da-query");
    expect(await field()).toBeInTheDocument();
  });

  it("com fragmento e query, vale o fragmento e os dois somem da barra", async () => {
    const { resetPassword, inspectResetToken } = setup("/reset-senha?token=velho#token=novo");
    expect(window.location.href).not.toMatch(/velho|novo/);
    await typeAndSend("minhaSenha123");
    expect(inspectResetToken).toHaveBeenCalledWith("novo");
    expect(resetPassword).toHaveBeenCalledWith("novo", "minhaSenha123", "maria@gmail.com");
  });

  it("sem token: 'Link inválido', sem formulário e SEM chamar a API (nem a conferência)", () => {
    const { resetPassword, inspectResetToken } = setup("/reset-senha");
    expect(screen.getByText(/Link inválido/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Nova senha")).not.toBeInTheDocument();
    expect(resetPassword).not.toHaveBeenCalled();
    expect(inspectResetToken).not.toHaveBeenCalled();
  });

  it("token vazio no fragmento também é 'Link inválido'", () => {
    const { inspectResetToken } = setup("/reset-senha#token=");
    expect(screen.getByText(/Link inválido/)).toBeInTheDocument();
    expect(inspectResetToken).not.toHaveBeenCalled();
  });

  it("o token vai no CORPO da chamada (gateway), com a senha nova, e nunca na URL", async () => {
    const { resetPassword } = setup("/reset-senha#token=corpo-e-so-corpo");
    await typeAndSend("outraSenha1234");
    expect(resetPassword).toHaveBeenCalledWith("corpo-e-so-corpo", "outraSenha1234", "maria@gmail.com");
    expect(window.location.href).not.toContain("corpo-e-so-corpo");
    expect(await screen.findByText("Senha alterada com sucesso.")).toBeInTheDocument();
  });

  it("DOM-XSS: #token=<script>… vira 'Link inválido', não injeta nada, não chama a API", () => {
    const { resetPassword, inspectResetToken } = setup("/reset-senha#token=%3Cimg%20src%3Dx%20onerror%3Dalert(1)%3E");
    expect(screen.getByText(/Link inválido/)).toBeInTheDocument();
    expect(document.querySelector("img, script, svg")).toBeNull();
    expect(document.body.innerHTML).not.toMatch(/onerror|<script/i);
    expect(window.location.href).not.toContain("onerror");
    expect(resetPassword).not.toHaveBeenCalled();
    expect(inspectResetToken).not.toHaveBeenCalled();
  });

  it("link novo colado numa aba JÁ aberta em /reset-senha (só muda o fragmento): lê o token e limpa a barra de novo", async () => {
    const { resetPassword } = setup("/reset-senha");
    expect(screen.getByText(/Link inválido/)).toBeInTheDocument();
    await act(async () => {
      window.location.hash = "#token=link-novo-colado";
      await new Promise((resolve) => setTimeout(resolve, 20)); // jsdom dispara hashchange de forma assíncrona
    });
    expect(window.location.hash).toBe("");
    expect(window.location.href).not.toContain("link-novo-colado");
    await typeAndSend("SenhaColada1234");
    expect(resetPassword).toHaveBeenCalledWith("link-novo-colado", "SenhaColada1234", "maria@gmail.com");
  });

  it("o link novo (mesmo inválido) substitui o anterior: um fragmento com cara de HTML nunca fica na barra", async () => {
    setup("/reset-senha#token=primeiro-valido");
    expect(await field()).toBeInTheDocument();
    await act(async () => {
      window.location.hash = "#token=%3Cscript%3Ealert(1)%3C%2Fscript%3E";
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(screen.getByText(/Link inválido/)).toBeInTheDocument();
    expect(window.location.href).not.toMatch(/script|%3C/i);
    expect(document.body.innerHTML).not.toMatch(/<script/i);
  });

  it("achado no navegador: link NOVO colado depois de uma redefinição concluída começa do zero (não fica em 'Senha alterada')", async () => {
    const { resetPassword, inspectResetToken } = setup("/reset-senha#token=primeiro-link");
    await typeAndSend("1234567890");
    expect(await screen.findByText("Senha alterada com sucesso.")).toBeInTheDocument();
    await act(async () => {
      window.location.hash = "#token=segundo-link";
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(screen.queryByText("Senha alterada com sucesso.")).not.toBeInTheDocument();
    expect(await field()).toBeInTheDocument();
    expect(inspectResetToken).toHaveBeenLastCalledWith("segundo-link");
    expect(resetPassword).toHaveBeenCalledTimes(1); // o segundo link não foi gasto sozinho
  });

  it("a senha digitada para um link NÃO vaza para o link seguinte", async () => {
    setup("/reset-senha#token=link-um");
    await userEvent.type(await field(), "senha-do-link-um");
    await act(async () => {
      window.location.hash = "#token=link-dois";
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect((await field()) as HTMLInputElement).toHaveValue("");
  });

  it("ao desmontar o ouvinte de hashchange é removido (não vaza para outra página)", () => {
    const remove = vi.spyOn(window, "removeEventListener");
    window.history.replaceState(null, "", "/reset-senha#token=remove-listener");
    const auth = { resetPassword: vi.fn(), inspectResetToken: vi.fn().mockResolvedValue(GOOD) } as unknown as AuthGateway;
    const { unmount } = render(
      <AuthServicesProvider auth={auth}>
        <ResetPasswordPage />
      </AuthServicesProvider>,
    );
    unmount();
    expect(remove.mock.calls.some(([type]) => type === "hashchange")).toBe(true);
    remove.mockRestore();
  });

  it("não escreve o token no texto da página", async () => {
    setup("/reset-senha#token=nao-aparece-na-tela");
    await field();
    expect(document.body.textContent).not.toContain("nao-aparece-na-tela");
  });

  it("não cria entrada no histórico (replaceState, não pushState)", async () => {
    setup("/reset-senha#token=sem-historico");
    await field();
    expect(window.history.length).toBe(before);
  });

  it("StrictMode (efeito roda duas vezes): o token lido na 1ª vez NÃO é apagado pela 2ª", async () => {
    setup("/reset-senha#token=resiste-ao-strictmode", { strict: true });
    expect(await field()).toBeInTheDocument();
    expect(screen.queryByText(/Link inválido/)).not.toBeInTheDocument();
    expect(window.location.hash).toBe("");
  });
});

describe("ResetPasswordPage: conferência da conta antes da senha (SEC-29 / ST-63)", () => {
  afterEach(() => window.history.replaceState(null, "", "/"));

  it("UI-PW-01: mostra o e-mail mascarado e o aviso ACIMA do campo, e o campo lê o bloco por aria-describedby", async () => {
    setup("/reset-senha#token=abc123");
    const input = await field();
    const note = screen.getByRole("note");
    expect(note).toHaveTextContent("Você está redefinindo a senha de m***@gmail.com");
    expect(note).toHaveTextContent("Se esta não for a sua conta, feche esta página e não digite nenhuma senha.");
    expect(note.compareDocumentPosition(input) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const described = (input.getAttribute("aria-describedby") ?? "").split(" ");
    expect(described).toContain(note.id);
    expect(screen.getByText(/Pelo menos 10 caracteres/).id).toSatisfy((id: string) => described.includes(id));
  });

  it("sem foco automático no campo (o leitor de tela leria o bloco primeiro)", async () => {
    setup("/reset-senha#token=abc123");
    expect(await field()).not.toHaveFocus();
  });

  it("a conferência manda o token no CORPO, uma vez, e nada mais vai ao servidor antes de enviar", async () => {
    const { inspectResetToken, resetPassword } = setup("/reset-senha#token=so-uma-vez");
    await field();
    expect(inspectResetToken).toHaveBeenCalledTimes(1);
    expect(inspectResetToken).toHaveBeenCalledWith("so-uma-vez");
    expect(resetPassword).not.toHaveBeenCalled();
  });

  it("UI-PW-03b: e-mail com <script> vira TEXTO, nunca HTML", async () => {
    // o filtro de forma da tela recusa e-mail com < > " ' &, então vira falha fechada; o que passa nunca é interpretado
    setup("/reset-senha#token=abc123", { inspect: { ok: true, data: { valid: true, email: "<img src=x onerror=alert(1)>@x.com" } } });
    expect(await screen.findByRole("alert")).toHaveTextContent("Não foi possível confirmar a conta deste link");
    expect(document.querySelector("img")).toBeNull();
    expect(document.body.innerHTML).not.toMatch(/onerror/i);
  });

  it("e-mail mascarado normal com caracteres comuns é desenhado como texto", async () => {
    setup("/reset-senha#token=abc123", { inspect: { ok: true, data: { valid: true, email: "j***@empresa-boa.com.br" } } });
    await field();
    expect(screen.getByText("j***@empresa-boa.com.br").tagName).toBe("STRONG");
  });

  it("valid:false ⇒ 'Link inválido' (igual para vencido, usado, malformado), sem formulário", async () => {
    setup("/reset-senha#token=vencido", { inspect: { ok: true, data: { valid: false } } });
    expect(await screen.findByText(/Link inválido/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Nova senha")).not.toBeInTheDocument();
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
  });

  it("enquanto confere, ainda não há campo de senha", async () => {
    let release: (value: Inspect) => void = () => {};
    setup("/reset-senha#token=abc123", { inspect: new Promise<Inspect>((resolve) => (release = resolve)) });
    expect(screen.getByText("Conferindo o link...")).toBeInTheDocument();
    expect(screen.queryByLabelText("Nova senha")).not.toBeInTheDocument();
    await act(async () => release(GOOD));
    expect(await field()).toBeInTheDocument();
  });

  it.each([
    ["rede fora", { ok: false, status: 503, error: "sem rede" } as Inspect],
    ["429 (limite)", { ok: false, status: 429, error: "muitas tentativas" } as Inspect],
    ["500", { ok: false, status: 500, error: "erro" } as Inspect],
    ["resposta sem e-mail", { ok: true, data: { valid: true } } as Inspect],
    ["resposta inesperada", { ok: true, data: {} as { valid: boolean } } as Inspect],
  ])("UI-PW-03 (falha fechada): %s ⇒ alerta, botão 'Tentar de novo' e SEM campo de senha", async (_nome, inspect) => {
    setup("/reset-senha#token=abc123", { inspect });
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Não foi possível confirmar a conta deste link. Tente de novo.");
    expect(screen.getByRole("button", { name: "Tentar de novo" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Nova senha")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Salvar nova senha" })).not.toBeInTheDocument();
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
  });

  it("a faixa de falha tem ícone de atenção decorativo (aria-hidden) à esquerda do texto", async () => {
    setup("/reset-senha#token=abc123", { inspect: { ok: false, status: 503, error: "sem rede" } });
    const alert = await screen.findByRole("alert");
    const icon = alert.querySelector("svg");
    expect(icon).not.toBeNull();
    expect(icon).toHaveAttribute("aria-hidden", "true");
    const text = screen.getByText("Não foi possível confirmar a conta deste link. Tente de novo.");
    expect(icon!.compareDocumentPosition(text) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("'Tentar de novo' refaz SÓ a conferência e, se deu certo, libera o formulário", async () => {
    const { inspectResetToken, resetPassword } = setup("/reset-senha#token=abc123", { inspect: { ok: false, status: 429, error: "limite" } });
    await screen.findByRole("alert");
    inspectResetToken.mockImplementation(async () => GOOD);
    await userEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));
    expect(await field()).toBeInTheDocument();
    expect(inspectResetToken).toHaveBeenCalledTimes(2);
    expect(resetPassword).not.toHaveBeenCalled();
  });

  it("UI-PW-07: o e-mail mascarado não vai para URL, localStorage nem sessionStorage", async () => {
    localStorage.clear();
    sessionStorage.clear();
    setup("/reset-senha#token=abc123");
    await field();
    expect(window.location.href).not.toContain("gmail");
    expect(JSON.stringify({ ...localStorage, ...sessionStorage })).not.toMatch(/gmail|abc123/);
  });
});

describe("ResetPasswordPage: senha mínima de 10 (SEC-29)", () => {
  afterEach(() => window.history.replaceState(null, "", "/"));

  it("UI-PW-04: com 9 caracteres o botão não habilita e, ao sair do campo, mostra o erro junto dele, mantém a ajuda e NÃO chama a API", async () => {
    const { resetPassword } = setup("/reset-senha#token=abc123");
    await userEvent.type(await emailField(), EMAIL);
    await userEvent.type(await field(), "123456789");
    expect(screen.getByRole("button", { name: "Salvar nova senha" })).toBeDisabled();
    await userEvent.tab(); // sai do campo da senha
    const input = await field();
    expect(await screen.findByRole("alert")).toHaveTextContent(PASSWORD_TOO_SHORT_MESSAGE);
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText(/Pelo menos 10 caracteres/)).toBeInTheDocument(); // a ajuda continua visível
    expect(resetPassword).not.toHaveBeenCalled();
  });

  it("com 10 caracteres envia", async () => {
    const { resetPassword } = setup("/reset-senha#token=abc123");
    await typeAndSend("1234567890");
    expect(resetPassword).toHaveBeenCalledWith("abc123", "1234567890", "maria@gmail.com");
  });

  it("o erro não aparece a cada tecla: só ao sair do campo ou ao tentar enviar", async () => {
    setup("/reset-senha#token=abc123");
    const input = await field();
    await userEvent.type(input, "abc");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    await userEvent.tab(); // sai do campo
    expect(await screen.findByRole("alert")).toHaveTextContent(PASSWORD_TOO_SHORT_MESSAGE);
  });

  it("sem balão nativo do navegador (noValidate) e sem minLength no campo", async () => {
    setup("/reset-senha#token=abc123");
    const input = await field();
    expect(input.closest("form")).toHaveAttribute("novalidate");
    expect(input).not.toHaveAttribute("minlength");
  });

  it("o servidor recusa por tamanho (400): a MESMA frase no campo, nunca o texto técnico nem código", async () => {
    setup("/reset-senha#token=abc123", { reset: { ok: false, status: 400, error: "newPassword: String must contain at least 10 character(s)" } });
    await typeAndSend("1234567890");
    expect(await screen.findByRole("alert")).toHaveTextContent(PASSWORD_TOO_SHORT_MESSAGE);
    expect(document.body.textContent).not.toMatch(/String must contain|newPassword/);
  });

  it("outra recusa do servidor (link vencido) NÃO mostra o texto do servidor: vira a frase única, e não a do tamanho", async () => {
    setup("/reset-senha#token=abc123", { reset: { ok: false, status: 400, error: "Link inválido ou vencido." } });
    await typeAndSend("1234567890");
    expect(await screen.findByText("Não foi possível redefinir a senha. Confira o e-mail e o link e tente de novo.")).toBeInTheDocument();
    expect(screen.queryByText("Link inválido ou vencido.")).not.toBeInTheDocument();
    expect(screen.queryByText(PASSWORD_TOO_SHORT_MESSAGE)).not.toBeInTheDocument();
  });

  it("UI-PW-06: 'Mostrar senha' alterna o tipo do campo, mantém o valor e usa aria-pressed", async () => {
    setup("/reset-senha#token=abc123");
    const input = (await field()) as HTMLInputElement;
    await userEvent.type(input, "segredo-longo");
    const toggle = screen.getByRole("button", { name: "Mostrar senha" });
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    expect(input.type).toBe("password");
    await userEvent.click(toggle);
    expect(screen.getByRole("button", { name: "Ocultar senha" })).toHaveAttribute("aria-pressed", "true");
    expect(input.type).toBe("text");
    expect(input.value).toBe("segredo-longo");
    await userEvent.click(screen.getByRole("button", { name: "Ocultar senha" }));
    expect(input.type).toBe("password");
    expect(input.value).toBe("segredo-longo");
  });

  it("UI-PW-08: a ordem do Tab é campo, 'Mostrar senha', enviar", async () => {
    setup("/reset-senha#token=abc123");
    const email = await emailField();
    await userEvent.type(email, EMAIL);
    const password = await field();
    await userEvent.type(password, "1234567890");
    password.focus();
    await userEvent.tab();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Mostrar senha" }));
    await userEvent.tab();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Salvar nova senha" }));
  });

  it("aguarda um instante sem quebrar: a página resolve a conferência sem aviso de act", async () => {
    setup("/reset-senha#token=abc123");
    await waitFor(() => expect(screen.getByLabelText("Nova senha")).toBeInTheDocument());
  });
});


// ---- WEB-42 / SEC-29 parte 2 (ST-67, spec 16 §6): confirmar o e-mail DIGITANDO
const REFUSED = "Não foi possível redefinir a senha. Confira o e-mail e o link e tente de novo.";

describe("ResetPasswordPage: confirmação do e-mail por digitação (ST-67)", () => {
  afterEach(() => window.history.replaceState(null, "", "/"));

  it("UI-PW-09: o campo 'Confirme o e-mail desta conta' fica ACIMA da senha, logo depois do bloco de contexto, com a ajuda e sem foco automático", async () => {
    setup("/reset-senha#token=abc123");
    const email = (await emailField()) as HTMLInputElement;
    const password = await field();
    const note = screen.getByRole("note");
    expect(note.compareDocumentPosition(email) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(email.compareDocumentPosition(password) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(email).not.toHaveFocus();
    expect(email.value).toBe(""); // nada preenchido sozinho, nem com a máscara
    const help = screen.getByText("Digite o e-mail completo da conta, como você o usa para entrar.");
    expect((email.getAttribute("aria-describedby") ?? "").split(" ")).toContain(help.id);
    expect(screen.getByText("Digite o e-mail completo da conta, como você o usa para entrar.")).toBeInTheDocument();
  });

  it("o campo é type=email, autocomplete=username e não repete a máscara como exemplo", async () => {
    setup("/reset-senha#token=abc123");
    const email = await emailField();
    expect(email).toHaveAttribute("type", "email");
    expect(email).toHaveAttribute("autocomplete", "username");
    expect(email).not.toHaveAttribute("placeholder");
    expect(screen.queryByPlaceholderText(/@/)).not.toBeInTheDocument();
  });

  it("UI-PW-10: o botão só habilita com e-mail em formato válido E senha de 10 ou mais", async () => {
    setup("/reset-senha#token=abc123");
    const send = await screen.findByRole("button", { name: "Salvar nova senha" });
    expect(send).toBeDisabled();
    await userEvent.type(await field(), "1234567890");
    expect(send).toBeDisabled(); // falta o e-mail
    await userEvent.type(await emailField(), "maria");
    expect(send).toBeDisabled(); // e-mail sem forma de e-mail
    await userEvent.type(await emailField(), "@gmail.com");
    expect(send).toBeEnabled();
    await userEvent.clear(await field());
    await userEvent.type(await field(), "123456789");
    expect(send).toBeDisabled(); // senha com 9
  });

  it("UI-PW-11: o e-mail DIGITADO (sem espaços nas pontas) vai no corpo do envio; a máscara não é comparada na tela (quem decide é o servidor)", async () => {
    const { resetPassword } = setup("/reset-senha#token=abc123");
    // máscara m***@gmail.com e e-mail digitado de OUTRA pessoa do mesmo provedor: a tela envia igual
    await typeAndSend("1234567890", "  mallory@gmail.com  ");
    expect(resetPassword).toHaveBeenCalledWith("abc123", "1234567890", "mallory@gmail.com");
  });

  it("UI-PW-12: recusa (e-mail não bate OU link inválido): a MESMA frase, a senha fica, o e-mail some, o foco volta para ele e o formulário continua", async () => {
    const { resetPassword } = setup("/reset-senha#token=abc123", { reset: { ok: false, status: 400, error: "Link inválido ou vencido." } });
    await typeAndSend("SenhaDigitada1");
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(REFUSED);
    expect(((await emailField()) as HTMLInputElement).value).toBe("");
    expect(await emailField()).toHaveFocus();
    expect(((await field()) as HTMLInputElement).value).toBe("SenhaDigitada1");
    expect(screen.queryByText(/Link inválido —/)).not.toBeInTheDocument(); // a tela cheia só nasce da conferência inicial
    expect(screen.getByRole("button", { name: "Salvar nova senha" })).toBeDisabled(); // sem e-mail de novo
    expect(resetPassword).toHaveBeenCalledTimes(1);
  });

  it("a recusa nunca diz 'e-mail incorreto' (senão o e-mail certo sairia por tentativa e erro) nem repete o texto do servidor", async () => {
    setup("/reset-senha#token=abc123", { reset: { ok: false, status: 400, error: "E-mail incorreto para este link" } });
    await typeAndSend("SenhaDigitada1");
    await screen.findByRole("alert");
    expect(document.body.textContent).not.toMatch(/incorret|não confere|não bate|e-mail errado|inválido ou vencido/i);
    expect(document.body.textContent).not.toContain("E-mail incorreto para este link");
  });

  it("UI-PW-16: qualquer recusa mostra a MESMA frase e o link 'Pedir um novo link' (alvo de 44 px) para o 'Esqueci a senha'", async () => {
    setup("/reset-senha#token=abc123", { reset: { ok: false, status: 400, error: "qualquer coisa do servidor" } });
    await typeAndSend("SenhaDigitada1");
    const link = await screen.findByRole("link", { name: "Pedir um novo link" });
    expect(link).toHaveAttribute("href", "/esqueci-senha");
    expect(link).toHaveClass("auth__link--target");
    expect(screen.getByRole("alert")).toContainElement(link);
  });

  it("recusas de motivos diferentes (e-mail, link vencido, link usado) deixam a tela IDÊNTICA: nada que diferencie", async () => {
    const textos: string[] = [];
    for (const motivo of ["E-mail não confere", "Link inválido ou vencido.", "Link já usado"]) {
      const { unmount } = render(<div />); // isola
      unmount();
      document.body.innerHTML = "";
      setup("/reset-senha#token=abc123", { reset: { ok: false, status: 400, error: motivo } });
      await typeAndSend("SenhaDigitada1");
      await screen.findByRole("alert");
      textos.push(screen.getByRole("alert").textContent ?? "");
      document.body.innerHTML = "";
    }
    expect(new Set(textos).size).toBe(1);
  });

  it("UI-PW-17: depois de várias recusas (o servidor invalida o token após 5) a tela continua igual: sem contador e sem dizer que o link morreu", async () => {
    const { resetPassword } = setup("/reset-senha#token=abc123", { reset: { ok: false, status: 400, error: "erro genérico" } });
    for (let i = 0; i < 5; i++) {
      await userEvent.type(await emailField(), `tentativa${i}@gmail.com`);
      if (i === 0) await userEvent.type(await field(), "SenhaDigitada1");
      await userEvent.click(screen.getByRole("button", { name: "Salvar nova senha" }));
      await screen.findByRole("alert");
    }
    expect(resetPassword).toHaveBeenCalledTimes(5);
    expect(screen.getByRole("alert")).toHaveTextContent(REFUSED);
    expect(document.body.textContent).not.toMatch(/\b[1-5] de 5\b|restam|tentativas restantes|expirou|morreu|inválido/i);
    expect(screen.getByRole("link", { name: "Pedir um novo link" })).toBeInTheDocument();
    // Digita 5 vezes de verdade (~3 s em repouso): o limite padrão de 5 s estourava com a máquina carregada (rodada de 62 s, 17/11).
  }, 30_000);

  it("UI-PW-13: 429 mostra 'Muitas tentativas…', desabilita campos e botão, sem contador e sem o link de refazer", async () => {
    setup("/reset-senha#token=abc123", { reset: { ok: false, status: 429, error: "Too Many Requests" } });
    await typeAndSend("SenhaDigitada1");
    // Espera de 5 s (e não 1 s, o padrão) pelo alerta: com a máquina carregada o envio demorava e o teste falhava sem motivo.
    expect(await screen.findByRole("alert", {}, { timeout: 5000 })).toHaveTextContent("Muitas tentativas. Aguarde alguns minutos e tente de novo.");
    expect(await emailField()).toBeDisabled();
    expect(await field()).toBeDisabled();
    expect(screen.getByRole("button", { name: "Salvar nova senha" })).toBeDisabled();
    expect(screen.queryByRole("link", { name: "Pedir um novo link" })).not.toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/\d+ ?(s|seg|min)\b.*restan/i);
  }, 15_000);

  it("erro do servidor ou da rede (5xx/503) mostra o texto da rede e NÃO acusa e-mail nem link", async () => {
    setup("/reset-senha#token=abc123", { reset: { ok: false, status: 503, error: "Não foi possível conectar ao servidor. Verifique sua internet e tente de novo." } });
    await typeAndSend("SenhaDigitada1");
    expect(await screen.findByText(/Não foi possível conectar ao servidor/)).toBeInTheDocument();
    expect(screen.queryByText(REFUSED)).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Pedir um novo link" })).not.toBeInTheDocument();
    expect(await emailField()).toBeEnabled();
  });

  it("a recusa por TAMANHO da senha segue mostrando a frase do campo e não a frase única", async () => {
    setup("/reset-senha#token=abc123", { reset: { ok: false, status: 400, error: "newPassword: String must contain at least 10 character(s)" } });
    await typeAndSend("1234567890");
    expect(await screen.findByRole("alert")).toHaveTextContent(PASSWORD_TOO_SHORT_MESSAGE);
    expect(screen.queryByText(REFUSED)).not.toBeInTheDocument();
  });

  it("o e-mail digitado não vai para URL, localStorage nem sessionStorage", async () => {
    localStorage.clear();
    sessionStorage.clear();
    setup("/reset-senha#token=abc123", { reset: { ok: false, status: 400, error: "x" } });
    await typeAndSend("SenhaDigitada1", "privado@exemplo.com");
    await screen.findByRole("alert");
    expect(window.location.href).not.toContain("privado");
    expect(JSON.stringify({ ...localStorage, ...sessionStorage })).not.toMatch(/privado|exemplo/);
  });

  it("a ordem do Tab é e-mail, senha, 'Mostrar senha', enviar", async () => {
    setup("/reset-senha#token=abc123");
    const email = await emailField();
    await userEvent.type(email, EMAIL);
    await userEvent.type(await field(), "1234567890");
    email.focus();
    await userEvent.tab();
    expect(document.activeElement).toBe(await field());
    await userEvent.tab();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Mostrar senha" }));
    await userEvent.tab();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Salvar nova senha" }));
  });
});

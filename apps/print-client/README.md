# print-client — módulo de impressão local (MeuCardapio, placeholder)

App WinForms (.NET Framework 4.7.2) que roda no PC do estabelecimento e imprime os pedidos vindos
da **nossa** API (`apps/api`), não do cardapio.ai.

## O que vem da engenharia reversa (reaproveitado) vs. o que é novo

- **Reaproveitado quase integralmente** (técnica genérica, sem marca de terceiros):
  `Printing/TicketRenderer.cs` (parser do subconjunto HTML → linhas), `Printing/ThermalPrinter.cs`
  (impressão GDI+ via `PrintDocument`), `Services/AudioPlayer.cs` (alerta sonoro via COM
  WindowsMediaPlayer). Copiados de `reconstruction/src/CardapioClone` só com o namespace trocado.
- **Novo**: `Services/DeviceClient.cs` (uma única conexão WS com a nossa API + fallback de polling
  REST — substitui a dupla WS 43218/43219 + Cloud Functions do original), `Services/TicketTemplate.cs`
  (nosso próprio layout de tíquete, construído a partir do JSON `PrintableOrder` da API, não do HTML
  do cardapio.ai), `UI/SetupForm.cs` (cola URL da API + "chave de impressora" em vez de login
  email/senha), `Services/AppSettings.cs` (aponta para a nossa API).
- **Não reaproveitado**: nenhuma string/ícone/áudio do binário original. `Audios/` está vazio por
  enquanto — ver Fase 5 do plano para sons/ícone próprios.

## Build

Sem dotnet SDK instalado nesta máquina — usa o mesmo truque do `reconstruction/build.ps1`: MSBuild
4.0 do .NET Framework (já presente no Windows) + compilador Roslyn vendorizado em
`../../../reconstruction/tools/roslyn` (reaproveitado, não duplicado).

```powershell
.\build.ps1            # Release -> bin\Release\MeuCardapio - Impressao.exe
```

## Teste de renderização

Smart App Control bloqueia a execução de EXEs recém-compilados nesta máquina (mesmo problema do
`reconstruction`), então o self-test roda em memória via PowerShell, sem executar o EXE:

```powershell
.\run-selftest.ps1     # compila TicketRenderer+TicketTemplate+SelfTest numa DLL e roda Run()
```

O próprio EXE também expõe o teste quando a execução não está bloqueada: `--selftest`.

## Configuração

Na primeira execução (ou se `%LOCALAPPDATA%\MeuCardapioPrintClient\settings.json` não existir/não
tiver `ApiBaseUrl`+`DeviceToken`), abre uma tela pedindo a URL da API e a "chave de impressora" —
gerada no painel web (`POST /api/device-tokens`, autenticado como dono da loja). Depois disso, o
app conecta direto na API: WS `{api}/ws/device` (tempo real) com fallback de polling
`GET /api/device/orders/pending` a cada 15s.

## Ícone

`Resources/icon.ico` é gerado por `generate-icon.ps1` (desenha um quadrado verde com "M" via
System.Drawing, dentro do processo do powershell — não cria/roda um EXE novo, mesmo truque do
`run-selftest.ps1`). É um **placeholder de marca**, não algo extraído do binário original — troque
o arquivo por um ícone de verdade quando a identidade visual for decidida e rode `build.ps1` de novo.

```powershell
.\generate-icon.ps1    # regera Resources\icon.ico
```

## Auto-update

`Services/Updater.cs` verifica `AppSettings.Current.UpdateBaseUrl` (vazio = desligado, padrão).
Quando configurado, compara `CurrentVersion` (constante em `Updater.cs`, hoje `1.0.0`) contra
`{UpdateBaseUrl}/version.txt`; se houver versão nova, baixa `{UpdateBaseUrl}/MeuCardapio-PrintClient-Setup.exe`
e executa. Checagem roda ao abrir o app (silenciosa) e também pelo menu da bandeja
("Verificar atualizações"). **Isso aponta para um servidor de downloads NOSSO** — não existe
ainda; para ativar, publique os dois arquivos (instalador + `version.txt` com a versão) em algum
domínio/CDN próprio e grave a URL em `UpdateBaseUrl` nas settings (ou exponha um campo na tela de
configuração, hoje só editável manualmente no `settings.json`).

## Instalador (Inno Setup)

`installer.iss` empacota o EXE + DLLs num instalador com atalho no Menu Iniciar, opção de iniciar
com o Windows (`/autostart`) e desinstalador. Requer o [Inno Setup 6](https://jrsoftware.org/isinfo.php)
(`winget install JRSoftware.InnoSetup`).

```powershell
.\build.ps1                                                        # gera bin\Release\...exe
& "$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe" .\installer.iss   # gera bin\Installer\MeuCardapio-PrintClient-Setup.exe
```

### Guia de instalação para um lojista novo

1. Baixe e rode `MeuCardapio-PrintClient-Setup.exe` no PC do balcão/cozinha.
2. Marque "Iniciar automaticamente com o Windows" (vem marcado por padrão) se o PC ficar sempre ligado.
3. Na primeira abertura, cole a URL da API (ex. `https://api.sualoja.com`) e a "chave de impressora"
   gerada no painel (Conta → ainda não tem tela dedicada; gerar via `POST /api/device-tokens`
   autenticado como dono — ver `apps/api/src/routes/deviceTokens.ts`).
4. Escolha a impressora térmica instalada no Windows e o som de alerta.
5. Pedidos novos tocam o som, mostram um toast e imprimem automaticamente.

## Log e erros

`Services/Logger.cs` grava em `%LOCALAPPDATA%\MeuCardapioPrintClient\logs\print-client.log`
(rotaciona pra `.log.old` ao passar de 5 MB) — todo `StatusChanged` do `DeviceClient` (conexão,
token revogado, etc.) e todo resultado de impressão vão pra lá. `Program.cs` também loga qualquer
exceção não tratada (`Application.ThreadException` / `AppDomain.UnhandledException`) antes do
processo cair, em vez de o ícone simplesmente desaparecer da bandeja sem explicação.

Se a impressão falhar (impressora desconectada, sem papel, etc.), o pedido **não** é marcado como
impresso — ele continua pendente e volta a aparecer no próximo poll (15s) ou no próximo "cheque
agora" do WebSocket, em vez de desaparecer da fila pra sempre.

## Pendências conhecidas

- Servidor de downloads para o auto-update (`UpdateBaseUrl`) ainda não existe — hoje é só o mecanismo
  cliente, testado com a checagem desligada (URL vazia).
- Tela de configuração para `UpdateBaseUrl` (hoje só via edição manual do `settings.json`).
- Ícone/sons são placeholders — troque antes de distribuir pra clientes de verdade.
- Teste real com impressora térmica física (só validado até aqui via self-test + payload JSON da API).

## Confiabilidade e segredos (PC-02)

- **Dedupe e ack persistido** (`Services/PrintLedger.cs`, arquivo `%LOCALAPPDATA%\MeuCardapioPrintClient\printed.json`): polling e WS passam pelo mesmo portão, um pedido nunca é impresso duas vezes, e se o aviso à API falhar o ack é repetido sem reimprimir. Falha de impressão volta com recuo (15 s até 5 min) e sem novo alerta sonoro.
- **Timeouts:** HTTP 15 s, conexão WS 10 s, keep-alive do WS 20 s.
- **Chave de impressora protegida por DPAPI** (`Services/SecretStore.cs`): o `settings.json` guarda só `DeviceTokenProtected`. Settings antigos com `DeviceToken` em texto puro são migrados e regravados na primeira abertura. Se o arquivo for copiado para outro usuário/PC, a chave não abre e o app pede a chave de novo.
- Teste em worktree: `.\run-selftest.ps1 -ReconRoot "<caminho>\reconstruction"`.

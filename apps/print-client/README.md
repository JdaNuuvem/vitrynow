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

Sem dotnet SDK: MSBuild 4.0 do .NET Framework (já presente no Windows) + compilador Roslyn **4.8.0
oficial da Microsoft**, baixado do NuGet na primeira execução para `tools\roslyn` (ignorado pelo git),
com o SHA-256 do pacote fixado em `tools\toolchain.ps1` e a assinatura Authenticode do `csc.exe`
conferida. Bibliotecas (HtmlAgilityPack, Newtonsoft.Json) ficam em `libs\` com hashes em
`libs\SHA256SUMS` (conferidos a cada build). **Nada depende de `reconstruction/`.**

```powershell
.\build.ps1                          # Release -> bin\Release\MeuCardapio - Impressao.exe (+ SHA256)
.\build.ps1 -RoslynDir <pasta>       # offline: pasta que contenha tasks\net472\csc.exe
```

**Build reprodutível:** `/deterministic` + `/pathmap` (via `obj\pathmap.rsp`). A mesma fonte gera o mesmo
SHA-256 em qualquer pasta (verificado: duas pastas diferentes, mesmo hash).

## Teste de renderização

Smart App Control bloqueia a execução de EXEs recém-compilados nesta máquina (mesmo problema do
`reconstruction`), então o self-test roda em memória via PowerShell, sem executar o EXE:

```powershell
.\run-selftest.ps1     # compila o núcleo testável + SelfTest numa DLL e roda Run() (124 checagens)
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

## Auto-update (PC-04, PC-11, B17)

`Services/Updater.cs` + `UpdateVerifier.cs` + `UpdateState.cs` + `UpdateTransport.cs`. Desligado quando `UpdateBaseUrl`
(settings.json) está vazio. Servidor de downloads **nosso**, três arquivos lado a lado:

| Arquivo | Conteúdo |
|---|---|
| `latest.json` | `version`, `file`, `sha256`, `size`, **`keyId`**, **`issuedAt`**, **`validUntil`**, `minVersion` (opcional), `revokeKeys` (opcional) |
| `latest.json.sig` | assinatura RSA-SHA256 (base64) dos bytes exatos do `latest.json` |
| `<file>` | o instalador `.exe` citado no manifesto |

O app só executa o instalador se **todas** as regras valerem; qualquer falha descarta tudo e nada roda:
- URL `https://` (`http://` só em localhost, para teste); sem usuário/senha/query; sem seguir redirecionamento.
- **Duas chaves públicas embutidas** (`UpdateKeys.Trusted`: `k1` primária, `k2` reserva guardada offline); o `keyId` do manifesto
  escolhe a chave e a assinatura tem de conferir com ela (RSA ≥ 3072). Não existe chave no `settings.json`. **Sem chave embutida o
  app recusa tudo** (estado atual; a custódia das chaves é do Claudio, CL-10, ver `nightingale\guia-chave-release.md`).
- **Revogação:** um manifesto assinado pela reserva pode trazer `revokeKeys` (ex.: `["k1"]`); o app grava em
  `update-state.json` e nunca mais aceita aquela chave. Uma chave só revoga chaves **anteriores** da lista (a reserva revoga a
  primária; a primária não revoga a reserva) e nunca a si mesma. Perdeu/vazou a primária: assine com a reserva.
- **Frescor:** `issuedAt` nunca menor que o último aceito (anti-replay de manifesto antigo, mesmo assinado). Passou de
  `validUntil` (janela de 60 dias por padrão, máx. 400) ou o relógio do PC está atrasado em mais de 1 dia ⇒ "não consegui confirmar
  atualizações": **não instala e não mexe na impressão**. Datas só no formato `2026-11-16T12:00:00Z`.
- **`minVersion`:** app abaixo dela recebe "atualização obrigatória" (e, se o download falhar, o aviso de que a versão não é mais
  suportada); `Required` fica disponível para a UI.
- Versão do manifesto **estritamente maior** que a do app (sem downgrade). Nome do arquivo `[A-Za-z0-9._-]+.exe`, sem caminho nem nome
  reservado do Windows; tamanho ≤ 200 MB; SHA-256 e tamanho conferidos **antes** de executar e **de novo** pelo handle aberto
  (`FileShare.Read`) no instante do `Process.Start`. Baixa para `%LOCALAPPDATA%\MeuCardapioPrintClient\updates\`.

Publicar um release (**só o Claudio**, na máquina dele; a chave privada fica fora do repositório e o script recusa caminho dentro dele):

```powershell
.\tools\new-update-key.ps1 -OutPrivate C:\Cofre\k1.updkey.xml -KeyId k1    # uma vez; idem k2 (reserva). Cole a linha impressa em UpdateKeys.cs
.\tools\sign-update.ps1 -Installer .\bin\release\MeuCardapioPrintClient-1.1.0.exe -Version 1.1.0 -KeyId k1 `
    -PrivateKeyFile C:\Temp\k1.updkey.xml -OutDir .\bin\release-1.1.0 [-ValidDays 60] [-MinVersion 1.0.0]   # revoga: -KeyId k2 -RevokeKeys k1
.\tools\verify-release.ps1 -ReleaseDir .\bin\release-1.1.0                  # roda o MESMO código de decisão do app; exit 0 = o app aceitaria
```

Limites conhecidos: a assinatura do instalador pelo Windows (Authenticode/SmartScreen) é outra camada (PC-09, só com build final e
aval do Claudio); a chave privada não é cifrada pelo script (proteja o arquivo conforme o guia); o app não pergunta antes de instalar
(instalação fora do expediente/confirmação fica como melhoria).

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

- Servidor de downloads para o auto-update (`UpdateBaseUrl`) e a **chave de release** (custódia) ainda não existem:
  o mecanismo está pronto e testado, mas recusa tudo sem chave embutida.
- Tela de configuração para `UpdateBaseUrl` (hoje só via edição manual do `settings.json`).
- Ícone/sons são placeholders — troque antes de distribuir pra clientes de verdade.
- Teste real com impressora térmica física (só validado até aqui via self-test + payload JSON da API).

## Confiabilidade e segredos (PC-02)

- **Dedupe e ack persistido** (`Services/PrintLedger.cs`, arquivo `%LOCALAPPDATA%\MeuCardapioPrintClient\printed.json`): polling e WS passam pelo mesmo portão, um pedido nunca é impresso duas vezes, e se o aviso à API falhar o ack é repetido sem reimprimir. Falha de impressão volta com recuo (15 s até 5 min) e sem novo alerta sonoro.
- **Timeouts:** HTTP 15 s, conexão WS 10 s, keep-alive do WS 20 s.
- **Chave de impressora protegida por DPAPI** (`Services/SecretStore.cs`): o `settings.json` guarda só `DeviceTokenProtected`. Settings antigos com `DeviceToken` em texto puro são migrados e regravados na primeira abertura. Se o arquivo for copiado para outro usuário/PC, a chave não abre e o app pede a chave de novo.
- Teste em worktree: `.\run-selftest.ps1` (sem parâmetros; `-ReconRoot` foi aposentado, o build não usa mais `reconstruction/`).
- **URL da API:** `http://` só para `localhost`, `127.0.0.1` e `::1`; qualquer outro servidor exige `https://` (`Services/ApiUrlPolicy.cs`). Settings antigos com URL insegura caem em "não configurado". Sem redirecionamento automático (o Bearer não segue para outro host).
- **Gravação de `settings.json` atômica** (`.tmp` + `File.Replace`). Se a migração do token em texto puro não puder regravar, o app avisa e tenta de novo a cada abertura; se migrar, avisa para gerar uma chave nova no painel (a antiga já ficou em texto puro).
- **Tela de configuração:** a chave é mascarada e nunca preenchida com o valor salvo; campo em branco mantém a chave atual. Menu da bandeja: "Configurar chave...".
- **Limite da proteção DPAPI:** protege contra **cópia do arquivo** para outro usuário/PC. Não protege contra malware rodando na própria conta do Windows.

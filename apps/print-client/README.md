# print-client — módulo de impressão local (MeuCardapio, placeholder)

App WinForms (.NET Framework 4.7.2) que roda no PC do estabelecimento e imprime os pedidos vindos
da **nossa** API (`apps/api`), não do cardapio.ai.

## Origem do código (PC-12)

- **Próprio, sem derivar do `reconstruction/`:** o modelo do tíquete (`Printing/TicketDocument.cs`), o montador a partir do
  `PrintableOrder` (`TicketBuilder.cs`), a quebra de linha e a sanitização (`TicketText.cs`), o desenho em colunas
  (`TextTicketWriter.cs`), o desenho GDI+ (`GdiTicketPainter.cs`, `GdiPrintTarget.cs`), a impressora virtual
  (`VirtualPrintTarget.cs`), `PrintCoordinator`, `DeviceClient`, `PrintLedger`, `Updater`. O tíquete **não é mais HTML**: sumiram o
  parser, o HtmlAgilityPack e os comandos embutidos no texto (`LARGURA`, `--QUEBRA--`) que vinham do módulo do terceiro.
- **Ainda derivado do `reconstruction/` (pendente, PC-14):** `Services/AudioPlayer.cs` (alerta sonoro via Windows Media Player COM).
  Decisão de marca/origem é do Claudio (CL-05); até lá não distribuir instalador.
- `Services/DeviceClient.cs` + `UI/SetupForm.cs` + `Services/AppSettings.cs`: conexão (WS + polling) e configuração com a **nossa** API.

## Build

Sem dotnet SDK: MSBuild 4.0 do .NET Framework (já presente no Windows) + compilador Roslyn **4.8.0
oficial da Microsoft**, baixado do NuGet na primeira execução para `tools\roslyn` (ignorado pelo git),
com o SHA-256 do pacote fixado em `tools\toolchain.ps1` e a assinatura Authenticode do `csc.exe`
conferida. Biblioteca (Newtonsoft.Json) ficam em `libs\` com hashes em
`libs\SHA256SUMS` (conferidos a cada build). **Nada depende de `reconstruction/`.**

```powershell
.\build.ps1                          # Release -> bin\Release\MeuCardapio - Impressao.exe (+ SHA256)
.\build.ps1 -RoslynDir <pasta>       # offline: pasta que contenha tasks\net472\csc.exe
```

**Build reprodutível:** `/deterministic` + `/pathmap` (via `obj\pathmap.rsp`). A mesma fonte gera o mesmo
SHA-256 em qualquer pasta (verificado: duas pastas diferentes, mesmo hash).

## Testes e harness SEM impressora (QA-06 / PC-12)

O Smart App Control bloqueia EXE novo, então tudo roda em memória via PowerShell, sem abrir o EXE:

```powershell
.\run-selftest.ps1          # compila o núcleo + testes em DLL e roda (230 checagens)
.\tools\preview-ticket.ps1 -OutDir $env:TEMP\previa    # grava tíquetes de exemplo (.txt + .png) em 58 e 80 mm na impressora virtual
```

O que o selftest cobre:
- **Tíquete:** modelo, quebra de linha (palavra gigante, emoji, acento combinado, recuo), sanitização (ESC/GS/BEL/bidi nunca viram comando;
  emoji não sai no papel), 32 colunas (58 mm) e 48 (80 mm), PNG da impressora virtual, e **golden files** em `tests\golden\`
  (3 pedidos × 58/80 mm). Mudou o layout de propósito? `$env:PC_UPDATE_GOLDEN = "1"; .\run-selftest.ps1` e **revise o diff no git**.
- **Harness do pipeline inteiro** (`SelfTestHarness.cs`): `DeviceClient` real → `PrintCoordinator` → `VirtualPrintTarget`, contra uma API
  falsa em loopback (inclui WebSocket de verdade): impressora **offline**, **sem papel**, **queda no meio do tíquete** (sobra um pedaço
  parcial, como no papel), **polling + WS** ao mesmo tempo com impressora lenta (1 tíquete), **app fechado entre imprimir e avisar a API**
  (reabre, não reimprime, envia o aviso), API fora do ar (503), pedido cancelado durante a falha, bobina de 80 mm.
- **Não cobre** (roteiro manual em `docs\roteiro-impressora-real.md`, item de aceite pendente do G3): spooler/driver reais, papel,
  guilhotina, fonte da impressora, instalador/SmartScreen.

**Impressora virtual no app:** preencha `VirtualPrinterFolder` no `settings.json` e os tíquetes vão para essa pasta (`.txt` + `.png`) em vez
da impressora, para conferir o layout sem gastar bobina. Antes de imprimir de verdade o app pergunta ao Windows (WMI) se a impressora
escolhida está offline/sem papel/tampa aberta e, se estiver, trata como falha (o pedido volta pelo recuo e aparece em "sem imprimir").

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

## Auto-update (PC-04, B17)

`Services/Updater.cs` + `UpdateVerifier.cs` + `UpdateTransport.cs`. Desligado quando `UpdateBaseUrl`
(settings.json) está vazio. Servidor de downloads **nosso**, três arquivos lado a lado:

| Arquivo | Conteúdo |
|---|---|
| `latest.json` | `{"version","file","sha256","size"}` |
| `latest.json.sig` | assinatura RSA-SHA256 (base64) dos bytes exatos do `latest.json` |
| `<file>` | o instalador `.exe` citado no manifesto |

O app só executa o instalador se **todas** as regras valerem; qualquer falha descarta tudo e nada roda:
- URL `https://` (`http://` só em localhost, para teste); sem usuário/senha/query; sem seguir redirecionamento.
- Assinatura do manifesto confere com a **chave pública embutida no binário** (`UpdateKeys.PublicKeyXml`,
  RSA ≥ 3072). Não existe chave no `settings.json`: quem edita o arquivo não troca a chave.
  **Sem chave embutida o app recusa tudo** (padrão atual até o Claudio decidir a custódia da chave).
- Versão do manifesto **estritamente maior** que a do app (manifesto antigo/replay não faz downgrade).
- Nome do arquivo `[A-Za-z0-9._-]+.exe`, sem caminho; tamanho ≤ 200 MB; SHA-256 e tamanho do arquivo baixado
  conferem com o manifesto assinado. Baixa para `%LOCALAPPDATA%\MeuCardapioPrintClient\updates\` (pasta do
  usuário, não `%TEMP%`); `.part` apagado em qualquer falha.

Publicar um release (a chave privada fica **fora do repositório**; o script recusa caminho dentro dele):

```powershell
.\tools\new-update-key.ps1 -OutPrivate D:\segredos\mc-release.updkey.xml   # uma vez; cole a chave pública em UpdateKeys.cs
.\tools\sign-update.ps1 -Installer .\bin\Installer\MeuCardapio-PrintClient-Setup.exe -Version 1.1.0 `
    -PrivateKeyFile D:\segredos\mc-release.updkey.xml -OutDir .\bin\release-1.1.0   # suba os 3 arquivos para UpdateBaseUrl
```

Limites conhecidos: não há expiração do manifesto (um servidor malicioso pode *congelar* o cliente servindo um
manifesto antigo, mas não instalar nada); a assinatura do instalador pelo Windows (Authenticode/SmartScreen) é
outra camada (PC-09, só com build final e aval do Claudio); `CurrentVersion` está em `Updater.cs`, em
`installer.iss` e no csproj (manter juntos até haver fonte única).

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
- Ícone/sons são placeholders — troque antes de distribuir pra clientes de verdade. `AudioPlayer.cs` ainda deriva do `reconstruction/` (PC-14).
- Teste real com impressora térmica física (só validado até aqui via self-test + payload JSON da API).

## Resiliência (PC-05, PC-06)

- **Chave recusada (PC-05, V1 da Nightingale):** só vira "PAUSADA" com 3+ recusas 401/403 **seguidas que abranjam 2 min** (polling, WS ou ack; qualquer resposta boa zera), para que um 401 de proxy/WAF/portal cativo da loja não pare a cozinha. Fechamento do WS com código **4401** (servidor revogou a chave, NG-06) pausa na hora. Pausado: faixa vermelha + balão e **sonda a cada 5 min**; com 200 volta sozinho (`KeyRestored`). "Configurar chave..." vale na hora (o token é lido a cada requisição) e dispara uma sonda imediata; só mudança de **URL** da API exige reabrir o app. Redirecionamento (30x) não é seguido e não conta como recusa.
- **Gravação antes de tudo (PC-06 a):** depois de imprimir, `RecordPrinted` grava no disco de forma síncrona, antes de toast,
  log ou rede; só o aviso à API roda em outra thread. Queda do app entre imprimir e avisar não reimprime.
- **Watchdog (PC-06 b):** pedido "em impressão" há mais de 2 min (ciclo da UI perdido) vira falha com recuo e passa a aparecer
  como "sem imprimir"; não fica preso até reiniciar.
- **Indicador "N pedidos sem imprimir" (PC-06 d):** faixa fixa na janela e texto do ícone, com os números dos pedidos. O balão
  aparece só quando entra um pedido **novo** com problema (nunca a cada tentativa). Some quando o pedido é impresso ou quando a
  API deixa de listá-lo (cancelado/impresso em outro PC). Sobrevive ao reinício do app.
- Testes: `SelfTestDeviceClient.cs` roda o `DeviceClient` real contra uma API falsa em loopback (dedupe, ack que falha e repete,
  indicador sem repetição, 401/403, 401 isolado, redirecionamento).

## Confiabilidade e segredos (PC-02)

- **Dedupe e ack persistido** (`Services/PrintLedger.cs`, arquivo `%LOCALAPPDATA%\MeuCardapioPrintClient\printed.json`): polling e WS passam pelo mesmo portão, um pedido nunca é impresso duas vezes, e se o aviso à API falhar o ack é repetido sem reimprimir. Falha de impressão volta com recuo (15 s até 5 min) e sem novo alerta sonoro.
- **Timeouts:** HTTP 15 s, conexão WS 10 s, keep-alive do WS 20 s.
- **Chave de impressora protegida por DPAPI** (`Services/SecretStore.cs`): o `settings.json` guarda só `DeviceTokenProtected`. Settings antigos com `DeviceToken` em texto puro são migrados e regravados na primeira abertura. Se o arquivo for copiado para outro usuário/PC, a chave não abre e o app pede a chave de novo.
- Teste em worktree: `.\run-selftest.ps1` (sem parâmetros; `-ReconRoot` foi aposentado, o build não usa mais `reconstruction/`).
- **URL da API:** `http://` só para `localhost`, `127.0.0.1` e `::1`; qualquer outro servidor exige `https://` (`Services/ApiUrlPolicy.cs`). Settings antigos com URL insegura caem em "não configurado". Sem redirecionamento automático (o Bearer não segue para outro host).
- **Gravação de `settings.json` atômica** (`.tmp` + `File.Replace`). Se a migração do token em texto puro não puder regravar, o app avisa e tenta de novo a cada abertura; se migrar, avisa para gerar uma chave nova no painel (a antiga já ficou em texto puro).
- **Tela de configuração:** a chave é mascarada e nunca preenchida com o valor salvo; campo em branco mantém a chave atual. Menu da bandeja: "Configurar chave...".
- **Limite da proteção DPAPI:** protege contra **cópia do arquivo** para outro usuário/PC. Não protege contra malware rodando na própria conta do Windows.

## Conteúdo do tíquete (PC-07, B4)

Ordem da spec B4.1: loja, `PEDIDO #código`, tipo em destaque (ENTREGA/RETIRADA/MESA), "2ª VIA (n)" quando `reprintCount > 0`, data e hora
(a API manda ISO em UTC; sai `dd/MM/aaaa HH:mm` no fuso do computador até a API informar o da loja), cliente, itens, observação,
valores e bloco de pagamento (B4.2). A linha do item mostra produto x quantidade e cada adicional mostra extra x quantidade com o "(Nx)" escrito (`+ Borda catupiry (2x)  +R$ 16,00`), então a coluna de valores soma exatamente o subtotal.

- **Já com o contrato de hoje:** taxa de entrega, gorjeta, forma de pagamento (DINHEIRO, PIX, CREDITO, DEBITO, VR, VA ou nula), desconto **derivado**
  (soma das linhas + taxa + gorjeta - total, sem código de cupom). **Fail-safe do PIX:** "PAGO ONLINE (PIX) - NÃO COBRAR" só com prova (`paymentStatus` = APROVADO); PIX sem prova (ex.: pedido manual com PIX presencial) imprime "PIX - CONFERIR NA HORA". Enquanto a API não enviar `paymentStatus`, todo PIX sai "conferir na hora" (seguro, mas conservador).
- **Opcionais que a API-14 vai enviar** (já aceitos pelo `PrintableOrder`): `subtotalCents`, `discountCents`, `couponCode` (vira "Desconto (BEM10)"),
  `changeForCents` (vira "TROCO PARA / LEVAR DE TROCO"), `reprintCount`, `paymentStatus`, `tableLabel` ("Mesa 12" => "MESA 12" no topo).
- Bloco de pagamento: PIX => `PAGO ONLINE (PIX) - NÃO COBRAR`; dinheiro => `COBRAR R$ X EM DINHEIRO` (+ troco em linhas separadas); cartão (crédito/débito/VR/VA);
  balcão sem forma => `COBRAR NO CAIXA`; mesa => `PAGAMENTO NA MESA`; sem forma => `FORMA DE PAGAMENTO NÃO INFORMADA`.
- **Ainda não:** aviso "PEDIDO #xxxx CANCELADO" e o trabalho de reimpressão (precisam do `PrintJob`, PC-03/API-12/API-14), número da mesa só quando a API enviar `tableLabel`,
  bairro/referência separados do endereço, opções agrupadas (B8).

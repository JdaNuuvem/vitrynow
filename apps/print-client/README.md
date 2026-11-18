# print-client — módulo de impressão local (MeuCardapio, placeholder)

App WinForms (.NET Framework 4.7.2) que roda no PC do estabelecimento e imprime os pedidos vindos
da **nossa** API (`apps/api`), não do cardapio.ai.

## Origem do código (PC-12)

- **Próprio, sem derivar do `reconstruction/`:** o modelo do tíquete (`Printing/TicketDocument.cs`), o montador a partir do
  `PrintableOrder` (`TicketBuilder.cs`), a quebra de linha e a sanitização (`TicketText.cs`), o desenho em colunas
  (`TextTicketWriter.cs`), o desenho GDI+ (`GdiTicketPainter.cs`, `GdiPrintTarget.cs`), a impressora virtual
  (`VirtualPrintTarget.cs`), `PrintCoordinator`, `DeviceClient`, `PrintLedger`, `Updater`. O tíquete **não é mais HTML**: sumiram o
  parser, o HtmlAgilityPack e os comandos embutidos no texto (`LARGURA`, `--QUEBRA--`) que vinham do módulo do terceiro.
- **Alerta sonoro próprio (PC-14):** `Services/AlertSounds.cs` gera os sons e `AudioPlayer.cs` usa `SoundPlayer`; não sobra código derivado do
  `reconstruction/`. `tools\scan-identity.ps1` confere isso (e nome/domínio do terceiro) no código, no EXE e no instalador a cada `build-installer.ps1`.
  Nome/marca final é decisão do Claudio (CL-05); até lá o nome é placeholder.
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

**A atualização nunca instala sozinha (PC-13).** O app verifica e baixa em segundo plano (ao abrir e pelo menu "Verificar atualizações"; não há verificação periódica),
confere assinatura e SHA-256 e só então **avisa** (balão + item "Instalar atualização X..." no menu do ícone). O instalador só roda depois do "sim" do lojista, numa pergunta que mostra a
versão e o início do SHA-256 já conferidos; o arquivo é **reverificado pelo mesmo handle aberto** no instante de executar (U1). "Não agora", ou fechar o app, **apaga o instalador baixado**
(nada executável fica esperando em disco; a próxima verificação baixa de novo, uma vez). `minVersion` (versão obrigatória) **só avisa com texto mais forte e oferece**: continua pedindo confirmação.
Instalar só "fora do expediente" não foi feito (o app não conhece o horário da loja): a confirmação do lojista cobre o horário de pico.

**Chave de release com senha (PC-13, PC-13b).** `new-update-key.ps1` grava a chave privada **cifrada** (`.updkey`, formato versionado `MCUK` **v2**: uma única derivação PBKDF2-HMAC-SHA256 de 32 bytes com
600 000 iterações, da qual saem por HMAC ("enc"/"mac") a chave AES-256-CBC e a do HMAC-SHA256, conferido **antes** de decifrar; senha mínima de 12 caracteres; o v1, só de teste e com derivação mais fraca, não é
aceito). A senha é pedida **por prompt seguro, duas vezes**; não existe parâmetro de senha em texto nem variável de ambiente, e sem console o script **falha** (não grava texto puro em silêncio).
`-NoPassword` grava XML puro com aviso (escolha consciente) e o `sign-update.ps1` **recusa** chave em texto puro (só com `-AllowPlainKey`, desaconselhado). `sign-update.ps1` pede a senha, decifra só em memória,
reverifica a assinatura e solta a chave (limite honesto: o XML decifrado é uma string do .NET, que o PowerShell não consegue apagar da memória; buffers de bytes e chaves derivadas são zerados). **Perdeu a senha = perdeu a chave.**
Teste: `.\tools\test-keyfile.ps1` (32 checagens: ida e volta, senha errada, adulteração, truncado, senha curta, não sobrescreve, sem console, texto puro recusado, release assinado aceito pelo código do app e
um cálculo **independente** do PBKDF2 que confere o arquivo gerado). Se uma verificação posterior apagar o instalador pendente (a pasta de atualizações é limpa quando acha versão nova), a tela esconde
"Instalar atualização" e explica o motivo; nada executa.

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

### Ao desinstalar ou trocar de computador

A desinstalação **não apaga** `%LOCALAPPDATA%\MeuCardapioPrintClient` (a chave de impressora protegida, o registro de impressos e os logs ficam). Quem sai de um computador deve,
**no painel, usar "Substituir impressora"** (Impressoras): ela revoga a chave antiga (a esquecida no disco deixa de valer) e emite a nova para o computador novo, em um passo só e sem passar do
limite de impressoras do plano. Depois cole a chave nova em "Configurar chave..." no computador novo. Para apagar os dados locais do computador antigo, exclua essa pasta depois de desinstalar.

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
- Ícone/sons são placeholders — troque antes de distribuir pra clientes de verdade. Os sons "Sino" e "Padrão" são gerados pelo app.
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

## Limites e defesas no papel (PC-15)

- **Corte nunca é silencioso (segurança alimentar):** quando uma observação (do pedido ou do item), o endereço ou o nome de um item passa de 300 caracteres, o papel imprime em
  negrito, logo depois, `(observação cortada — ver no painel)` (ou `endereço cortado` / `nome do item cortado`); os itens escondidos saem como `... e mais N itens (ver no painel)`.
  O começo do texto (onde costuma estar "ALERGIA A ...") continua impresso.

- **Teto de tamanho:** nome, endereço, observação e demais textos do servidor saem com no máximo **300 caracteres** + "…" (sem partir emoji nem letra com acento);
  no máximo **80 itens** e **12 adicionais por item** no papel. O que passa disso vira uma linha "... e mais N itens (ver no painel)" / "+ mais N adicionais" **com o valor somado**,
  então a coluna continua somando o subtotal e o TOTAL fica certo. Texto de megabytes não é varrido inteiro.
- **Sanitização extra:** saem U+061C, U+2060, U+180E, U+034F, U+FFF9-FFFC, uso privado (U+E000-F8FF e planos 15/16) e substitutos soltos; no máximo 2 marcas combinantes por letra ("zalgo").
  Teste de propriedade com 3 000 textos aleatórios (seed fixa): saída sem caractere proibido, `Sanitize` idempotente, sem exceção.
- **Consulta WMI da impressora:** timeout de 3 s na enumeração e teto de 5 s no total (acima disso vale "desconhecido" e a impressão segue), cada objeto liberado.
  A consulta é de **voo único**: se uma está presa, a próxima volta "desconhecido" na hora, sem criar outra tarefa. Imprimir e consultar rodam **fora da thread da interface** e uma impressão por vez (tíquetes nunca se misturam).

## Modo PrintJob (PC-03, ADR-0004)

O cliente consome a fila de **jobs** (claim com lease + ack) quando a loja está no modo `QUEUE`, e `/api/device/orders/pending` no modo `LEGACY`. **Quem decide o modo é o servidor, por loja** (PC-18, ADR-0004 §8 itens 12-13): o cliente
segue o servidor a cada ciclo (o `claim` devolve `mode`; o endpoint legado responde `409 MODE_QUEUE` quando a loja virou para a fila) e **nunca mistura os dois** na virada. `"UsePrintJobs"` no `settings.json` é só um interruptor de
desenvolvimento (padrão `false` = começa no legado). Contrato conferido contra a API-12 real em `docs\contrato-printjob-cliente.md` e `docs\conferencia-cruzada-api12.md`; plano de virada em `docs\plano-virada-printjobs.md`.

- O servidor decide o que imprimir; o cliente obedece. Um job por vez, no máximo 20 por ciclo.
- Dedupe local **por job** (`job:<id>`): original e 2ª via do mesmo pedido são jobs diferentes. Job já impresso que o servidor oferece de novo (ack perdido, lease vencida) **não reimprime**: só reenvia `PRINTED`.
- **Não faz claim enquanto há job em impressão ou em recuo de falha:** não segura job que não vai imprimir (outra impressora pode pegar) e não reclama o mesmo job se a impressão passar da lease.
- Falha de impressão: ack `FAILED` com **só um código de lista fechada** (`PRINTER_OFFLINE`, `NO_PAPER`, `DRIVER_ERROR`, `PRINTER_NOT_FOUND`, `OTHER`) e uma frase fixa nossa (melhor esforço); a mensagem detalhada da exceção (pode ter nome de impressora, caminho ou usuário do Windows) fica **só no log local** + indicador "sem imprimir" + recuo local. `PRINTED` perdido por rede fica **pendente em disco** e é repetido; `409` (lease vencida) e `404` encerram sem repetir.
- Tipos: `ORDER_KITCHEN` (com alerta sonoro), `ORDER_REPRINT` (2ª via, aviso de cancelamento via `cancelNotice`) e `TEST` (tíquete de teste próprio com acentos e régua de colunas). Tipo desconhecido (`TAB_BILL` é do PC-08) ⇒ `FAILED`.
- Teste: `SelfTestJobs.cs` roda o `DeviceClient` real contra uma API falsa que implementa lease, ack idempotente, 409 e attempts (feliz, fila vazia, offline, 2ª via/cancelamento/teste, tipo desconhecido,
  lease vencida, re-oferta, ack com falha + reinício, duas impressoras, chave recusada, recuo sem laço quente, impressora com defeito não segura o job, padrão legado intacto).

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
  (soma das linhas + taxa + gorjeta - total, sem código de cupom). **Fail-safe do PIX:** "PAGO ONLINE (PIX) - NÃO COBRAR" só com prova (`paymentStatus` = PAGO); PIX sem prova (A_COBRAR, ausente, pedido manual com PIX presencial) imprime "PIX - CONFERIR NA HORA"; ESTORNADO imprime "PIX ESTORNADO - CONFERIR NA HORA". Enquanto a API não enviar `paymentStatus`, todo PIX sai "conferir na hora" (seguro, mas conservador).
- **Contrato fechado no ADR-0004 §6** (Turing entrega na API-14; o cliente já aceita): `paymentStatus` (`PAGO`/`A_COBRAR`/`ESTORNADO`), `tableLabel`, `changeForCents`,
  `subtotalCents`, `discountCents`, `couponCode`, `reprintCount`, `printedAtOriginal` ("1ª impressão: ..." na 2ª via), `cancelNotice` e `ticketSchemaVersion`.
  Campos que o cliente não conhece são ignorados (cliente antigo não quebra). Valor antigo `APROVADO` **não** vale como prova: só `PAGO`.
- **Aviso de cancelamento** (`cancelNotice: true`, CA-B4-09): imprime só "PEDIDO #n CANCELADO / NÃO PREPARAR / NÃO ENTREGAR", tipo ou mesa, cliente e hora; sem itens, valores,
  endereço, telefone ou pagamento, e **não** reimprime o tíquete original.
- Bloco de pagamento: **total zero => `SEM COBRANÇA: NADA A COBRAR`** (cupom que cobre o pedido inteiro; decidido pelo **total**, qualquer `paymentStatus` ou forma de pagamento, inclusive na 2ª via; só quando a **aritmética fecha**: `totalCents` PRESENTE e igual a 0 (ausente não é zero), desconto igual ao valor dos itens, sem taxa de entrega nem gorjeta, e o subtotal informado batendo com a soma dos itens; qualquer divergência segue a regra normal, que COBRA. **Campo `nothingToCharge` do servidor (API-66, schema 3; fonte única):** quando PRESENTE ele MANDA: `false` ⇒ regra normal (cobra), mesmo que a aritmética local desse zero (há pagamento vivo); `true` ⇒ "SEM COBRANÇA" só com o total PRESENTE e igual a 0 (cinto sempre); `true` com total diferente de 0 ou ausente ⇒ regra normal (cobra) e AVISO no log; valor PRESENTE e não booleano (`1`, `"false"`, `"lixo"`...) é dado corrompido ⇒ regra normal (cobra) + AVISO no log; AUSENTE ou `null` (API antiga) ⇒ a aritmética acima. **Total AUSENTE** (versão desencontrada ou bug; a API real sempre manda `totalCents`; `null` vale como ausente): o papel nunca imprime "TOTAL R$ 0,00" nem "COBRAR R$ 0,00"; sai "TOTAL NÃO INFORMADO - CONFERIR NO PAINEL" e, se os itens permitem (subtotal informado batendo com a soma), "CALCULADO R$ X" (itens + taxa + gorjeta − desconto informado; nunca deriva desconto de um total que não existe); a linha de pagamento vira "COBRAR (TOTAL NÃO INFORMADO) EM DINHEIRO", sem "LEVAR ... DE TROCO". O aviso de cancelamento e o tíquete de teste têm layout próprio e nunca passam por essa linha; pedido sem itens e total 0 imprime a frase e registra um aviso no log); PIX => `PAGO ONLINE (PIX) - NÃO COBRAR`; dinheiro => `COBRAR R$ X EM DINHEIRO` (+ troco em linhas separadas); cartão (crédito/débito/VR/VA);
  balcão sem forma => `COBRAR NO CAIXA`; mesa => `PAGAMENTO NA MESA`; sem forma => `FORMA DE PAGAMENTO NÃO INFORMADA`.
- **Ainda não:** o *disparo* do aviso de cancelamento e da reimpressão (precisam do `PrintJob`: PC-03/API-12/API-14); o desenho já está pronto;
  bairro/referência separados do endereço, opções agrupadas (B8).

# Roteiro: instalador numa máquina limpa (aceite G3 com o Claudio)

> **CL-15 (decisão do Claudio):** este teste é só antes do piloto; não faz parte do desenvolvimento. O roteiro fica pronto para quando ele pedir.

Objetivo: provar que o instalador (`MeuCardapio-PrintClient-Setup.exe`) instala, atualiza e desinstala sem deixar lixo, **numa máquina que nunca viu o app**. **Não faça isto no PC do Claudio** (nem em loja real): use uma VM do Windows 10/11 limpa ou o Windows Sandbox.
O Windows Sandbox **não está instalado** neste computador (ativar exige administrador e reinício, e é decisão do Claudio). Alternativa: qualquer VM (Hyper-V, VirtualBox) com um snapshot limpo.

**Antes:** gere o instalador com `tools\build-installer.ps1` (imprime o SHA-256 do instalador e do EXE) e anote os dois. Use **chave de impressora de TESTE** de uma API local/DEV, nunca a de uma loja. Sem Authenticode (adiado): o Windows vai avisar, é esperado (item 2).

| # | Faça | Esperado | OK |
|---|---|---|---|
| 1 | Copie só o instalador para a máquina limpa; `Get-FileHash .\MeuCardapio-PrintClient-Setup.exe` | O SHA-256 é **igual** ao impresso pelo build | ☐ |
| 2 | Dê duplo clique | SmartScreen/Smart App Control pode avisar (EXE sem assinatura): **anote exatamente o que apareceu** (aviso, bloqueio total ou nada) e se foi possível seguir | ☐ |
| 3 | Instale como **usuário comum** (sem administrador) | Instala sem pedir senha de admin (o instalador é por usuário); idioma português | ☐ |
| 4 | Marque "Iniciar automaticamente com o Windows" e conclua | Pasta `%LOCALAPPDATA%\Programs\MeuCardapio\PrintClient` com o EXE; atalho no Menu Iniciar e na Inicialização | ☐ |
| 5 | "Abrir agora" | A janela abre; mostra "Impressora:" e a faixa pede a chave; **nada** de nome ou marca do terceiro | ☐ |
| 6 | Abra o app **uma 2ª vez** (atalho) | Não abre 2ª janela: aparece o aviso "já está aberto neste computador (procure o ícone perto do relógio...)"; pelo início automático (`/autostart`) sai calado | ☐ |
| 7 | Menu do ícone → "Configurar chave..." com a chave de **teste**; impressora: a do Windows da VM ou a virtual (`VirtualPrinterFolder` no `settings.json`) | Chave aceita; some "chave inválida"; a chave **não** aparece em texto no `settings.json` (protegida) | ☐ |
| 8 | Com a API de DEV acessível (modo legado, padrão), crie 1 pedido | Sai 1 vez; reabrir o app não reimprime | ☐ |
| 9 | Reinicie a VM | O app sobe sozinho (`/autostart`), minimizado e sem janela de aviso; nenhum pedido antigo reimprime | ☐ |
| 10 | Rode **o mesmo instalador de novo** com o app **aberto** | O instalador pede para **fechar o app**; não sobrescreve EXE em uso; não reabre sozinho | ☐ |
| 11 | Instale uma **versão mais nova** por cima (build com versão maior) | Atualiza; `%LOCALAPPDATA%\MeuCardapioPrintClient` (settings, chave, `printed.json`, logs) **continua** e o app segue configurado | ☐ |
| 12 | Desinstale (Configurações do Windows ou atalho "Desinstalar") | Remove EXE, atalhos e a entrada de inicialização; **mantém** `%LOCALAPPDATA%\MeuCardapioPrintClient` (dados do lojista) | ☐ |
| 13 | Instale de novo | Volta configurado, sem pedir a chave | ☐ |
| 14 | Procure rastro do terceiro: `Get-ChildItem -Recurse` na pasta do app e do `%LOCALAPPDATA%` e o painel "Aplicativos" | Nenhum nome, domínio ou arquivo de serviço de terceiro | ☐ |

Registre por item: ✓/✗, o texto de qualquer aviso do Windows, a versão do Windows da VM e capturas de tela dos itens 2, 5, 9 e 12.

## Windows Sandbox (se o Claudio ativar o recurso)
Arquivo `.wsb` de exemplo (salve fora do repositório, ajuste os caminhos; a pasta é só leitura e a rede fica desligada, então o item 8 exige trocar `Networking` para `Default` e apontar para a API de DEV):
```xml
<Configuration>
  <Networking>Disable</Networking>
  <MappedFolders>
    <MappedFolder>
      <HostFolder>C:\caminho\para\bin\Installer</HostFolder>
      <SandboxFolder>C:\Instalador</SandboxFolder>
      <ReadOnly>true</ReadOnly>
    </MappedFolder>
  </MappedFolders>
</Configuration>
```
O Sandbox descarta tudo ao fechar: os itens 9 (reiniciar) e 11–13 só valem numa VM com snapshot, não no Sandbox.

## Limites
Não testa impressora térmica real (roteiro em `roteiro-impressora-real.md`), assinatura Authenticode (adiada), nem a chave de release de produção (CL-10, do Claudio).

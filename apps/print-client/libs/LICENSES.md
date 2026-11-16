# Bibliotecas de terceiros (binários versionados)

Binário oficial do NuGet, sem modificação. Hash em `SHA256SUMS` (conferido por `build.ps1` e `run-selftest.ps1`).

| Arquivo | Pacote | Versão | Licença |
|---|---|---|---|
| `Newtonsoft.Json.dll` | Newtonsoft.Json (James Newton-King) | 13.0.3 | MIT |

Para atualizar: baixe o `.nupkg` oficial, copie a DLL de `lib/net45` (ou `net472` quando existir),
atualize `SHA256SUMS` e esta tabela no mesmo commit.

O HtmlAgilityPack saiu no PC-12: o tíquete deixou de ser HTML (modelo próprio `TicketDocument`).

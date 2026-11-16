# Bibliotecas de terceiros (binários versionados)

Binários oficiais do NuGet, sem modificação. Hashes em `SHA256SUMS` (conferidos por `build.ps1` e `run-selftest.ps1`).

| Arquivo | Pacote | Versão | Licença |
|---|---|---|---|
| `HtmlAgilityPack.dll` | HtmlAgilityPack (ZZZ Projects) | 1.11.72 | MIT |
| `Newtonsoft.Json.dll` | Newtonsoft.Json (James Newton-King) | 13.0.3 | MIT |

Para atualizar: baixe o `.nupkg` oficial, copie a DLL de `lib/net45` (ou `net472` quando existir),
atualize `SHA256SUMS` e esta tabela no mesmo commit.

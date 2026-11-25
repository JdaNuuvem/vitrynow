# ADR-0017 — Uploads de imagem em DISCO LOCAL do servidor (sem S3/R2 em produção)

- Status: **Aceito por decisão do Claudio (18/11/2026).** Substitui o trecho "S3/R2 em produção" do ADR-0010 e do ADR-0015 **só para fotos de produto/cardápio**. Autor: Atlas.
- Não reabre: Reels e modelos 3D (ADR-0015) continuam adiados e **podem reabrir esta decisão** (vídeo e GLB são grandes demais para disco de VPS pequeno); nada disso é implementado agora.

## 1. Decisão
Em produção, as fotos ficam em uma **pasta do servidor** (VPS), servidas pelo Caddy/nginx. Sem S3, sem R2, sem conta nem custo de provedor de objetos. A interface `ObjectStorage` (ADR-0010) não muda: entra um **segundo driver** ao lado do S3.

## 2. Configuração
| Variável | Regra |
|---|---|
| `STORAGE_DRIVER` | `local` (disco) ou `s3` (padrão quando ausente, comportamento atual). Qualquer outro valor derruba o boot. |
| `STORAGE_LOCAL_DIR` | Obrigatória com `local`; **caminho absoluto**; volume persistente do compose. |
| `STORAGE_PUBLIC_BASE_URL` | Obrigatória com `local` e **https** (URL pública da rota de mídia, ex. `https://dominio/media`). |
| `STORAGE_S3_*` | **Não exigidas** com `local`. Continuam exigidas com `s3`. |

Fora de dev/teste (NODE_ENV ausente conta como produção) a API **não sobe** sem uma das duas configurações completas: nunca cai em silêncio no Fake em memória.
Dev/teste continuam com o Fake em memória (e o s3mock como opção).

## 3. Regras do driver em disco (Dev Upload)
1. Mesma validação do #100: tipo permitido, tamanho máximo, **magic bytes**, reencode, sem SVG.
2. **Nome não adivinhável** (aleatório, sem nome original); chave sempre sob `stores/<storeId>/…` (isolamento por loja, ADR-0009).
3. **Sem path traversal**: reaproveitar `assertSafeKey`; resolver o caminho final e exigir que fique **dentro** de `STORAGE_LOCAL_DIR` (teste com `..`, caminho absoluto, `%2e`, barra invertida, link simbólico).
4. Gravação **atômica** (arquivo temporário na mesma pasta + rename); `delete` idempotente; **limite por loja** (bytes/arquivos) com erro 413 padrão.
5. Permissão do diretório só para o usuário da API (0700/0600); a API **não serve** os arquivos: quem serve é o proxy.

## 4. Infra (Hopper)
- Volume nomeado persistente para `STORAGE_LOCAL_DIR`, montado **leitura/escrita na API** e **somente leitura no proxy**.
- Caddy/nginx: rota de mídia **sem listar diretório**, `Cache-Control` longo (nome é imutável), `X-Content-Type-Options: nosniff`, sem executar nada da pasta.
- **Backup inclui o volume** e o **restore é testado** (mesmo teste de restauração do banco; o relatório de restauração diz se as fotos voltaram).
- `check-env --prod` **não exige S3** com `STORAGE_DRIVER=local`; exige `STORAGE_LOCAL_DIR` absoluto e a URL https.

## 5. Consequências e riscos
- **Disco único = ponto único de falha:** sem backup do volume, a loja perde as fotos. O backup é parte da decisão, não opcional.
- **Escala horizontal:** com mais de uma instância da API é preciso volume compartilhado ou voltar ao driver S3 (a interface permite trocar por configuração).
- **Espaço:** o limite por loja protege o disco; alerta de uso do volume entra no `saude.sh` (Hopper).
- **LGPD:** foto de produto não é dado pessoal; se a loja subir foto com pessoas, a regra do ADR-0014 vale igual.
- **Migração futura para S3/R2:** copiar a pasta preservando as chaves e trocar o driver; as URLs públicas mudam só pelo `STORAGE_PUBLIC_BASE_URL`.

## 6. Ordem de entrega (um PR por vez, fora do rascunho)
1. **Atlas:** `assertStorageBootConfig` aceita `STORAGE_DRIVER=local` (este ADR).
2. **Dev Upload:** driver em disco + testes de traversal/limite/atomicidade.
3. **Hopper:** compose com volume, backup/restore, Caddy, `check-env --prod`.

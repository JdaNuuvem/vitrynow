# ADR-0021 — Reels: vídeos de até 30 s em disco local, transcodificação em worker

- Status: **ACEITO pelo Claudio em 19/11/2026** (≤30 s, vertical, ffprobe, ffmpeg isolado no worker, MP4+poster, flag desligada por padrão, carimbo …830000). Proposto por Atlas. Decisão do Claudio (19/11): **Reels destravado**, custo baixo; o dono sobe vídeos de **até 30 segundos**. Substitui o trecho "R2 + MP4 faststart" do ADR-0015 (armazenamento = **disco local**, ADR-0017). Specs: documento interno do time; dimensionamento: Hopper.

## Decisão
1. **Upload pelo dono (OWNER; STAFF só se a spec permitir)**, vertical, **≤ 30 s**, formato e tamanho máximo na spec; validação **por conteúdo** (ffprobe: container, codec, duração, resolução), nunca pela extensão nem pelo Content-Type.
2. **Processamento assíncrono** em contêiner `worker` (fila em Postgres, SKIP LOCKED + lease, a mesma fila das fundações do ADR-0019) com ffmpeg **em processo isolado** (sem rede, usuário sem privilégio, limite de CPU/tempo/memória); saída: MP4 H.264 + AAC com **faststart**, **poster** (capa) e miniatura; original **descartado** ou guardado conforme a spec (decidir com Leonardo/Hopper).
3. **Servir pelo Caddy** em `/media/` com `Range`, cache imutável, `nosniff`, sem listagem; nomes aleatórios; chave `stores/<loja>/…` (isolamento por loja, FK composta `(id, storeId)`).
4. **Limites por loja (decisão do Claudio, 19/11: 10 vídeos e 300 MB por loja, a medir no piloto; upload bruto ≤ 50 MB; migrar para S3/R2+CDN se o disco apertar, ADR-0017)** (bytes totais, quantidade, duração) com erro 409/413 padronizado; remoção apaga os arquivos; LGPD: vídeo com pessoas é dado pessoal (retenção e exclusão na spec; moderação decidida pelo Claudio).
5. **Backup:** o volume de mídia entra no backup; vídeo é **regenerável** só se o original for mantido; senão é **insubstituível** (decisão do Hopper).
6. **Entitlement:** Reels é função com **custo de armazenamento/banda**; flag desligada por padrão e por plano; nada de "ilimitado".

## Consequências
Cabe no disco do VPS enquanto o volume for pequeno; vídeo muda o dimensionamento (Hopper mede com o Fake e arquivos de teste). Se a medição pedir, o driver S3 (já existe) volta como opção por configuração, em novo ADR com o Claudio. **Carimbo reservado para a migração:** `20261118830000` (aditiva, depois do robô `…820000`).

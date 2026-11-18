# Fonte de título do cardápio público

**Plus Jakarta Sans** 700 e 800, subconjunto latin, em `woff2` (12 KB cada). Licença **SIL OFL 1.1** (`OFL.txt`, junto dos arquivos).

- Origem: pacote público `@fontsource/plus-jakarta-sans` 5.3.0 (arquivos `latin-700-normal` e `latin-800-normal`), copiados para cá para o build ser reprodutível: **sem download no build e sem chamada ao Google em runtime** (CSP `font-src 'self'` intacta).
- Carregada por `next/font/local` em `../fonts.ts`; só o cardápio público usa (o painel segue com a fonte dele). Corpo do texto segue Inter.
- Decisão do Atlas (spec 12 §15): no máximo 2 pesos, `display: swap`, preload só desta fonte, `adjustFontFallback`.

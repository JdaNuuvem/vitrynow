const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

// Prévia dos artefatos de planejamento; não expõe o workspace nem serviços do app.
const files = new Map([
  ['/', ['CONCEITO-REBRAND.html', 'text/html; charset=utf-8']],
  ['/CONCEITO-REBRAND.html', ['CONCEITO-REBRAND.html', 'text/html; charset=utf-8']],
  ['/PLANO-REBRAND-RESTAURANTES.md', ['PLANO-REBRAND-RESTAURANTES.md', 'text/plain; charset=utf-8']],
  ['/ADAPTACAO-DASHBOARD.md', ['ADAPTACAO-DASHBOARD.md', 'text/plain; charset=utf-8']],
  ['/DADOS-E-GRAFICOS.md', ['DADOS-E-GRAFICOS.md', 'text/plain; charset=utf-8']],
  ['/design-tokens.proposed.json', ['design-tokens.proposed.json', 'application/json; charset=utf-8']],
]);

const server = http.createServer((request, response) => {
  const route = new URL(request.url, 'http://127.0.0.1:4174').pathname;
  const entry = files.get(route);
  if (!entry) {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Arquivo de planejamento não encontrado.');
    return;
  }
  fs.readFile(path.join(__dirname, entry[0]), (error, content) => {
    if (error) {
      response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Não foi possível abrir o artefato.');
      return;
    }
    response.writeHead(200, {
      'Content-Type': entry[1],
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    response.end(content);
  });
});
server.on('error', error => { console.error(error.message); process.exitCode = 1; });
server.listen(4174, '127.0.0.1', () => console.log('Conceito de rebrand: http://127.0.0.1:4174'));

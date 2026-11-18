// Peças comuns dos ganchos: ler a entrada do Claude Code (JSON no stdin), a configuração opcional ao lado
// (config.json, gravada pelo instalador) e escrever a decisão. Todo gancho falha aberto: qualquer erro deixa seguir.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const pastaDoGancho = (url) => path.dirname(fileURLToPath(url));

export function lerConfig(url) {
  try { return JSON.parse(fs.readFileSync(path.join(pastaDoGancho(url), 'config.json'), 'utf8')); } catch { return {}; }
}

export const ehPrincipal = (url) => Boolean(process.argv[1]) && url === pathToFileURL(path.resolve(process.argv[1])).href;

export function rodarComoGancho(decidir) {
  let texto = '';
  process.stdin.on('data', (d) => { texto += d; });
  process.stdin.on('end', () => {
    try {
      const r = decidir(JSON.parse(texto || '{}'));
      if (r) process.stdout.write(JSON.stringify(r));
    } catch { /* falha aberta */ }
  });
}

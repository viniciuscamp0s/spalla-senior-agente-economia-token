#!/usr/bin/env node
// Gera exemplos/relatorio-exemplo.{md,html} com NÚMEROS FICTÍCIOS (marcados como exemplo no próprio relatório).
// Nenhuma transcrição real entra aqui: as sessões abaixo são inventadas por um gerador determinístico.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { diagnosticar } from '../lib/diagnostico.mjs';
import { gerarHtml, gerarMarkdown } from '../lib/relatorio.mjs';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let semente = 7;
const aleatorio = () => { semente = (semente * 16807) % (2 ** 31 - 1); return semente / (2 ** 31 - 1); };
const entre = (a, b) => Math.round(a + aleatorio() * (b - a));

const sessoes = [];
for (let i = 0; i < 38; i++) {
  const respostas = i < 4 ? entre(160, 320) : entre(12, 140);
  const abertura = entre(55_000, 95_000);
  const trabalho = respostas * entre(2_500, 6_000);
  const pausas = i % 3 === 0 ? entre(1, 3) : 0;
  const reescritas = Array.from({ length: pausas }, () => entre(60_000, 260_000));
  const gat = ['usuario', 'tarefa-fundo', 'tarefa-fundo', 'recado'];
  const porGatilho = {};
  reescritas.forEach((r, k) => { const g = gat[(i + k) % gat.length]; porGatilho[g] = (porGatilho[g] ?? 0) + r; });
  const reescrita = reescritas.reduce((a, b) => a + b, 0);
  const novos = abertura + trabalho + reescrita;
  sessoes.push({
    sub: false, respostas, novos, abertura, pausas, reescritas, porGatilho, reescritaPorPausa: reescrita,
    depoisDoLimite: respostas > 150 ? Math.round(trabalho * (respostas - 150) / respostas * 1.6) : 0,
    porModelo: { [i % 4 === 0 ? 'claude-sonnet' : 'claude-opus']: novos },
    leiturasRepetidas: i % 5 === 0 ? [{ arq: `/projeto-exemplo/src/modulo-${i}.ts`, vezes: entre(3, 6), charsExtras: entre(40_000, 120_000) }] : [],
    saidas: i % 4 === 1 ? [{ nome: 'Bash', alvo: 'npm test', chars: entre(35_000, 90_000) }] : [],
    agentes: [],
  });
}
for (let i = 0; i < 26; i++) {
  const novos = entre(40_000, 180_000);
  sessoes.push({ sub: true, respostas: entre(4, 20), novos, abertura: 0, pausas: 0, reescritas: [], porGatilho: {}, reescritaPorPausa: 0, depoisDoLimite: 0, porModelo: { [i % 5 < 3 ? 'claude-opus' : 'claude-haiku']: novos }, leiturasRepetidas: [], saidas: [], agentes: [] });
}

const d = diagnosticar(sessoes);
const dados = {
  ferramenta: 'claude-economia-de-cota', versao: 'exemplo', geradoEm: '2030-01-08 (exemplo)', exemplo: true,
  periodo: { ini: '2030-01-01', fim: '2030-01-07', dias: 7 }, escopo: 'todos os projetos (exemplo)',
  total: d.total, resumo: d.resumo, medidas: d.medidas, oportunidades: d.oportunidades, tokensPorPorcento: null,
  acoes: [
    { id: 'espera-curta', titulo: 'Recusa espera longa em segundo plano', metrica: 'reescrita depois de pausa quando uma tarefa em segundo plano termina', status: 'mantida', base: 0.081, depois: 0.012, economia: 2_100_000 },
    { id: 'subagente-barato', titulo: 'Subagente sem modelo escolhido roda no Sonnet (busca no Haiku)', metrica: 'parte do modelo mais caro nos tokens de subagente', status: 'mantida', base: 0.58, depois: 0.19, economia: 1_400_000 },
    { id: 'retomada-cara', titulo: 'Aviso antes de acordar sessão grande parada há mais de 1 hora', metrica: 'reescrita depois de pausa quando você volta', status: 'desfeita', base: 0.03, depois: 0.031, economia: null },
    { id: 'compactacao-ociosa', titulo: 'Compactação ociosa a partir de 100 mil tokens', metrica: 'reescrita depois de pausa quando você volta ou outra sessão escreve', status: 'medindo', base: 0.05, depois: null, economia: null },
  ],
};
fs.mkdirSync(path.join(RAIZ, 'exemplos'), { recursive: true });
fs.writeFileSync(path.join(RAIZ, 'exemplos', 'relatorio-exemplo.md'), gerarMarkdown(dados));
fs.writeFileSync(path.join(RAIZ, 'exemplos', 'relatorio-exemplo.html'), gerarHtml(dados));
console.log(`exemplo gerado: ${Math.round(d.total / 1e6)} milhões de tokens fictícios, ${d.oportunidades.length} oportunidades`);

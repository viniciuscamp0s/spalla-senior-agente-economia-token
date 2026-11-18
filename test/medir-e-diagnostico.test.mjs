import assert from 'node:assert/strict';
import test from 'node:test';
import { diagnosticar } from '../lib/diagnostico.mjs';
import { compilarExtras, gatilhoDoTexto, medirSessao, nomeDaPastaDoProjeto } from '../lib/medir.mjs';
import { periodo } from '../lib/periodo.mjs';
import { resposta, sessaoTipica, usuario } from './fabrica.mjs';

const T0 = Date.UTC(2030, 0, 7, 12);
const linhas = (l) => l.map((x) => JSON.stringify(x));

test('gatilho: o que acordou a sessão', () => {
  assert.equal(gatilhoDoTexto('<task-notification>x</task-notification>'), 'tarefa-fundo');
  assert.equal(gatilhoDoTexto('Another Claude session says hi'), 'recado');
  assert.equal(gatilhoDoTexto('qualquer coisa', { compactacao: true }), 'compactacao');
  assert.equal(gatilhoDoTexto('', { soFerramenta: true }), 'ferramenta');
  assert.equal(gatilhoDoTexto('continue'), 'usuario');
  assert.equal(gatilhoDoTexto('[robo] retome', { extras: compilarExtras({ robo: '^\\[robo\\]' }) }), 'robo');
});

test('medirSessao: abertura, pausa, leitura repetida e saída grande', async () => {
  const m = await medirSessao(linhas(sessaoTipica(T0)), T0 - 1, T0 + 86_400_000);
  assert.equal(m.respostas, 5);
  assert.equal(m.abertura, 60_000);
  assert.equal(m.pausas, 1);
  assert.equal(m.reescritaPorPausa, 150_000);
  assert.deepEqual(m.porGatilho, { 'tarefa-fundo': 150_000 });
  assert.equal(m.leiturasRepetidas.length, 1);
  assert.equal(m.leiturasRepetidas[0].vezes, 3);
  assert.equal(m.leiturasRepetidas[0].charsExtras, 80_000);
  assert.equal(m.saidas.length, 3);
  assert.equal(m.novos, 5 * 510 + 60_000 + 150_000);
});

test('medirSessao: resposta repetida em várias linhas conta uma vez e o período corta', async () => {
  const r = resposta(T0, { escrita: 1000 });
  const m = await medirSessao(linhas([r, r, resposta(T0 + 10 * 86_400_000)]), T0 - 1, T0 + 1000);
  assert.equal(m.respostas, 1);
  assert.equal(m.novos, 1510);
});

test('diagnosticar: oportunidades ordenadas e medidas em fração', async () => {
  const principal = await medirSessao(linhas(sessaoTipica(T0)), T0 - 1, T0 + 86_400_000);
  const sub = await medirSessao(linhas([usuario(T0, 'x'), resposta(T0 + 1, { modelo: 'claude-opus-exemplo', escrita: 30_000 })]), T0 - 1, T0 + 86_400_000);
  const d = diagnosticar([{ ...principal, sub: false }, { ...sub, sub: true }]);
  assert.equal(d.total, principal.novos + sub.novos);
  const ids = d.oportunidades.map((o) => o.id);
  for (const id of ['reescrita-apos-pausa', 'abertura', 'leitura-repetida', 'saidas-grandes', 'subagente-caro']) assert.ok(ids.includes(id), id);
  for (let i = 1; i < d.oportunidades.length; i++) assert.ok(d.oportunidades[i - 1].fracao >= d.oportunidades[i].fracao);
  assert.equal(d.medidas.subagenteCaroFrac, 1);
  assert.ok(d.medidas.reescritaPorGatilhoFrac['tarefa-fundo'] > 0.5);
});

test('diagnosticar: sem uso, sem oportunidades', () => {
  const d = diagnosticar([]);
  assert.equal(d.total, 0);
  assert.equal(d.medidas, null);
});

test('nome da pasta do projeto segue a regra do Claude Code', () => {
  assert.match(nomeDaPastaDoProjeto('/a/b c/d.e'), /-a-b-c-d-e$/);
});

test('período: últimos N dias e semana inteira', () => {
  const agora = new Date(2030, 0, 15, 15, 30).getTime();
  const p = periodo({ dias: 7, agora });
  assert.equal(p.fim, agora);
  const s = periodo({ dias: 7, inteiro: true, agora });
  assert.deepEqual(s.rotulo, { ini: '2030-01-08', fim: '2030-01-14', dias: 7 });
  assert.throws(() => periodo({ desde: '2030-01-10', ate: '2030-01-10' }));
});

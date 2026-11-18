import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { gerarHtml, gerarMarkdown } from '../lib/relatorio.mjs';
import { criarClaudeFalso } from './fabrica.mjs';

const CLI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'cli.mjs');
const rodar = (args, env, cwd = os.tmpdir()) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', cwd, env: { ...process.env, ...env } });
const dia = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

test('relatório: escapa HTML e marca exemplo', () => {
  const dados = { geradoEm: 'agora', periodo: { ini: 'a', fim: 'b', dias: 7 }, escopo: '<script>', total: 0, resumo: { sessoes: 0 }, oportunidades: [], medidas: null, acoes: null, exemplo: true };
  const h = gerarHtml(dados);
  assert.ok(!h.includes('<script>'));
  assert.match(h, /EXEMPLO COM NÚMEROS FICTÍCIOS/);
  assert.match(gerarMarkdown(dados), /EXEMPLO COM NÚMEROS FICTÍCIOS/);
});

test('CLI: diagnóstico de ponta a ponta grava HTML, Markdown e JSON', () => {
  const t0 = new Date(2030, 0, 10, 12).getTime();
  const { raiz, projetoDir } = criarClaudeFalso({ t0 });
  const saida = fs.mkdtempSync(path.join(os.tmpdir(), 'saida-'));
  const r = rodar(['diagnostico', '--desde', '2030-01-09', '--ate', '2030-01-12', '--saida', saida, '--projeto', projetoDir], { CLAUDE_CONFIG_DIR: raiz });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /tokens novos/);
  const json = JSON.parse(fs.readFileSync(path.join(saida, 'economia-de-cota-2030-01-11.json'), 'utf8'));
  assert.equal(json.resumo.sessoes, 1);
  assert.equal(json.resumo.subagentes, 1);
  assert.equal(json.oportunidades[0].id, 'reescrita-apos-pausa');
  assert.ok(!JSON.stringify(json).includes('"sessoes":['), 'o JSON não leva a lista crua de sessões');
  assert.match(fs.readFileSync(path.join(saida, 'economia-de-cota-2030-01-11.html'), 'utf8'), /<!doctype html>/);
  assert.match(fs.readFileSync(path.join(saida, 'economia-de-cota-2030-01-11.md'), 'utf8'), /Onde dá para economizar/);
});

test('CLI: instalar, status, semanal e desinstalar num projeto', () => {
  const ontem = new Date(); ontem.setDate(ontem.getDate() - 2); ontem.setHours(12, 0, 0, 0);
  const projetoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'proj-cli-'));
  const { raiz } = criarClaudeFalso({ t0: ontem.getTime(), projetoDir });
  const env = { CLAUDE_CONFIG_DIR: raiz };
  const i = rodar(['instalar', '--projeto', projetoDir], env);
  assert.equal(i.status, 0, i.stderr);
  assert.match(i.stdout, /espera-curta \(base: /);
  const settings = path.join(projetoDir, '.claude', 'settings.local.json');
  assert.ok(fs.existsSync(settings));
  assert.match(rodar(['status', '--projeto', projetoDir], env).stdout, /espera-curta: medindo/);
  const s = rodar(['semanal', '--projeto', projetoDir], env);
  assert.equal(s.status, 0, s.stderr);
  assert.match(s.stdout, /espera-curta: medindo/, 'no mesmo dia da instalação ainda não decide');
  assert.ok(fs.existsSync(path.join(projetoDir, '.claude', 'economia-de-cota', 'relatorios', `semana-${dia(new Date(Date.now() - 86_400_000))}.html`)));
  const d = rodar(['desinstalar', '--projeto', projetoDir], env);
  assert.equal(d.status, 0, d.stderr);
  assert.deepEqual(JSON.parse(fs.readFileSync(settings, 'utf8')), {});
});

test('CLI: comando errado sai com erro legível', () => {
  const r = rodar(['voar'], {});
  assert.equal(r.status, 1);
  assert.match(r.stderr, /comando desconhecido/);
});

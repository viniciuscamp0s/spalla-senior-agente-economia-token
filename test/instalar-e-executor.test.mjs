import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { rodada } from '../lib/executor.mjs';
import { desinstalar, instalar, lerEstado, resolverEscopo } from '../lib/instalar.mjs';

const projeto = () => fs.mkdtempSync(path.join(os.tmpdir(), 'projeto-'));
const ler = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));

const ORIGINAL = {
  permissions: { allow: ['Bash(ls:*)'] },
  env: { MINHA_VAR: '1', CLAUDE_CODE_SUBAGENT_MODEL: 'haiku' },
  hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'node meu-gancho.mjs' }] }] },
};

test('instalar e desinstalar no projeto: mexe só no que é do pacote e volta ao original', () => {
  const p = projeto();
  const e = resolverEscopo({ projeto: p });
  fs.mkdirSync(path.dirname(e.settings), { recursive: true });
  fs.writeFileSync(e.settings, JSON.stringify(ORIGINAL));
  const base = { reescritaPorGatilhoFrac: { usuario: 0.1, 'tarefa-fundo': 0.08 }, subagenteCaroFrac: 0.6 };
  const r = instalar(e, { base, periodoBase: { ini: '2030-01-01', fim: '2030-01-07' } });
  const s = ler(e.settings);
  assert.equal(s.env.MINHA_VAR, '1');
  assert.equal(s.env.CLAUDE_CODE_SUBAGENT_MODEL, 'haiku', 'a variável que você já tinha vence');
  assert.equal(s.env.CLAUDE_CODE_IDLE_COMPACT_MIN_TOKENS, '100000');
  assert.equal(s.hooks.PreToolUse.length, 3);
  assert.equal(s.hooks.UserPromptSubmit.length, 1);
  assert.deepEqual(s.permissions, ORIGINAL.permissions);
  assert.ok(fs.existsSync(path.join(e.pasta, 'ganchos', 'espera-longa.mjs')));
  assert.equal(fs.readFileSync(path.join(e.pasta, '.gitignore'), 'utf8'), '*\n');
  assert.equal(r.estado.acoes['espera-curta'].base.valor, 0.08);
  assert.equal(r.estado.acoes['subagente-barato'].base.valor, 0.6);
  // reinstalar não duplica
  instalar(e, {});
  assert.equal(ler(e.settings).hooks.PreToolUse.length, 3);
  desinstalar(e);
  assert.deepEqual(ler(e.settings), ORIGINAL);
  assert.equal(lerEstado(e).instalado, false);
  assert.ok(!fs.existsSync(path.join(e.pasta, 'ganchos')));
});

test('gancho instalado roda de verdade pelo comando gravado', () => {
  const p = projeto();
  const e = resolverEscopo({ projeto: p });
  instalar(e, { acoes: ['espera-curta'] });
  const cmd = ler(e.settings).hooks.PreToolUse[0].hooks[0].command;
  const arq = cmd.match(/node "(.+)"/)[1];
  const r = spawnSync(process.execPath, [arq], { input: JSON.stringify({ tool_input: { command: 'sleep 9000', run_in_background: true } }), encoding: 'utf8' });
  assert.equal(JSON.parse(r.stdout).hookSpecificOutput.permissionDecision, 'deny');
  const vazio = spawnSync(process.execPath, [arq], { input: 'não é json', encoding: 'utf8' });
  assert.equal(vazio.status, 0, 'falha aberta');
  assert.equal(vazio.stdout, '');
});

test('escopo compartilhado usa $CLAUDE_PROJECT_DIR e não ignora os ganchos no git', () => {
  const p = projeto();
  const e = resolverEscopo({ projeto: p, compartilhado: true });
  instalar(e, { acoes: ['retomada-cara'] });
  assert.match(ler(e.settings).hooks.UserPromptSubmit[0].hooks[0].command, /\$CLAUDE_PROJECT_DIR\/\.claude\/economia-de-cota\/ganchos\/retomada-cara\.mjs/);
  assert.doesNotMatch(fs.readFileSync(path.join(e.pasta, '.gitignore'), 'utf8'), /ganchos/);
  assert.throws(() => instalar(resolverEscopo({ projeto: p }), {}), /desinstalar primeiro/);
});

test('settings ilegível: nada é gravado', () => {
  const p = projeto();
  const e = resolverEscopo({ projeto: p });
  fs.mkdirSync(path.dirname(e.settings), { recursive: true });
  fs.writeFileSync(e.settings, '{ quebrado');
  assert.throws(() => instalar(e, {}), /não é JSON válido/);
  assert.equal(fs.readFileSync(e.settings, 'utf8'), '{ quebrado');
});

test('executor: mantém o que economizou, desfaz o que não economizou, espera o período certo', () => {
  const acoes = {
    'espera-curta': { status: 'medindo', aplicadaEm: '2030-01-08', base: { valor: 0.1 } },
    'subagente-barato': { status: 'medindo', aplicadaEm: '2030-01-08', base: { valor: 0.5 } },
    'retomada-cara': { status: 'medindo', aplicadaEm: '2030-01-08', base: null },
    'compactacao-ociosa': { status: 'medindo', aplicadaEm: '2030-01-08', base: { valor: 0 } },
  };
  const medidas = { reescritaPorGatilhoFrac: { 'tarefa-fundo': 0.02, usuario: 0.1 }, subagenteCaroFrac: 0.49 };
  const cedo = rodada({ acoes, medidas, periodo: { ini: '2030-01-08', fim: '2030-01-14' }, tokensNovos: 1_000_000 });
  assert.equal(cedo.relatorio.find((x) => x.id === 'espera-curta').status, 'medindo');
  assert.deepEqual(cedo.desligar, []);
  const r = rodada({ acoes, medidas, periodo: { ini: '2030-01-09', fim: '2030-01-15' }, tokensNovos: 1_000_000 });
  const st = Object.fromEntries(r.relatorio.map((x) => [x.id, x.status]));
  assert.deepEqual(st, { 'espera-curta': 'mantida', 'subagente-barato': 'desfeita', 'retomada-cara': 'sem-base', 'compactacao-ociosa': 'nada-a-medir' });
  assert.equal(r.acoes['espera-curta'].economia, 80_000);
  assert.deepEqual(r.desligar, ['subagente-barato']);
  // decidida fica decidida
  const de_novo = rodada({ acoes: r.acoes, medidas, periodo: { ini: '2030-01-16', fim: '2030-01-22' }, tokensNovos: 1 });
  assert.deepEqual(de_novo.desligar, []);
});

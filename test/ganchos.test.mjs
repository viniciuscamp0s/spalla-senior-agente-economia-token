import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { decidir as esperaDecidir, esperaLonga } from '../ganchos/espera-longa.mjs';
import { interpretar, msAte } from '../ganchos/esperar.mjs';
import { decidir as retomadaDecidir } from '../ganchos/retomada-cara.mjs';
import { decidir as subDecidir } from '../ganchos/subagente-modelo.mjs';
import { resposta, usuario } from './fabrica.mjs';

test('espera longa: recusa laço e sleep longo em segundo plano, deixa o resto', () => {
  assert.equal(esperaLonga('sleep 30'), null);
  assert.match(esperaLonga('sleep 7200'), /sleep de 120 min/);
  assert.match(esperaLonga('sleep 2h'), /120 min/);
  assert.match(esperaLonga('until [ -f pronto ]; do sleep 60; done'), /laço/);
  assert.equal(esperaLonga('while true; do sleep 5; done'), null);
  assert.match(esperaLonga('Start-Sleep -Seconds 4000'), /Start-Sleep/);
  assert.equal(esperaLonga('node esperar.mjs --ate 22:00'), null);
  assert.equal(esperaDecidir({ tool_input: { command: 'sleep 7200' } }), null, 'em primeiro plano passa');
  const r = esperaDecidir({ tool_input: { command: 'sleep 7200', run_in_background: true } }, { esperar: '/x/esperar.mjs' });
  assert.equal(r.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(r.hookSpecificOutput.permissionDecisionReason, /node "\/x\/esperar\.mjs"/);
});

test('esperar: argumentos e teto de 45 min', () => {
  assert.deepEqual(interpretar([]), { modo: 'despertador', alvo: '', cond: '', min: 45 });
  assert.equal(interpretar(['120']).min, 45);
  assert.equal(interpretar(['--ate', '22:15', '10']).min, 10);
  assert.ok(interpretar(['--ate', '25:00']).erro);
  assert.ok(interpretar(['--ate-que', '']).erro);
  const agora = new Date(2030, 0, 1, 21, 0);
  assert.equal(msAte('22:00', agora), 3_600_000);
  assert.equal(msAte('20:00', agora), 23 * 3_600_000);
});

test('subagente: põe modelo barato só quando falta e só nos tipos genéricos', () => {
  const r = subDecidir({ tool_name: 'Agent', tool_input: { subagent_type: 'Explore', prompt: 'p' } });
  assert.equal(r.hookSpecificOutput.updatedInput.model, 'haiku');
  assert.equal(r.hookSpecificOutput.updatedInput.prompt, 'p');
  assert.equal(subDecidir({ tool_name: 'Agent', tool_input: { prompt: 'p' } }).hookSpecificOutput.updatedInput.model, 'sonnet');
  assert.equal(subDecidir({ tool_name: 'Agent', tool_input: { model: 'opus' } }), null);
  assert.equal(subDecidir({ tool_name: 'Agent', tool_input: { subagent_type: 'Plan' } }), null);
  assert.equal(subDecidir({ tool_name: 'Bash', tool_input: {} }), null);
  assert.equal(subDecidir({ tool_name: 'Agent', tool_input: {} }, { 'general-purpose': 'haiku' }).hookSpecificOutput.updatedInput.model, 'haiku');
});

test('retomada cara: segura uma vez, grava o resumo e devolve a mensagem na segunda', () => {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'retomada-'));
  const transc = path.join(pasta, 't.jsonl');
  const t0 = Date.UTC(2030, 0, 1, 10);
  fs.writeFileSync(transc, [usuario(t0, 'faça a tarefa A'), resposta(t0 + 1000, { leitura: 250_000 })].map((x) => JSON.stringify(x)).join('\n'));
  const entrada = { session_id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', transcript_path: transc, cwd: '/projeto-exemplo', prompt: 'e agora?' };
  assert.equal(retomadaDecidir(entrada, { agora: t0 + 30 * 60_000, pasta }), null, 'parada curta passa');
  assert.equal(retomadaDecidir(entrada, { agora: t0 + 2 * 3_600_000, pasta, opcoes: { contextoMin: 300_000 } }), null, 'contexto pequeno passa');
  const r = retomadaDecidir(entrada, { agora: t0 + 2 * 3_600_000, pasta });
  assert.equal(r.decision, 'block');
  assert.match(r.reason, /250 mil/);
  const resumo = fs.readFileSync(path.join(pasta, `${entrada.session_id}.md`), 'utf8');
  assert.match(resumo, /faça a tarefa A/);
  const r2 = retomadaDecidir({ ...entrada, prompt: 'siga' }, { agora: t0 + 2 * 3_600_000 + 60_000, pasta });
  assert.match(r2.hookSpecificOutput.additionalContext, /e agora\?/);
  assert.equal(retomadaDecidir({ ...entrada, prompt: '[robo] x' }, { agora: t0 + 3 * 3_600_000, pasta, opcoes: { liberarSe: '^\\[robo\\]' } }), null);
});

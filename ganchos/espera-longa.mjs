#!/usr/bin/env node
// GANCHO ESPERA LONGA (PreToolUse, Bash e PowerShell): recusa espera em segundo plano que pode passar de 1 hora.
//
// Por quê: a tarefa em segundo plano acorda a sessão quando termina. Depois de ~1 h o cache do Claude venceu e a
// sessão reescreve o contexto inteiro como tokens novos. Laços como "until [ hora >= 22 ]; do sleep 60; done" ou um
// sleep de 2 horas são a forma mais comum disso. A saída é o esperar.mjs (ao lado deste arquivo), que acorda em no
// máximo 45 min e diz PRONTO ou AINDA NAO.
// Laço sem fim (while true) passa: ele nunca termina, então nunca acorda a sessão.
import path from 'node:path';
import { ehPrincipal, pastaDoGancho, rodarComoGancho } from './_comum.mjs';

export const LIMITE_S = 45 * 60;

export function esperaLonga(comando, limite = LIMITE_S) {
  const c = String(comando ?? '');
  if (/esperar\.(mjs|sh)/.test(c)) return null;
  if (/\b(until|while)\b[\s\S]*?\b(sleep|Start-Sleep)\b/i.test(c) && !/\bwhile\s+(true|:)\s*;/.test(c) && !/\bwhile\s*\(\s*\$true\s*\)/i.test(c)) return 'laço de espera com sleep';
  for (const m of c.matchAll(/\bsleep\s+(\d+)([smhd]?)\b/g)) {
    const n = Number(m[1]) * ({ '': 1, s: 1, m: 60, h: 3600, d: 86400 }[m[2]]);
    if (n > limite) return `sleep de ${Math.round(n / 60)} min`;
  }
  for (const m of c.matchAll(/Start-Sleep\s+(?:-Seconds\s+|-s\s+)?(\d+)/gi)) if (Number(m[1]) > limite) return `Start-Sleep de ${Math.round(Number(m[1]) / 60)} min`;
  return null;
}

export function decidir(entrada, { esperar = path.join(pastaDoGancho(import.meta.url), 'esperar.mjs') } = {}) {
  const ti = entrada?.tool_input ?? {};
  if (!ti.run_in_background) return null;
  const motivo = esperaLonga(ti.command);
  if (!motivo) return null;
  const cmd = `node "${esperar.replaceAll('\\', '/')}"`;
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: `Espera em segundo plano que pode passar de 1 h (${motivo}): ao acordar com o cache vencido, a sessão reescreve o contexto inteiro como tokens novos (claude-economia-de-cota). `
        + `Use em segundo plano: ${cmd} --ate HH:MM | --ate-que "<comando que dá certo quando terminou>" | <minutos>. `
        + 'Ele acorda em no máximo 45 min e diz PRONTO ou AINDA NAO (aí rode de novo). Espera de várias horas: deixe um resumo do que falta e encerre a sessão.',
    },
  };
}

if (ehPrincipal(import.meta.url)) rodarComoGancho((e) => decidir(e));

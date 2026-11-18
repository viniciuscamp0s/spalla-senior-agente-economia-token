#!/usr/bin/env node
// GANCHO MODELO DO SUBAGENTE (PreToolUse, Agent e Task): subagente sem modelo escolhido não herda o modelo caro.
//
// Por quê: subagente sem "model" roda no modelo da sessão. Quem trabalha no modelo mais caro paga o mais caro também
// em toda busca e leitura feita por subagente. Este gancho põe um modelo barato só nos tipos genéricos:
// busca (Explore) no Haiku; uso geral no Sonnet. Quem passou model explícito vence sempre; agente com modelo próprio
// na definição, fork e Plan ficam como estão. Troque o mapa em config.json: {"subagentes": {"Explore": "haiku"}}.
import { ehPrincipal, lerConfig, rodarComoGancho } from './_comum.mjs';

export const MODELO_POR_TIPO = { Explore: 'haiku', 'general-purpose': 'sonnet', claude: 'sonnet', 'claude-code-guide': 'sonnet' };

export function decidir(entrada, mapa = MODELO_POR_TIPO) {
  if (!['Agent', 'Task'].includes(entrada?.tool_name)) return null;
  const ti = entrada.tool_input ?? {};
  if (ti.model) return null;
  const tipo = ti.subagent_type ?? 'general-purpose';
  const modelo = mapa[tipo];
  if (!modelo) return null;
  return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow', permissionDecisionReason: `subagente ${tipo} sem modelo: ${modelo} (claude-economia-de-cota)`, updatedInput: { ...ti, model: modelo } } };
}

if (ehPrincipal(import.meta.url)) {
  const cfg = lerConfig(import.meta.url);
  rodarComoGancho((e) => decidir(e, { ...MODELO_POR_TIPO, ...(cfg.subagentes ?? {}) }));
}

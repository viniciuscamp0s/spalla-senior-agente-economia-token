// INSTALAR E DESINSTALAR: leva as ações do catálogo para a configuração do Claude Code e tira de volta.
//
// Escopos (o padrão é o mais contido):
//   projeto-local         <projeto>/.claude/settings.local.json  (só você, só este projeto; padrão)
//   projeto-compartilhado <projeto>/.claude/settings.json        (vai para o git do projeto: vale para o time)
//   usuario               ~/.claude/settings.json                (toda sessão desta máquina; só com --usuario)
//
// Mexe só no que é do pacote: os ganchos cujo comando aponta para "economia-de-cota/ganchos/" e as variáveis de
// ambiente do catálogo. Os outros ganchos e variáveis ficam intactos. Variável que você já tinha definido não é
// sobrescrita. Antes da primeira gravação, guarda cópia do arquivo (<arquivo>.antes-economia-de-cota).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ACOES, ARQUIVOS_DOS_GANCHOS, acaoPorId } from './acoes.mjs';
import { pastaDoClaude } from './medir.mjs';

export const MARCA = 'economia-de-cota/ganchos/';
const FONTE_GANCHOS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'ganchos');
const barra = (p) => p.replaceAll('\\', '/');

export function resolverEscopo({ projeto = process.cwd(), usuario = false, compartilhado = false, claudeDir = pastaDoClaude() } = {}) {
  if (usuario) {
    const pasta = path.join(claudeDir, 'economia-de-cota');
    return { tipo: 'usuario', settings: path.join(claudeDir, 'settings.json'), pasta, projeto: null, comando: (arq) => `node "${barra(path.join(pasta, 'ganchos', arq))}"` };
  }
  const raiz = path.resolve(projeto);
  const pasta = path.join(raiz, '.claude', 'economia-de-cota');
  if (compartilhado) return { tipo: 'projeto-compartilhado', settings: path.join(raiz, '.claude', 'settings.json'), pasta, projeto: raiz, comando: (arq) => `node "$CLAUDE_PROJECT_DIR/.claude/economia-de-cota/ganchos/${arq}"` };
  return { tipo: 'projeto-local', settings: path.join(raiz, '.claude', 'settings.local.json'), pasta, projeto: raiz, comando: (arq) => `node "${barra(path.join(pasta, 'ganchos', arq))}"` };
}

// ---------- funções puras sobre o objeto de settings ----------

export const chavesDeEnv = () => [...new Set(ACOES.flatMap((a) => Object.keys(a.env)))];

// Valor que cada variável do catálogo tinha antes do pacote (null = não existia).
export function envAntes(settings) {
  return Object.fromEntries(chavesDeEnv().map((k) => [k, settings?.env?.[k] ?? null]));
}

export function remover(settings, envAnterior = {}) {
  const novo = structuredClone(settings ?? {});
  if (novo.hooks) {
    for (const evento of Object.keys(novo.hooks)) {
      novo.hooks[evento] = (novo.hooks[evento] ?? [])
        .map((gr) => ({ ...gr, hooks: (gr.hooks ?? []).filter((h) => !String(h.command ?? '').includes(MARCA)) }))
        .filter((gr) => gr.hooks.length);
      if (!novo.hooks[evento].length) delete novo.hooks[evento];
    }
    if (!Object.keys(novo.hooks).length) delete novo.hooks;
  }
  if (novo.env) {
    for (const [k, antes] of Object.entries(envAnterior)) {
      if (antes == null) delete novo.env[k]; else novo.env[k] = antes;
    }
    if (!Object.keys(novo.env).length) delete novo.env;
  }
  return novo;
}

export function adicionar(settings, { ligadas, comando, envAnterior = {} }) {
  const novo = structuredClone(settings ?? {});
  for (const id of ligadas) {
    const a = acaoPorId(id);
    if (!a) throw new Error(`ação desconhecida: ${id}`);
    for (const [k, v] of Object.entries(a.env)) {
      if (envAnterior[k] != null) continue; // a sua configuração vence
      novo.env = { ...(novo.env ?? {}), [k]: v };
    }
    for (const gch of a.ganchos) {
      novo.hooks = novo.hooks ?? {};
      const grupo = { ...(gch.matcher ? { matcher: gch.matcher } : {}), hooks: [{ type: 'command', command: comando(gch.arquivo), timeout: 10 }] };
      novo.hooks[gch.evento] = [...(novo.hooks[gch.evento] ?? []), grupo];
    }
  }
  return novo;
}

// ---------- arquivos ----------

export function lerJson(arq, padrao) {
  if (!fs.existsSync(arq)) return padrao;
  const bruto = fs.readFileSync(arq, 'utf8').replace(/^﻿/, '');
  if (!bruto.trim()) return padrao;
  return JSON.parse(bruto);
}

export function gravarJson(arq, obj) {
  fs.mkdirSync(path.dirname(arq), { recursive: true });
  fs.writeFileSync(`${arq}.tmp`, `${JSON.stringify(obj, null, 2)}\n`);
  fs.renameSync(`${arq}.tmp`, arq);
}

function lerSettings(arq) {
  try { return lerJson(arq, {}); } catch (e) { throw new Error(`${arq} não é JSON válido (${e.message}). Nada foi alterado: corrija o arquivo e rode de novo.`); }
}

export const arquivoDeEstado = (escopo) => path.join(escopo.pasta, 'estado.json');
export const lerEstado = (escopo) => lerJson(arquivoDeEstado(escopo), null);

function copiarGanchos(escopo, configGanchos) {
  const destino = path.join(escopo.pasta, 'ganchos');
  fs.mkdirSync(destino, { recursive: true });
  for (const f of ARQUIVOS_DOS_GANCHOS) fs.copyFileSync(path.join(FONTE_GANCHOS, f), path.join(destino, f));
  // o pacote é ESM: a pasta copiada precisa dizer isso ao Node, onde quer que esteja
  fs.writeFileSync(path.join(destino, 'package.json'), '{ "type": "module" }\n');
  gravarJson(path.join(destino, 'config.json'), configGanchos ?? {});
  // o que nunca vai para o git: estado, resumos de passagem, relatórios (e, no escopo local, tudo)
  const ignorar = escopo.tipo === 'projeto-compartilhado' ? 'estado.json\nretomadas/\nrelatorios/\n' : '*\n';
  fs.writeFileSync(path.join(escopo.pasta, '.gitignore'), ignorar);
}

// Aplica um conjunto de ações ligadas (instalação, reinstalação depois de desfazer uma ação).
export function aplicar(escopo, { ligadas, envAnterior, configGanchos, simular = false }) {
  const atual = lerSettings(escopo.settings);
  const novo = adicionar(remover(atual, envAnterior), { ligadas, comando: escopo.comando, envAnterior });
  const mudou = JSON.stringify(atual) !== JSON.stringify(novo);
  if (simular) return { mudou, novo };
  if (ligadas.length) copiarGanchos(escopo, configGanchos);
  if (mudou) {
    const copia = `${escopo.settings}.antes-economia-de-cota`;
    if (fs.existsSync(escopo.settings) && !fs.existsSync(copia)) fs.copyFileSync(escopo.settings, copia);
    gravarJson(escopo.settings, novo);
  }
  return { mudou, novo };
}

export function instalar(escopo, { acoes = ACOES.map((a) => a.id), base = null, periodoBase = null, configGanchos = {}, simular = false, agora = new Date() } = {}) {
  for (const id of acoes) if (!acaoPorId(id)) throw new Error(`ação desconhecida: ${id}. Disponíveis: ${ACOES.map((a) => a.id).join(', ')}`);
  const anterior = lerEstado(escopo);
  if (anterior?.instalado && anterior.escopo !== escopo.tipo) throw new Error(`já instalado neste lugar no escopo ${anterior.escopo}. Rode desinstalar primeiro.`);
  // o "antes" das variáveis é o da primeira instalação: reinstalar não pode tomar o valor do próprio pacote como seu
  const envAnterior = anterior?.instalado ? anterior.envAnterior : envAntes(lerSettings(escopo.settings));
  const r = aplicar(escopo, { ligadas: acoes, envAnterior, configGanchos, simular });
  if (simular) return { ...r, estado: null };
  const dia = agora.toISOString().slice(0, 10);
  const estado = {
    instalado: true,
    escopo: escopo.tipo,
    settings: escopo.settings,
    projeto: escopo.projeto,
    instaladoEm: anterior?.instalado ? anterior.instaladoEm : agora.toISOString(),
    envAnterior,
    configGanchos,
    desligadas: [],
    acoes: Object.fromEntries(acoes.map((id) => {
      const velho = anterior?.instalado ? anterior.acoes?.[id] : null;
      if (velho) return [id, velho];
      const valor = base ? acaoPorId(id).medir(base) : null;
      return [id, { status: 'medindo', aplicadaEm: dia, base: valor == null ? null : { periodo: periodoBase, valor } }];
    })),
  };
  gravarJson(arquivoDeEstado(escopo), estado);
  return { ...r, estado };
}

export function desinstalar(escopo) {
  const estado = lerEstado(escopo);
  const envAnterior = estado?.envAnterior ?? Object.fromEntries(chavesDeEnv().map((k) => [k, null]));
  const atual = lerSettings(escopo.settings);
  // sem estado (instalação apagada à mão): tira só os ganchos; variável só sai se ainda tem o valor do pacote
  if (!estado) for (const a of ACOES) for (const [k, v] of Object.entries(a.env)) if (atual?.env?.[k] !== v) delete envAnterior[k];
  const novo = remover(atual, envAnterior);
  const mudou = JSON.stringify(atual) !== JSON.stringify(novo);
  if (mudou) gravarJson(escopo.settings, novo);
  fs.rmSync(path.join(escopo.pasta, 'ganchos'), { recursive: true, force: true });
  fs.rmSync(path.join(escopo.pasta, 'retomadas'), { recursive: true, force: true });
  if (estado) gravarJson(arquivoDeEstado(escopo), { ...estado, instalado: false, desinstaladoEm: new Date().toISOString() });
  return { mudou };
}

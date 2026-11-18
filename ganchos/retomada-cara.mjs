#!/usr/bin/env node
// GANCHO RETOMADA CARA (UserPromptSubmit): avisa, uma vez, antes de acordar uma sessão grande parada há mais de 1 hora.
//
// Por quê: depois de ~1 h sem resposta, o cache do Claude venceu e a próxima mensagem reescreve o contexto inteiro
// como tokens novos. A compactação ociosa do Claude Code (ação "compactacao-ociosa") cuida da maioria antes do cache
// vencer; este gancho pega o resto: contexto grande (padrão 200 mil tokens ou mais), ainda não compactado.
//
// O que faz: segura a mensagem UMA vez, grava um resumo de passagem sem IA (os últimos pedidos e a última resposta,
// na pasta "retomadas" ao lado da pasta dos ganchos, só nesta máquina) e mostra as duas saídas. Qualquer texto
// enviado nos 15 min seguintes segue nesta sessão, com a mensagem segurada devolvida junto (ninguém digita de novo).
// Ajustes em config.json: {"retomada": {"contextoMin": 200000, "paradaMin": 60, "liberarSe": "^\\[robo\\]"}}.
import fs from 'node:fs';
import path from 'node:path';
import { ehPrincipal, lerConfig, pastaDoGancho, rodarComoGancho } from './_comum.mjs';

export const PASTA_PADRAO = path.resolve(pastaDoGancho(import.meta.url), '..', 'retomadas');
export const PADROES = { paradaMin: 60, contextoMin: 200_000, janelaMin: 15, liberarSe: null };

function lerFim(arq, bytes = 768 * 1024) {
  const fd = fs.openSync(arq, 'r');
  try {
    const tam = fs.fstatSync(fd).size;
    const ini = Math.max(0, tam - bytes);
    const buf = Buffer.alloc(tam - ini);
    fs.readSync(fd, buf, 0, buf.length, ini);
    return buf.toString('utf8');
  } finally { fs.closeSync(fd); }
}

// A última resposta do modelo (hora e tamanho do contexto) e, para o resumo, os últimos pedidos e o último texto.
export function situacaoDaTranscricao(texto) {
  let ultima = null; let compactadaDepois = false; const pedidos = []; let ultimoTexto = '';
  for (const l of String(texto).split('\n')) {
    if (l.length < 2) continue;
    let j; try { j = JSON.parse(l); } catch { continue; }
    if (j.type === 'assistant' && j.message?.usage) {
      const u = j.message.usage;
      ultima = { ms: Date.parse(j.timestamp ?? ''), contexto: (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0) };
      compactadaDepois = false;
      const t = (Array.isArray(j.message.content) ? j.message.content : []).filter((b) => b?.type === 'text').map((b) => b.text).join('\n').trim();
      if (t) ultimoTexto = t;
    } else if (j.type === 'user') {
      if (j.isCompactSummary) compactadaDepois = true;
      const c = j.message?.content;
      const t = typeof c === 'string' ? c : Array.isArray(c) ? c.filter((b) => b?.type === 'text').map((b) => b.text).join(' ') : '';
      if (t && !j.isMeta && !/^<(task-notification|command-|local-command)/.test(t.trim())) pedidos.push(t.trim());
    }
  }
  return { ultima, compactadaDepois, pedidos: pedidos.slice(-8), ultimoTexto };
}

export function resumoDePassagem({ sessionId, cwd, transcricao, situacao }) {
  const corta = (s, n) => (s.length > n ? `${s.slice(0, n)}…` : s);
  return [
    `# Resumo de passagem (sem IA) da sessão ${sessionId}`,
    '',
    `Pasta: ${cwd ?? '?'}. Transcrição antiga (leia só por trecho, com busca, nunca inteira): ${transcricao}`,
    '',
    '## Últimos pedidos (do mais antigo ao mais novo)',
    ...situacao.pedidos.map((p) => `- ${corta(p.replace(/\s+/g, ' '), 600)}`),
    '',
    '## Última resposta da sessão',
    corta(situacao.ultimoTexto, 4000),
    '',
    '## Como seguir',
    'Confira o estado real (git status, arquivos, processos) antes de repetir qualquer passo.',
  ].join('\n');
}

export function decidir(entrada, { agora = Date.now(), pasta = PASTA_PADRAO, opcoes = {} } = {}) {
  const o = { ...PADROES, ...opcoes };
  const sid = String(entrada?.session_id ?? '');
  if (!/^[0-9a-f-]{36}$/i.test(sid) || !entrada?.transcript_path) return null;
  const marca = path.join(pasta, `${sid}.json`);
  // segunda mensagem dentro da janela: segue aqui e devolve a mensagem segurada
  if (fs.existsSync(marca)) {
    let m = null; try { m = JSON.parse(fs.readFileSync(marca, 'utf8')); } catch { /* marca ilegível */ }
    try { fs.unlinkSync(marca); } catch { /* já foi */ }
    if (m && agora - m.em < o.janelaMin * 60_000 && m.prompt) {
      return { hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: `Mensagem enviada antes do aviso de retomada cara (vale como parte desta): ${m.prompt}` } };
    }
  }
  const prompt = String(entrada.prompt ?? '');
  if (o.liberarSe && new RegExp(o.liberarSe).test(prompt.trim())) return null;
  const situacao = situacaoDaTranscricao(lerFim(entrada.transcript_path));
  const u = situacao.ultima;
  if (!u || !Number.isFinite(u.ms) || situacao.compactadaDepois) return null;
  const parada = agora - u.ms;
  if (parada < o.paradaMin * 60_000 || u.contexto < o.contextoMin) return null;
  fs.mkdirSync(pasta, { recursive: true });
  const arqPassagem = path.join(pasta, `${sid}.md`);
  fs.writeFileSync(arqPassagem, resumoDePassagem({ sessionId: sid, cwd: entrada.cwd, transcricao: entrada.transcript_path, situacao }));
  fs.writeFileSync(marca, JSON.stringify({ em: agora, prompt }));
  const mil = Math.round(u.contexto / 1000);
  const horas = (parada / 3_600_000).toLocaleString('pt-BR', { maximumFractionDigits: 1 });
  const caminho = arqPassagem.replaceAll('\\', '/');
  return {
    decision: 'block',
    reason: `Sessão parada há ${horas} h com cerca de ${mil} mil tokens de contexto. O cache venceu: responder aqui reescreve esses ${mil} mil tokens como novos (claude-economia-de-cota). `
      + '1) Para seguir aqui mesmo, envie qualquer texto (ex.: siga) nos próximos 15 min: sua mensagem volta junto, sem digitar de novo. '
      + `2) Para economizar, abra uma sessão nova nesta pasta e cole: Leia ${caminho} e siga de onde parou. O resumo já está pronto, sem IA.`,
  };
}

if (ehPrincipal(import.meta.url)) {
  const cfg = lerConfig(import.meta.url);
  rodarComoGancho((e) => decidir(e, { opcoes: cfg.retomada ?? {} }));
}

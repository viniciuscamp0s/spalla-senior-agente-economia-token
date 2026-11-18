// MEDIR: lê as transcrições do Claude Code desta máquina (~/.claude/projects/**/*.jsonl) e mede, por sessão,
// onde foram os tokens novos. Só leitura, sem rede, sem IA. Nada sai da máquina.
//
// "Tokens novos" = entrada + saída + escrita de cache. É o que pesa no limite da assinatura: reler o cache
// (cache_read) quase não pesa; o que gasta é o contexto que entra de novo e o que o modelo escreve.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';

export const LIMIARES_PADRAO = {
  sessaoLonga: 150, // respostas: depois disso cada resposta carrega um contexto enorme
  pausaCacheMin: 60, // o cache do Claude Code dura cerca de 1 h; pausa maior faz a resposta seguinte reescrever o contexto
  reescritaMinima: 40_000, // escrita de cache numa resposta só que conta como reescrita do contexto
  leituraRepetida: 3, // o mesmo arquivo lido inteiro N vezes ou mais na mesma sessão
  saidaGrande: 30_000, // caracteres de uma saída de ferramenta
  charsPorToken: 3.5,
};

// Pasta de configuração do Claude Code: CLAUDE_CONFIG_DIR, se existir; senão ~/.claude.
export function pastaDoClaude(env = process.env) {
  return env.CLAUDE_CONFIG_DIR ? path.resolve(env.CLAUDE_CONFIG_DIR) : path.join(os.homedir(), '.claude');
}

// O Claude Code guarda cada projeto numa pasta com o caminho trocado: todo caractere que não é letra ou número vira "-".
export const nomeDaPastaDoProjeto = (dir) => path.resolve(dir).replace(/[^A-Za-z0-9]/g, '-');

export function listarTranscricoes({ claudeDir = pastaDoClaude(), desdeMs = 0, projeto = null } = {}) {
  const raiz = path.join(claudeDir, 'projects');
  const saida = [];
  if (!fs.existsSync(raiz)) return saida;
  const alvo = projeto ? nomeDaPastaDoProjeto(projeto).toLowerCase() : null;
  const empurrar = (arq, nome, sub) => {
    try { if (fs.statSync(arq).mtimeMs >= desdeMs) saida.push({ arq, projeto: nome, sub }); } catch { /* sumiu no meio */ }
  };
  for (const pasta of fs.readdirSync(raiz, { withFileTypes: true })) {
    if (!pasta.isDirectory()) continue;
    if (alvo && pasta.name.toLowerCase() !== alvo) continue;
    const dir = path.join(raiz, pasta.name);
    for (const a of fs.readdirSync(dir, { withFileTypes: true })) {
      if (a.isFile() && a.name.endsWith('.jsonl')) empurrar(path.join(dir, a.name), pasta.name, false);
      else if (a.isDirectory()) {
        const sub = path.join(dir, a.name, 'subagents');
        if (fs.existsSync(sub)) for (const s of fs.readdirSync(sub)) if (s.endsWith('.jsonl')) empurrar(path.join(sub, s), pasta.name, true);
      }
    }
  }
  return saida;
}

const tamanhoDoResultado = (c) => {
  if (typeof c === 'string') return c.length;
  if (Array.isArray(c)) return c.reduce((t, b) => t + (typeof b?.text === 'string' ? b.text.length : 0), 0);
  return 0;
};

// O que acordou a sessão antes de uma resposta. É assim que se sabe de onde vem cada reescrita depois de pausa.
//   compactacao  = resumo de compactação
//   tarefa-fundo = uma tarefa em segundo plano terminou e acordou a sessão
//   recado       = outra sessão do Claude escreveu nesta
//   ferramenta   = só saída de ferramenta
//   usuario      = o resto: você escrevendo
// gatilhosExtras: { nome: "regex" } da configuração, testados antes do "usuario" (ex.: um robô seu que retoma sessões).
export function gatilhoDoTexto(texto, { compactacao = false, soFerramenta = false, extras = [] } = {}) {
  const t = String(texto ?? '').trim();
  if (compactacao) return 'compactacao';
  if (/<task-notification>/.test(t)) return 'tarefa-fundo';
  if (/cross-session-message|^Another Claude session/i.test(t)) return 'recado';
  for (const [nome, re] of extras) if (re.test(t)) return nome;
  if (!t && soFerramenta) return 'ferramenta';
  return 'usuario';
}

export const compilarExtras = (obj = {}) => Object.entries(obj).map(([nome, re]) => [nome, new RegExp(re, 'i')]);

// Mede uma transcrição dentro de [ini, fim). Recebe as linhas (qualquer iterável assíncrono ou não): testável sem arquivo.
export async function medirSessao(linhas, ini, fim, { limiares = LIMIARES_PADRAO, extras = [] } = {}) {
  const L = { ...LIMIARES_PADRAO, ...limiares };
  const respostas = new Map(); // message.id|requestId → { ms, modelo, t, gatilho }
  const ferramentas = new Map(); // tool_use_id → { nome, alvo, offset }
  const leituras = new Map(); // arquivo → { vezes, chars, primeira }
  const saidas = [];
  const agentes = [];
  let gatilho = null;
  for await (const linha of linhas) {
    if (linha.length < 2 || !(linha.includes('"usage"') || linha.includes('tool_result') || linha.includes('tool_use') || linha.includes('"type":"user"'))) continue;
    let j; try { j = JSON.parse(linha); } catch { continue; }
    const ms = Date.parse(j.timestamp ?? '');
    if (!(ms >= ini && ms < fim)) continue;
    const conteudo = Array.isArray(j.message?.content) ? j.message.content : [];
    if (j.type === 'assistant' && j.message?.usage) {
      const u = j.message.usage;
      const t = { entrada: u.input_tokens || 0, saida: u.output_tokens || 0, escrita: u.cache_creation_input_tokens || 0, leitura: u.cache_read_input_tokens || 0 };
      // uma resposta com vários blocos aparece em várias linhas com o mesmo id: conta uma vez
      const chave = `${j.message.id || ''}|${j.requestId || ''}`;
      const atual = respostas.get(chave);
      if (!atual) { respostas.set(chave, { ms, modelo: String(j.message.model || 'desconhecido').toLowerCase(), t, gatilho: gatilho ?? 'ferramenta' }); gatilho = null; }
      else for (const k of Object.keys(t)) atual.t[k] = Math.max(atual.t[k], t[k]);
      for (const b of conteudo) {
        if (b?.type !== 'tool_use') continue;
        const inp = b.input ?? {};
        let alvo = '';
        if (b.name === 'Read') alvo = String(inp.file_path ?? '');
        else if (b.name === 'Bash' || b.name === 'PowerShell') alvo = String(inp.command ?? '').trim().split(/\s+/).slice(0, 2).join(' ');
        else if (b.name === 'Agent' || b.name === 'Task') agentes.push({ modelo: inp.model || 'herdado', tipo: inp.subagent_type || 'general-purpose' });
        ferramentas.set(b.id, { nome: b.name, alvo, offset: inp.offset ?? null });
      }
    } else if (j.type === 'user') {
      const c = j.message?.content;
      const texto = typeof c === 'string' ? c : conteudo.filter((b) => b?.type === 'text').map((b) => b.text).join(' ');
      if (!j.isMeta) gatilho = gatilhoDoTexto(texto, { compactacao: Boolean(j.isCompactSummary), soFerramenta: conteudo.some((b) => b?.type === 'tool_result'), extras });
      for (const b of conteudo) {
        if (b?.type !== 'tool_result') continue;
        const f = ferramentas.get(b.tool_use_id);
        if (!f) continue;
        const chars = tamanhoDoResultado(b.content);
        if (f.nome === 'Read' && f.alvo && f.offset == null) {
          const l = leituras.get(f.alvo) ?? { vezes: 0, chars: 0, primeira: 0 };
          if (l.vezes === 0) l.primeira = chars;
          l.vezes += 1; l.chars += chars;
          leituras.set(f.alvo, l);
        }
        if (chars >= L.saidaGrande) saidas.push({ nome: f.nome, alvo: f.alvo, chars });
      }
    }
  }
  const lista = [...respostas.values()].sort((a, b) => a.ms - b.ms);
  const novos = (t) => t.entrada + t.saida + t.escrita;
  const m = { respostas: lista.length, novos: 0, abertura: 0, depoisDoLimite: 0, reescritaPorPausa: 0, pausas: 0, reescritas: [], porGatilho: {}, porModelo: {}, leiturasRepetidas: [], saidas, agentes, inicio: lista[0]?.ms ?? null };
  lista.forEach((r, i) => {
    const n = novos(r.t);
    m.novos += n;
    m.porModelo[r.modelo] = (m.porModelo[r.modelo] ?? 0) + n;
    if (i === 0) m.abertura = r.t.escrita;
    if (i >= L.sessaoLonga) m.depoisDoLimite += n;
    if (i > 0 && r.ms - lista[i - 1].ms > L.pausaCacheMin * 60_000 && r.t.escrita >= L.reescritaMinima) {
      m.reescritaPorPausa += r.t.escrita; m.pausas += 1; m.reescritas.push(r.t.escrita);
      m.porGatilho[r.gatilho] = (m.porGatilho[r.gatilho] ?? 0) + r.t.escrita;
    }
  });
  for (const [arq, l] of leituras) if (l.vezes >= L.leituraRepetida) m.leiturasRepetidas.push({ arq, vezes: l.vezes, charsExtras: l.chars - l.primeira });
  return m;
}

const linhasDoArquivo = (arq) => readline.createInterface({ input: fs.createReadStream(arq, { encoding: 'utf8' }), crlfDelay: Infinity });

export async function medirPeriodo({ ini, fim, claudeDir, projeto, limiares, extras, aoFalhar = () => {} }) {
  const sessoes = [];
  for (const { arq, projeto: nome, sub } of listarTranscricoes({ claudeDir, desdeMs: ini, projeto })) {
    try {
      const m = await medirSessao(linhasDoArquivo(arq), ini, fim, { limiares, extras });
      if (m.respostas) sessoes.push({ arq: path.basename(arq), projeto: nome, sub, ...m });
    } catch (e) { aoFalhar(arq, e); }
  }
  return sessoes;
}

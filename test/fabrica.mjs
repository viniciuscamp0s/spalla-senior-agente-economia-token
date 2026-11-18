// FÁBRICA DE TRANSCRIÇÕES FICTÍCIAS para os testes. Nenhum dado real: ids, caminhos e textos são inventados.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let seq = 0;
const id = () => `msg_${String(++seq).padStart(6, '0')}`;
export const iso = (ms) => new Date(ms).toISOString();

export function resposta(ms, { modelo = 'claude-sonnet-exemplo', entrada = 10, saida = 500, escrita = 0, leitura = 0, ferramentas = [] } = {}) {
  return {
    type: 'assistant', timestamp: iso(ms), requestId: `req_${seq}`,
    message: { id: id(), model: modelo, usage: { input_tokens: entrada, output_tokens: saida, cache_creation_input_tokens: escrita, cache_read_input_tokens: leitura }, content: [{ type: 'text', text: 'ok' }, ...ferramentas] },
  };
}
export const usuario = (ms, texto, extra = {}) => ({ type: 'user', timestamp: iso(ms), message: { role: 'user', content: texto }, ...extra });
export const resultado = (ms, toolId, chars) => ({ type: 'user', timestamp: iso(ms), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolId, content: 'x'.repeat(chars) }] } });
export const leitura = (toolId, arq) => ({ type: 'tool_use', id: toolId, name: 'Read', input: { file_path: arq } });

// Uma sessão típica: abertura de 60 mil, pausa de 2 h acordada por tarefa em segundo plano, arquivo lido 3 vezes,
// saída grande, e um subagente no modelo caro.
export function sessaoTipica(t0) {
  const M = 60_000;
  return [
    usuario(t0, 'arrume o teste que falha'),
    resposta(t0 + 1 * M, { escrita: 60_000, ferramentas: [leitura('t1', '/projeto-exemplo/lib/grande.js')] }),
    resultado(t0 + 2 * M, 't1', 40_000),
    resposta(t0 + 3 * M, { leitura: 60_000, ferramentas: [leitura('t2', '/projeto-exemplo/lib/grande.js')] }),
    resultado(t0 + 4 * M, 't2', 40_000),
    resposta(t0 + 5 * M, { leitura: 70_000, ferramentas: [leitura('t3', '/projeto-exemplo/lib/grande.js')] }),
    resultado(t0 + 6 * M, 't3', 40_000),
    resposta(t0 + 7 * M, { leitura: 80_000 }),
    usuario(t0 + 130 * M, '<task-notification>build terminou</task-notification>'),
    resposta(t0 + 131 * M, { escrita: 150_000 }),
  ];
}

export function criarClaudeFalso({ t0, projetoDir = path.join(os.tmpdir(), 'projeto-exemplo') } = {}) {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'economia-teste-'));
  const nome = path.resolve(projetoDir).replace(/[^A-Za-z0-9]/g, '-');
  const dir = path.join(raiz, 'projects', nome);
  const sid = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
  fs.mkdirSync(path.join(dir, sid, 'subagents'), { recursive: true });
  const linhas = (l) => `${l.map((x) => JSON.stringify(x)).join('\n')}\n`;
  fs.writeFileSync(path.join(dir, `${sid}.jsonl`), linhas(sessaoTipica(t0)));
  fs.writeFileSync(path.join(dir, sid, 'subagents', 'agent-exemplo.jsonl'), linhas([
    usuario(t0 + 10_000, 'procure X'),
    resposta(t0 + 20_000, { modelo: 'claude-opus-exemplo', escrita: 30_000, saida: 2_000 }),
  ]));
  // a data de modificação acompanha a última linha, como num arquivo de verdade
  const ultima = new Date(t0 + 131 * 60_000);
  fs.utimesSync(path.join(dir, `${sid}.jsonl`), ultima, ultima);
  fs.utimesSync(path.join(dir, sid, 'subagents', 'agent-exemplo.jsonl'), ultima, ultima);
  return { raiz, projetoDir, sid };
}

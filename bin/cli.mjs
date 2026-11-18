#!/usr/bin/env node
// claude-economia-de-cota: diagnóstico semanal do consumo do Claude Code e as ações seguras que economizam cota.
// Só Node, sem dependências, sem chave, sem rede. Lê as transcrições desta máquina; nada sai daqui.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ACOES } from '../lib/acoes.mjs';
import { diagnosticar, pct } from '../lib/diagnostico.mjs';
import { rodada } from '../lib/executor.mjs';
import { aplicar, desinstalar, gravarJson, instalar, lerEstado, resolverEscopo, arquivoDeEstado } from '../lib/instalar.mjs';
import { compilarExtras, medirPeriodo, pastaDoClaude, LIMIARES_PADRAO } from '../lib/medir.mjs';
import { gerarHtml, gerarMarkdown, manchete } from '../lib/relatorio.mjs';
import { periodo } from '../lib/periodo.mjs';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VERSAO = JSON.parse(fs.readFileSync(path.join(RAIZ, 'package.json'), 'utf8')).version;

const AJUDA = `claude-economia-de-cota ${VERSAO}

USO
  npx claude-economia-de-cota [comando] [opções]

COMANDOS
  diagnostico   (padrão) mede os últimos 7 dias e grava o relatório em HTML, Markdown e JSON
  instalar      liga as ações seguras NESTE projeto (.claude/settings.local.json), com a base de antes
  semanal       mede a semana que fechou, mantém a ação que economizou e desliga a que não economizou
  status        mostra o que está instalado e onde
  desinstalar   tira tudo o que o pacote pôs, devolvendo as suas variáveis como eram
  acoes         lista as ações do catálogo

OPÇÕES
  --projeto <pasta>   projeto alvo (padrão: a pasta atual). No diagnóstico, filtra as sessões desse projeto
  --todos             diagnóstico de todos os projetos (padrão do diagnóstico sem --projeto)
  --usuario           instalar/semanal/desinstalar na configuração do usuário (vale para toda sessão da máquina)
  --compartilhado     instalar em .claude/settings.json do projeto (vai para o git, vale para o time)
  --acoes a,b         instalar só estas ações (veja "acoes")
  --dias <n>          tamanho do período do diagnóstico (padrão 7)
  --desde AAAA-MM-DD  início do período (com --ate, opcional)
  --ate AAAA-MM-DD    fim do período (exclusivo)
  --saida <pasta>     onde gravar o relatório (padrão: ./relatorio-economia-de-cota)
  --formato <lista>   html,md,json (padrão: os três)
  --config <arquivo>  configuração opcional (padrão: ./economia-de-cota.config.json, se existir)
  --abrir             abre o relatório HTML no navegador
  --simular           instalar: mostra o que mudaria, sem gravar
`;

function lerArgs(argv) {
  const a = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i];
    if (!x.startsWith('--')) { a._.push(x); continue; }
    const k = x.slice(2);
    if (['todos', 'usuario', 'compartilhado', 'abrir', 'simular', 'ajuda', 'help', 'versao', 'version'].includes(k)) a[k] = true;
    else a[k] = argv[++i];
  }
  return a;
}

function lerConfig(arq) {
  const alvo = arq ? path.resolve(arq) : path.resolve('economia-de-cota.config.json');
  if (!fs.existsSync(alvo)) { if (arq) throw new Error(`configuração não encontrada: ${alvo}`); return {}; }
  return JSON.parse(fs.readFileSync(alvo, 'utf8').replace(/^﻿/, ''));
}

async function medir({ p, cfg, projeto }) {
  const limiares = { ...LIMIARES_PADRAO, ...(cfg.limiares ?? {}) };
  let falhas = 0;
  const sessoes = await medirPeriodo({ ini: p.ini, fim: p.fim, claudeDir: pastaDoClaude(), projeto, limiares, extras: compilarExtras(cfg.gatilhos), aoFalhar: () => { falhas += 1; } });
  if (falhas) console.error(`aviso: ${falhas} transcrição(ões) ilegível(is) foram puladas`);
  return diagnosticar(sessoes, { limiares });
}

function gravarRelatorio(dados, pasta, formatos, nome) {
  fs.mkdirSync(pasta, { recursive: true });
  const saidas = [];
  if (formatos.includes('json')) { const f = path.join(pasta, `${nome}.json`); gravarJson(f, dados); saidas.push(f); }
  if (formatos.includes('md')) { const f = path.join(pasta, `${nome}.md`); fs.writeFileSync(f, gerarMarkdown(dados)); saidas.push(f); }
  if (formatos.includes('html')) { const f = path.join(pasta, `${nome}.html`); fs.writeFileSync(f, gerarHtml(dados)); saidas.push(f); }
  return saidas;
}

function abrir(arq) {
  const [cmd, args] = process.platform === 'win32' ? ['cmd', ['/c', 'start', '""', arq]] : process.platform === 'darwin' ? ['open', [arq]] : ['xdg-open', [arq]];
  try { spawn(cmd, args, { detached: true, stdio: 'ignore' }).unref(); } catch { /* sem navegador: o caminho já foi impresso */ }
}

const montar = ({ d, p, escopo, cfg, acoes = null }) => ({
  ferramenta: 'claude-economia-de-cota', versao: VERSAO, geradoEm: new Date().toISOString(), periodo: p.rotulo, escopo,
  total: d.total, resumo: d.resumo, medidas: d.medidas, oportunidades: d.oportunidades, acoes, tokensPorPorcento: cfg.tokensPorPorcento ?? null,
});

const escopoDeMedida = (e) => (e.tipo === 'usuario' ? { projeto: null, rotulo: 'todos os projetos' } : { projeto: e.projeto, rotulo: `projeto ${path.basename(e.projeto)}` });

async function principal() {
  const a = lerArgs(process.argv.slice(2));
  if (a.versao || a.version) { console.log(VERSAO); return; }
  const cmd = a._[0] ?? 'diagnostico';
  if (a.ajuda || a.help || ['ajuda', 'help'].includes(cmd)) { console.log(AJUDA); return; }
  const cfg = lerConfig(a.config);
  const escopo = () => resolverEscopo({ projeto: a.projeto ?? process.cwd(), usuario: a.usuario, compartilhado: a.compartilhado });

  if (cmd === 'acoes') {
    for (const x of ACOES) console.log(`${x.id}\n  ${x.titulo}\n  ${x.oQueFaz}${x.requisito ? `\n  Requisito: ${x.requisito}` : ''}\n`);
    return;
  }

  if (cmd === 'diagnostico') {
    const p = periodo({ dias: a.dias ?? 7, desde: a.desde, ate: a.ate });
    const projeto = a.projeto && !a.todos ? path.resolve(a.projeto) : null;
    const d = await medir({ p, cfg, projeto });
    const dados = montar({ d, p, escopo: projeto ? `projeto ${path.basename(projeto)}` : 'todos os projetos', cfg });
    const formatos = String(a.formato ?? 'html,md,json').split(',');
    const saidas = gravarRelatorio(dados, path.resolve(a.saida ?? 'relatorio-economia-de-cota'), formatos, `economia-de-cota-${p.rotulo.fim}`);
    console.log(manchete(dados));
    for (const o of d.oportunidades.slice(0, 3)) console.log(`  - ${o.titulo}: cerca de ${pct(o.fracao)}`);
    console.log(`\nRelatório:\n${saidas.map((s) => `  ${s}`).join('\n')}`);
    if (a.abrir) { const h = saidas.find((s) => s.endsWith('.html')); if (h) abrir(h); }
    return;
  }

  if (cmd === 'instalar') {
    const e = escopo();
    const acoes = a.acoes ? String(a.acoes).split(',').map((s) => s.trim()).filter(Boolean) : ACOES.map((x) => x.id);
    const configGanchos = { ...(cfg.subagentes ? { subagentes: cfg.subagentes } : {}), ...(cfg.retomada ? { retomada: cfg.retomada } : {}) };
    // a base: os 7 dias inteiros antes de hoje, no mesmo escopo que o "semanal" vai medir depois
    const p = periodo({ dias: 7, inteiro: true });
    const d = a.simular ? null : await medir({ p, cfg, projeto: escopoDeMedida(e).projeto });
    const r = instalar(e, { acoes, base: d?.medidas ?? null, periodoBase: p.rotulo, configGanchos, simular: a.simular });
    if (a.simular) { console.log(`Simulação (${e.tipo}): ${r.mudou ? 'mudaria' : 'nada mudaria em'} ${e.settings}`); console.log(JSON.stringify({ env: r.novo.env, hooks: r.novo.hooks }, null, 2)); return; }
    console.log(`Instalado (${e.tipo}) em ${e.settings}`);
    for (const id of acoes) console.log(`  + ${id}${r.estado.acoes[id].base ? ` (base: ${pct(r.estado.acoes[id].base.valor)})` : ' (sem base: não havia uso nos 7 dias anteriores)'}`);
    console.log('\nVale para as sessões abertas a partir de agora. Daqui a 8 dias, rode "semanal" (mesmas opções) para medir e desligar o que não economizou.');
    console.log('Para desfazer tudo: desinstalar (mesmas opções).');
    return;
  }

  if (cmd === 'semanal') {
    const e = escopo();
    const estado = lerEstado(e);
    if (!estado?.instalado) throw new Error(`nada instalado em ${e.pasta}. Rode "instalar" primeiro (ou use as mesmas opções da instalação).`);
    const p = periodo({ dias: 7, inteiro: true });
    const m = escopoDeMedida(e);
    const d = await medir({ p, cfg, projeto: m.projeto });
    const r = rodada({ acoes: estado.acoes, medidas: d.medidas, periodo: p.rotulo, tokensNovos: d.total });
    const novo = { ...estado, acoes: r.acoes, desligadas: [...new Set([...(estado.desligadas ?? []), ...r.desligar])], ultimaSemana: p.rotulo };
    if (r.desligar.length) {
      const ligadas = Object.keys(novo.acoes).filter((id) => !novo.desligadas.includes(id));
      aplicar(e, { ligadas, envAnterior: estado.envAnterior, configGanchos: estado.configGanchos });
    }
    gravarJson(arquivoDeEstado(e), novo);
    const dados = montar({ d, p, escopo: m.rotulo, cfg, acoes: r.relatorio });
    const saidas = gravarRelatorio(dados, a.saida ? path.resolve(a.saida) : path.join(e.pasta, 'relatorios'), String(a.formato ?? 'html,md,json').split(','), `semana-${p.rotulo.fim}`);
    console.log(manchete(dados));
    for (const x of r.relatorio) console.log(`  ${x.id}: ${x.status}`);
    if (r.desligar.length) console.log(`Desligadas por não economizar: ${r.desligar.join(', ')}`);
    console.log(`\nRelatório:\n${saidas.map((s) => `  ${s}`).join('\n')}`);
    if (a.abrir) { const h = saidas.find((s) => s.endsWith('.html')); if (h) abrir(h); }
    return;
  }

  if (cmd === 'status') {
    const e = escopo();
    const st = lerEstado(e);
    if (!st?.instalado) { console.log(`Nada instalado em ${e.pasta} (${e.tipo}).`); return; }
    console.log(`Instalado (${st.escopo}) em ${st.settings} desde ${st.instaladoEm.slice(0, 10)}`);
    for (const [id, x] of Object.entries(st.acoes)) console.log(`  ${id}: ${x.status}${x.base ? ` (base ${pct(x.base.valor)})` : ''}`);
    return;
  }

  if (cmd === 'desinstalar') {
    const e = escopo();
    const r = desinstalar(e);
    console.log(r.mudou ? `Removido de ${e.settings}. Suas outras configurações ficaram como estavam.` : `Nada do pacote em ${e.settings}.`);
    return;
  }

  throw new Error(`comando desconhecido: ${cmd}. Veja --ajuda.`);
}

principal().catch((e) => { console.error(`erro: ${e.message}`); process.exit(1); });

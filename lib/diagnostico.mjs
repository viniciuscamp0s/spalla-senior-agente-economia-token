// DIAGNÓSTICO: das medidas de cada sessão às oportunidades de economia, com regras fixas (sem IA).
// Cada oportunidade diz o achado em número, de onde ele veio, o que fazer, o risco e qual ação deste pacote ataca o
// problema (campo "acaoDoPacote", instalável com `instalar`).

import path from 'node:path';
import { LIMIARES_PADRAO } from './medir.mjs';

export const mil = (n) => (n >= 1e6 ? `${(n / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} ${n < 2e6 ? 'milhão' : 'milhões'}` : `${Math.round(n / 1000).toLocaleString('pt-BR')} mil`);
// "2 milhões tokens" → "2 milhões de tokens"
export const deTokens = (s) => String(s).replace(/(milhão|milhões) (tokens?)/g, '$1 de $2');
export const pct = (x) => `${(x * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
const soma = (l, f) => l.reduce((t, x) => t + f(x), 0);
const mediana = (l) => { const o = [...l].sort((a, b) => a - b); return o.length ? o[Math.floor(o.length / 2)] : null; };

export function tamanhoDoGanho(fracao) {
  if (fracao >= 0.05) return 'relevante';
  if (fracao >= 0.01) return 'média';
  return 'pequena';
}

export const NOMES_DOS_GATILHOS = {
  usuario: 'você voltou a escrever',
  'tarefa-fundo': 'uma tarefa em segundo plano terminou',
  recado: 'outra sessão escreveu nesta',
  compactacao: 'compactação',
  ferramenta: 'saída de ferramenta',
};

export function diagnosticar(sessoes, { limiares = LIMIARES_PADRAO } = {}) {
  const L = { ...LIMIARES_PADRAO, ...limiares };
  const total = soma(sessoes, (s) => s.novos);
  const principais = sessoes.filter((s) => !s.sub);
  const subs = sessoes.filter((s) => s.sub);
  if (!total) return { total: 0, oportunidades: [], resumo: { sessoes: 0, subagentes: 0, porModelo: {}, longas: 0 }, medidas: null };
  const ops = [];

  // 1. Reescrita do contexto depois de pausa (cache vencido). Ganho = só o que passa do custo de abrir sessão nova
  //    (mediana da abertura + ~10 mil de resumo de passagem).
  const aberturas = principais.map((s) => s.abertura).filter(Boolean);
  const aberturaMediana = mediana(aberturas);
  const custoNova = (aberturaMediana ?? 50_000) + 10_000;
  const reescrita = soma(sessoes, (s) => s.reescritaPorPausa);
  const pausas = soma(sessoes, (s) => s.pausas);
  const todas = sessoes.flatMap((s) => s.reescritas ?? []);
  const evitavel = soma(todas, (e) => Math.max(0, e - custoNova));
  const caras = todas.filter((e) => e > custoNova).length;
  const porGatilho = {};
  for (const x of principais) for (const [g, n] of Object.entries(x.porGatilho ?? {})) porGatilho[g] = (porGatilho[g] ?? 0) + n;
  if (reescrita) {
    const quebra = Object.entries(porGatilho).sort((a, b) => b[1] - a[1]).map(([g, n]) => `${NOMES_DOS_GATILHOS[g] ?? g} ${pct(n / total)}`).join(', ');
    ops.push({
      id: 'reescrita-apos-pausa', fracao: evitavel / total, acaoDoPacote: ['compactacao-ociosa', 'retomada-cara', 'espera-curta'],
      titulo: 'Contexto reescrito depois de pausa de mais de 1 hora',
      explicacao: 'O Claude guarda a conversa num cache que dura cerca de 1 hora. Se a sessão fica parada mais que isso e você (ou uma tarefa em segundo plano) a acorda, a conversa inteira entra de novo e é cobrada como nova.',
      achado: `${pausas} retomadas depois de pausa de mais de ${L.pausaCacheMin} min reescreveram o contexto inteiro: ${mil(reescrita)} tokens novos (${pct(reescrita / total)} do período). Em ${caras} delas, sair numa sessão nova teria sido mais barato (custo de abrir: ${mil(custoNova)}).${quebra ? ` O que acordou a sessão: ${quebra}.` : ''}`,
      evidencia: `Respostas com escrita de cache de ${mil(L.reescritaMinima)} tokens ou mais logo depois de uma pausa de mais de ${L.pausaCacheMin} min.`,
      acao: 'Sessão grande parada há mais de 1 hora: abra uma sessão nova com um resumo do que falta, em vez de continuar na antiga. Espera longa (build, horário) em segundo plano acorda no máximo a cada 45 min.',
      risco: 'Sessão nova perde o fio se o resumo for ruim; só vale acima do custo de abertura.',
    });
  }

  // 2. Sessões longas: o que veio depois da resposta N.
  const longas = principais.filter((s) => s.respostas > L.sessaoLonga);
  const depois = soma(longas, (s) => s.depoisDoLimite);
  if (longas.length) ops.push({
    id: 'sessoes-longas', fracao: depois / total, teto: true, acaoDoPacote: [],
    titulo: `Sessões com mais de ${L.sessaoLonga} respostas`,
    explicacao: 'Cada resposta carrega a conversa inteira até ali. Numa sessão muito longa, cada passo custa caro, mesmo os pequenos.',
    achado: `${longas.length} de ${principais.length} sessões passaram de ${L.sessaoLonga} respostas e gastaram ${mil(depois)} tokens novos depois da resposta ${L.sessaoLonga} (${pct(depois / total)} do período). A maior teve ${Math.max(...longas.map((s) => s.respostas))} respostas.`,
    evidencia: 'Respostas únicas por transcrição principal, sem subagentes.',
    acao: 'Uma sessão, uma entrega. Passou do limite: peça um resumo de passagem e continue numa sessão nova.',
    risco: 'Baixo. O ganho real é menor que o número bruto, porque o trabalho continuaria em outra sessão.',
  });

  // 3. Abertura de sessão (CLAUDE.md, memória, skills, ferramentas MCP).
  if (aberturas.length) {
    const somaAb = soma(aberturas, (x) => x);
    ops.push({
      id: 'abertura', fracao: (somaAb * 0.2) / total, acaoDoPacote: [],
      titulo: 'Custo de abrir sessão',
      explicacao: 'Toda sessão nova começa lendo as suas instruções (CLAUDE.md, memória, lista de skills e de ferramentas). Isso é pago de novo a cada sessão.',
      achado: `${aberturas.length} sessões abertas; a primeira resposta de cada uma escreve ${mil(aberturaMediana)} tokens (mediana), ${mil(somaAb)} no total (${pct(somaAb / total)} do período).`,
      evidencia: 'Escrita de cache da primeira resposta de cada transcrição principal.',
      acao: 'Enxugar o que carrega sempre: mover explicações longas do CLAUDE.md para arquivos lidos só quando precisa, desligar servidores MCP sem uso. Cortar 20% da abertura economiza o valor estimado.',
      risco: 'Regra tirada da abertura deixa de ser seguida: corte texto repetido ou sem uso, nunca regra.',
    });
  }

  // 4. Mesmo arquivo lido inteiro várias vezes na mesma sessão.
  const rep = sessoes.flatMap((s) => s.leiturasRepetidas);
  const repTokens = soma(rep, (l) => l.charsExtras) / L.charsPorToken;
  if (rep.length) {
    const top = [...rep].sort((a, b) => b.charsExtras - a.charsExtras).slice(0, 3).map((l) => `${path.basename(l.arq)} (${l.vezes}x)`).join(', ');
    ops.push({
      id: 'leitura-repetida', fracao: repTokens / total, acaoDoPacote: [],
      titulo: 'Mesmo arquivo lido inteiro várias vezes na sessão',
      explicacao: 'Ler um arquivo grande inteiro de novo, sem ele ter mudado, põe tudo no contexto outra vez.',
      achado: `${rep.length} casos de arquivo lido inteiro ${L.leituraRepetida} vezes ou mais na mesma sessão: cerca de ${mil(repTokens)} tokens de releitura. Maiores: ${top}.`,
      evidencia: `Leituras sem trecho definido do mesmo caminho na mesma sessão; tokens estimados a ${L.charsPorToken} caracteres por token.`,
      acao: 'Depois da primeira leitura, peça busca por trecho (Grep com contexto, ou leitura com início e limite de linhas).',
      risco: 'Nenhum.',
    });
  }

  // 5. Saídas de ferramenta grandes.
  const grandes = sessoes.flatMap((s) => s.saidas);
  const grTokens = soma(grandes, (g) => g.chars) / L.charsPorToken;
  if (grandes.length) {
    const porAlvo = new Map();
    for (const g of grandes) { const k = `${g.nome}: ${g.alvo || '-'}`; porAlvo.set(k, (porAlvo.get(k) ?? 0) + g.chars); }
    const top = [...porAlvo].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, c]) => `${k} (${mil(c / L.charsPorToken)})`).join('; ');
    ops.push({
      id: 'saidas-grandes', fracao: (grTokens * 0.5) / total, acaoDoPacote: [],
      titulo: `Saídas de ferramenta acima de ${mil(L.saidaGrande)} caracteres`,
      explicacao: 'Log de teste, listagem enorme, arquivo despejado no terminal: tudo isso entra no contexto e fica lá pelo resto da sessão.',
      achado: `${grandes.length} saídas grandes somaram cerca de ${mil(grTokens)} tokens. Maiores: ${top}.`,
      evidencia: 'Tamanho de cada resultado de ferramenta, casado com a chamada que o pediu.',
      acao: 'Filtrar a saída (head, grep, --quiet, só as linhas de erro) ou mandar a leitura em volume a um subagente barato que devolve só a conclusão. Ganho estimado: metade.',
      risco: 'Filtro errado esconde a linha do erro: filtre por padrão, não por corte cego.',
    });
  }

  // 6. Modelo dos subagentes.
  const subPorModelo = {};
  for (const s of subs) for (const [mo, n] of Object.entries(s.porModelo)) subPorModelo[mo] = (subPorModelo[mo] ?? 0) + n;
  const subTotal = soma(Object.values(subPorModelo), (x) => x);
  const caro = (mo) => /opus|fable/.test(mo);
  const subCaro = soma(Object.entries(subPorModelo).filter(([mo]) => caro(mo)), ([, n]) => n);
  if (subTotal) ops.push({
    id: 'subagente-caro', fracao: (subCaro * 0.5) / total, acaoDoPacote: ['subagente-barato'],
    titulo: 'Subagentes rodando no modelo mais caro',
    explicacao: 'Subagente sem modelo escolhido herda o modelo da sessão. Se você trabalha no modelo mais caro, toda busca e leitura feita por subagente sai no mais caro também.',
    achado: `Subagentes gastaram ${mil(subTotal)} tokens novos (${pct(subTotal / total)} do período), ${pct(subCaro / subTotal)} deles no modelo mais caro. Por modelo: ${Object.entries(subPorModelo).map(([mo, n]) => `${mo} ${mil(n)}`).join(', ')}.`,
    evidencia: 'Transcrições em <sessão>/subagents/, tokens novos por modelo.',
    acao: 'Busca e leitura em volume num modelo barato (Haiku ou Sonnet); decisão e revisão continuam no seu modelo. O ganho estimado supõe metade do custo por token (o peso exato de cada modelo no limite não é publicado).',
    risco: 'Modelo barato erra mais em leitura fina de código: use em busca e resumo.',
  });

  const porModelo = {};
  for (const s of sessoes) for (const [mo, n] of Object.entries(s.porModelo)) porModelo[mo] = (porModelo[mo] ?? 0) + n;
  // As medidas que o executor compara de um período para o outro, em fração dos tokens novos (assim trabalhar mais
  // ou menos numa semana não engana a comparação).
  const fr = (n) => Math.round((n / total) * 10_000) / 10_000;
  const medidas = {
    reescritaPausaFrac: fr(soma(principais, (x) => x.reescritaPorPausa)),
    reescritaPorGatilhoFrac: Object.fromEntries(Object.entries(porGatilho).map(([g, n]) => [g, fr(n)])),
    aberturaMediana,
    subagenteFrac: fr(subTotal),
    subagenteCaroFrac: subTotal ? Math.round((subCaro / subTotal) * 10_000) / 10_000 : null,
    longasFrac: fr(soma(principais, (x) => x.depoisDoLimite)),
  };
  for (const o of ops) o.ganho = tamanhoDoGanho(o.fracao);
  ops.sort((a, b) => b.fracao - a.fracao);
  return {
    total,
    oportunidades: ops,
    resumo: { sessoes: principais.length, subagentes: subs.length, porModelo, longas: longas.length, respostas: soma(principais, (s) => s.respostas) },
    medidas,
  };
}

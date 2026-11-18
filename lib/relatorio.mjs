// RELATÓRIO: o mesmo diagnóstico em Markdown (lê no terminal e no GitHub) e em HTML (abre no navegador, claro e
// escuro, celular e computador). Linguagem para quem não é técnico: o achado, o porquê e o que fazer.

import { deTokens, mil, pct, NOMES_DOS_GATILHOS } from './diagnostico.mjs';

const STATUS = {
  mantida: ['funcionou e fica ligada', 'ok'],
  desfeita: ['não ajudou e foi desligada', 'alerta'],
  medindo: ['medindo (precisa de 7 dias inteiros depois de instalar)', 'neutro'],
  'sem-base': ['ligada; sem uso antes da instalação para comparar', 'neutro'],
  'nada-a-medir': ['ligada; o problema não aparecia antes', 'neutro'],
};
const GANHO = { relevante: 'alto', média: 'médio', pequena: 'baixo' };

const fmtPct = (x) => (x == null ? '-' : pct(x));
const emCota = (tokens, porPct) => (porPct ? ` (cerca de ${(tokens / porPct).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}% da cota semanal)` : '');

export function manchete(d) { return deTokens(mancheteCrua(d)); }
function mancheteCrua(d) {
  if (!d.total) return 'Nenhuma resposta do Claude Code encontrada no período.';
  const top = d.oportunidades[0];
  const base = `Em ${d.periodo.dias} dias você gastou ${mil(d.total)} tokens novos${emCota(d.total, d.tokensPorPorcento)} em ${d.resumo.sessoes} sessões.`;
  return top ? `${base} O maior vazamento: ${top.titulo.toLowerCase()}, cerca de ${pct(top.fracao)} do total.` : base;
}

const linhaAcao = (a) => {
  const [txt] = STATUS[a.status] ?? [a.status];
  const nums = a.base != null ? ` Antes: ${fmtPct(a.base)}${a.depois != null ? `, depois: ${fmtPct(a.depois)}` : ''}.` : '';
  const eco = a.economia ? ` Economia estimada: ${mil(a.economia)} tokens.` : '';
  return { txt, nums, eco };
};

export function gerarMarkdown(d) {
  const L = [];
  if (d.exemplo) L.push('> **EXEMPLO COM NÚMEROS FICTÍCIOS.** Nada aqui vem de uso real.', '');
  L.push(`# Economia de cota do Claude Code: ${d.periodo.ini} a ${d.periodo.fim}`, '');
  L.push(`**${manchete(d)}**`, '');
  L.push(`Escopo: ${d.escopo}. Tokens novos = entrada + saída + escrita de cache (o que pesa no limite; reler o cache quase não pesa).`, '');
  if (d.total) {
    L.push('## Resumo', '', '| Medida | Valor |', '|---|---|');
    L.push(`| Sessões | ${d.resumo.sessoes} (mais ${d.resumo.subagentes} transcrições de subagente) |`);
    L.push(`| Respostas | ${d.resumo.respostas.toLocaleString('pt-BR')} |`);
    L.push(`| Tokens novos | ${mil(d.total)}${emCota(d.total, d.tokensPorPorcento)} |`);
    L.push(`| Reescrita depois de pausa | ${fmtPct(d.medidas.reescritaPausaFrac)} |`);
    L.push(`| Abertura de sessão (mediana) | ${d.medidas.aberturaMediana ? `${mil(d.medidas.aberturaMediana)} tokens` : '-'} |`);
    L.push(`| Subagentes | ${fmtPct(d.medidas.subagenteFrac)} do total, ${fmtPct(d.medidas.subagenteCaroFrac)} deles no modelo mais caro |`);
    L.push(`| Por modelo | ${Object.entries(d.resumo.porModelo).sort((a, b) => b[1] - a[1]).map(([m, n]) => `${m} ${mil(n)}`).join(', ')} |`, '');
    L.push('## Onde dá para economizar (do maior para o menor)', '');
    d.oportunidades.forEach((o, i) => {
      L.push(`### ${i + 1}. ${o.titulo} (ganho ${GANHO[o.ganho]}: cerca de ${pct(o.fracao)})`, '');
      L.push(`- **O que é:** ${o.explicacao}`, `- **O que achei:** ${o.achado}`, `- **O que fazer:** ${o.acao}`);
      if (o.acaoDoPacote?.length) L.push(`- **O pacote faz sozinho:** ${o.acaoDoPacote.join(', ')} (\`instalar\`).`);
      L.push(`- **Risco:** ${o.risco}`, `- **De onde vem o número:** ${o.evidencia}`, '');
    });
  }
  if (d.acoes?.length) {
    L.push('## Ações instaladas e o resultado de cada uma', '', '| Ação | Situação | Métrica |', '|---|---|---|');
    for (const a of d.acoes) { const { txt, nums, eco } = linhaAcao(a); L.push(`| ${a.titulo} | ${txt}.${nums}${eco} | ${a.metrica} |`); }
    L.push('');
  } else if (d.total) {
    L.push('## Próximo passo', '', 'Instale as ações seguras neste projeto (`npx claude-economia-de-cota instalar`). Uma semana depois, `semanal` mede cada uma e desliga sozinho a que não economizou.', '');
  }
  L.push('---', `Gerado em ${d.geradoEm} por claude-economia-de-cota. Lido só nesta máquina; nada foi enviado para fora.`);
  return deTokens(`${L.join('\n')}\n`);
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function gerarHtml(d) { return deTokens(htmlCru(d)); }
function htmlCru(d) {
  const ops = d.oportunidades.map((o, i) => `
    <article class="card">
      <header><span class="n">${i + 1}</span><h3>${esc(o.titulo)}</h3><span class="tag g-${esc(GANHO[o.ganho])}">ganho ${esc(GANHO[o.ganho])}</span></header>
      <div class="barra" role="img" aria-label="${esc(pct(o.fracao))} do total"><i style="width:${Math.min(100, Math.max(1, o.fracao * 100)).toFixed(1)}%"></i></div>
      <p class="pct">cerca de <b>${esc(pct(o.fracao))}</b> do total</p>
      <dl>
        <dt>O que é</dt><dd>${esc(o.explicacao)}</dd>
        <dt>O que achei</dt><dd>${esc(o.achado)}</dd>
        <dt>O que fazer</dt><dd>${esc(o.acao)}</dd>
        ${o.acaoDoPacote?.length ? `<dt>O pacote faz sozinho</dt><dd>${esc(o.acaoDoPacote.join(', '))} <code>instalar</code></dd>` : ''}
        <dt>Risco</dt><dd>${esc(o.risco)}</dd>
      </dl>
      <p class="fonte">De onde vem o número: ${esc(o.evidencia)}</p>
    </article>`).join('');
  const acoes = d.acoes?.length ? `
    <section><h2>Ações instaladas</h2><ul class="acoes">${d.acoes.map((a) => { const { txt, nums, eco } = linhaAcao(a); const tom = (STATUS[a.status] ?? [])[1] ?? 'neutro'; return `<li class="t-${tom}"><b>${esc(a.titulo)}</b><span>${esc(txt)}.${esc(nums)}${esc(eco)}</span><small>Métrica: ${esc(a.metrica)}</small></li>`; }).join('')}</ul></section>` : '';
  const gat = d.medidas?.reescritaPorGatilhoFrac ? Object.entries(d.medidas.reescritaPorGatilhoFrac).sort((a, b) => b[1] - a[1]) : [];
  const resumo = d.total ? `
    <section class="kpis">
      <div><span>Tokens novos</span><b>${esc(mil(d.total))}</b>${d.tokensPorPorcento ? `<small>${esc(emCota(d.total, d.tokensPorPorcento).trim())}</small>` : ''}</div>
      <div><span>Sessões</span><b>${d.resumo.sessoes}</b><small>${d.resumo.respostas.toLocaleString('pt-BR')} respostas</small></div>
      <div><span>Reescrita depois de pausa</span><b>${esc(fmtPct(d.medidas.reescritaPausaFrac))}</b>${gat.length ? `<small>${esc(gat.map(([g, n]) => `${NOMES_DOS_GATILHOS[g] ?? g}: ${pct(n)}`).join(' · '))}</small>` : ''}</div>
      <div><span>Abertura de sessão</span><b>${d.medidas.aberturaMediana ? esc(mil(d.medidas.aberturaMediana)) : '-'}</b><small>mediana, tokens</small></div>
      <div><span>Subagentes</span><b>${esc(fmtPct(d.medidas.subagenteFrac))}</b><small>${esc(fmtPct(d.medidas.subagenteCaroFrac))} no modelo mais caro</small></div>
    </section>` : '';
  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Economia de cota</title>
<style>
:root{--fundo:#f7f7f5;--papel:#fff;--tinta:#1c1c1a;--suave:#5f5f5a;--linha:#e3e2dd;--acento:#c2410c;--ok:#15803d;--alerta:#b91c1c;--barra:#f1e4dc}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--fundo:#151513;--papel:#1f1f1c;--tinta:#ecebe6;--suave:#a4a39c;--linha:#33332f;--acento:#fb923c;--ok:#4ade80;--alerta:#f87171;--barra:#3a2a20}}
:root[data-theme="dark"]{--fundo:#151513;--papel:#1f1f1c;--tinta:#ecebe6;--suave:#a4a39c;--linha:#33332f;--acento:#fb923c;--ok:#4ade80;--alerta:#f87171;--barra:#3a2a20}
*{box-sizing:border-box}body{margin:0;background:var(--fundo);color:var(--tinta);font:16px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:860px;margin:0 auto;padding:32px 16px 64px}
.exemplo{background:var(--acento);color:#fff;font-weight:700;padding:10px 14px;border-radius:8px;margin-bottom:20px}
h1{font-size:1.6rem;line-height:1.25;margin:0 0 8px}h2{font-size:1.15rem;margin:36px 0 12px}h3{font-size:1.05rem;margin:0;flex:1}
.manchete{font-size:1.15rem;font-weight:600;margin:12px 0}.escopo{color:var(--suave);font-size:.9rem}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-top:20px}
.kpis div{background:var(--papel);border:1px solid var(--linha);border-radius:10px;padding:12px}
.kpis span{display:block;color:var(--suave);font-size:.8rem}.kpis b{font-size:1.35rem}.kpis small{display:block;color:var(--suave);font-size:.78rem}
.card{background:var(--papel);border:1px solid var(--linha);border-radius:12px;padding:16px;margin:12px 0}
.card header{display:flex;gap:10px;align-items:center;flex-wrap:wrap}.n{background:var(--tinta);color:var(--papel);border-radius:50%;width:26px;height:26px;display:grid;place-items:center;font-weight:700;font-size:.85rem}
.tag{font-size:.75rem;border:1px solid var(--linha);border-radius:99px;padding:2px 10px}.g-alto{border-color:var(--acento);color:var(--acento)}
.barra{height:8px;background:var(--barra);border-radius:99px;margin:12px 0 4px;overflow:hidden}.barra i{display:block;height:100%;background:var(--acento)}
.pct{margin:0 0 8px;color:var(--suave);font-size:.9rem}dl{margin:0}dt{font-weight:700;font-size:.85rem;margin-top:8px}dd{margin:2px 0 0}
.fonte{color:var(--suave);font-size:.8rem;margin:10px 0 0}code{background:var(--barra);padding:1px 6px;border-radius:4px}
.acoes{list-style:none;padding:0;margin:0}.acoes li{background:var(--papel);border:1px solid var(--linha);border-left:4px solid var(--suave);border-radius:8px;padding:10px 12px;margin:8px 0;display:grid;gap:2px}
.acoes .t-ok{border-left-color:var(--ok)}.acoes .t-alerta{border-left-color:var(--alerta)}.acoes small{color:var(--suave)}
footer{color:var(--suave);font-size:.8rem;margin-top:40px}
</style></head><body><main>
${d.exemplo ? '<div class="exemplo">EXEMPLO COM NÚMEROS FICTÍCIOS. Nada aqui vem de uso real.</div>' : ''}
<h1>Economia de cota do Claude Code</h1>
<p class="escopo">${esc(d.periodo.ini)} a ${esc(d.periodo.fim)} · ${esc(d.escopo)}</p>
<p class="manchete">${esc(manchete(d))}</p>
${resumo}
${ops ? `<section><h2>Onde dá para economizar</h2>${ops}</section>` : ''}
${acoes}
<footer>Tokens novos = entrada + saída + escrita de cache: é o que pesa no limite da assinatura (reler o cache quase não pesa). Gerado em ${esc(d.geradoEm)} por claude-economia-de-cota, lido só nesta máquina.</footer>
</main></body></html>
`;
}

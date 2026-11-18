// EXECUTOR SEMANAL: mede cada ação instalada contra a base de antes e decide sozinho, sem IA.
//   - depois de pelo menos 7 dias inteiros com a ação, a métrica caiu 5% ou mais contra a base: MANTIDA
//     (com a economia estimada em tokens);
//   - não caiu: DESFEITA (a ação sai da configuração na hora; desinstalar o resto continua possível);
//   - sem base (não havia uso antes de instalar) ou base zero (o problema não aparecia): fica ligada e o
//     relatório diz que não há o que medir;
//   - período ainda não fechado depois da instalação: segue MEDINDO.

import { acaoPorId } from './acoes.mjs';

export const MELHORA_MINIMA = 0.05;

// Pura: estado das ações + medidas do período → novo estado, linhas do relatório e as ações a desligar.
export function rodada({ acoes = {}, medidas, periodo, tokensNovos = 0 }) {
  const novo = structuredClone(acoes);
  const desligar = [];
  const relatorio = [];
  for (const [id, st] of Object.entries(novo)) {
    const a = acaoPorId(id);
    if (!a) continue;
    const linha = { id, titulo: a.titulo, metrica: a.metrica, status: st.status, base: st.base?.valor ?? null };
    if (st.status !== 'medindo') { relatorio.push({ ...linha, depois: st.depois?.valor ?? null, economia: st.economia ?? null }); continue; }
    const valor = a.medir(medidas);
    if (!st.base) { relatorio.push({ ...linha, status: 'sem-base', depois: valor }); continue; }
    if (st.base.valor <= 0) { relatorio.push({ ...linha, status: 'nada-a-medir', depois: valor }); continue; }
    // só decide com um período que começa depois do dia da instalação (o dia dela mistura antes e depois)
    if (valor == null || !periodo || periodo.ini <= st.aplicadaEm) { relatorio.push({ ...linha, status: 'medindo', depois: valor }); continue; }
    const melhora = (st.base.valor - valor) / st.base.valor;
    st.depois = { periodo, valor };
    st.decididaEm = periodo.fim;
    if (melhora >= MELHORA_MINIMA) {
      st.status = 'mantida';
      st.economia = Math.round((st.base.valor - valor) * tokensNovos);
    } else {
      st.status = 'desfeita';
      desligar.push(id);
    }
    relatorio.push({ ...linha, status: st.status, depois: valor, melhora: Math.round(melhora * 1000) / 1000, economia: st.economia ?? null });
  }
  return { acoes: novo, relatorio, desligar };
}

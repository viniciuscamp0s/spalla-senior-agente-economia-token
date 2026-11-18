// PERÍODO: o intervalo medido, em hora local desta máquina.
const DIA = 86_400_000;

export const diaLocal = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
export const meiaNoite = (ms) => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); };
export const dataLocal = (s) => { if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new Error(`data no formato AAAA-MM-DD: ${s}`); const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d).getTime(); };

// Período: --desde/--ate, ou os últimos N dias até agora; "semanal" usa os 7 dias inteiros que fecharam ontem.
export function periodo({ dias = 7, desde, ate, inteiro = false, agora = Date.now() } = {}) {
  let fim = ate ? dataLocal(ate) : inteiro ? meiaNoite(agora) : agora;
  let ini = desde ? dataLocal(desde) : fim - Number(dias) * DIA;
  if (inteiro && !desde) ini = meiaNoite(fim - Number(dias) * DIA + DIA / 2);
  if (!(ini < fim)) throw new Error('período vazio: o início precisa ser antes do fim');
  return { ini, fim, rotulo: { ini: diaLocal(ini), fim: diaLocal(fim - 1), dias: Math.round((fim - ini) / DIA) } };
}


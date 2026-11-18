#!/usr/bin/env node
// ESPERAR: espera curta para a sessão do Claude que aguarda algo longo (build, testes, um horário).
// Rode SEMPRE em segundo plano. Acorda em no máximo 45 min (o cache dura ~1 h; acordar antes disso relê o contexto do
// cache, quase de graça). Se a condição não chegou, diz AINDA NAO: rode o mesmo comando de novo.
//
// USO
//   node esperar.mjs [minutos]                      despertador (padrão e máximo: 45)
//   node esperar.mjs --ate HH:MM [minutos]          até o horário (hora local desta máquina)
//   node esperar.mjs --ate-que "<comando>" [min]    até o comando sair com código 0 (testado a cada 30 s)
// Saída: PRONTO ... ou AINDA NAO ... (código 0). Erro de uso: código 2.
import { spawnSync } from 'node:child_process';
import { ehPrincipal } from './_comum.mjs';

export const TETO_MIN = 45;

export function interpretar(args) {
  let modo = 'despertador'; let alvo = ''; let cond = '';
  const a = [...args];
  if (a[0] === '--ate') { modo = 'hora'; alvo = a[1] ?? ''; a.splice(0, 2); }
  else if (a[0] === '--ate-que') { modo = 'cond'; cond = a[1] ?? ''; a.splice(0, 2); }
  let min = /^\d+$/.test(a[0] ?? '') ? Number(a[0]) : TETO_MIN;
  min = Math.min(TETO_MIN, Math.max(1, min));
  if (modo === 'hora' && !/^([01]\d|2[0-3]):[0-5]\d$/.test(alvo)) return { erro: 'horário no formato HH:MM' };
  if (modo === 'cond' && !cond.trim()) return { erro: '--ate-que precisa de um comando' };
  return { modo, alvo, cond, min };
}

// milissegundos até o próximo HH:MM local
export function msAte(alvo, agora = new Date()) {
  const [h, m] = alvo.split(':').map(Number);
  const d = new Date(agora); d.setHours(h, m, 0, 0);
  if (d <= agora) d.setDate(d.getDate() + 1);
  return d - agora;
}

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

async function principal() {
  const p = interpretar(process.argv.slice(2));
  if (p.erro) { console.error(`esperar: ${p.erro}`); process.exit(2); }
  const prazo = p.min * 60_000;
  if (p.modo === 'hora') {
    const falta = msAte(p.alvo);
    if (falta <= prazo) { await dormir(falta); console.log(`PRONTO: chegou ${p.alvo}`); return; }
    await dormir(prazo);
    console.log(`AINDA NAO: faltam ${Math.round((falta - prazo) / 60_000)} min para ${p.alvo}. Rode o mesmo comando de novo, em segundo plano.`);
    return;
  }
  if (p.modo === 'cond') {
    const fim = Date.now() + prazo;
    while (Date.now() < fim) {
      // o comando é o que a própria sessão escreveu para esperar (mesma confiança de um comando de terminal)
      if (spawnSync(p.cond, { shell: true, stdio: 'ignore' }).status === 0) { console.log('PRONTO: a condição deu certo'); return; }
      await dormir(Math.min(30_000, Math.max(0, fim - Date.now())));
    }
    console.log(`AINDA NAO: a condição não deu certo em ${p.min} min. Rode o mesmo comando de novo, em segundo plano.`);
    return;
  }
  await dormir(prazo);
  console.log(`PRONTO: ${p.min} min. Confira o que você espera; se não acabou, rode de novo em segundo plano.`);
}

if (ehPrincipal(import.meta.url)) principal();

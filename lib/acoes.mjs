// CATÁLOGO DAS AÇÕES SEGURAS: o que o pacote liga na configuração do Claude Code, e como cada uma é medida.
// Toda ação é reversível (desinstalar tira só o que é dela) e tem uma métrica em fração dos tokens novos do período,
// para trabalhar mais ou menos numa semana não enganar a comparação.

const g = (gatilho) => (m) => (m?.reescritaPorGatilhoFrac ? (m.reescritaPorGatilhoFrac[gatilho] ?? 0) : null);

export const ACOES = [
  {
    id: 'compactacao-ociosa',
    titulo: 'Compactação ociosa a partir de 100 mil tokens',
    oQueFaz: 'Sessão parada perto de 1 hora é resumida antes de o cache vencer. Na volta, você paga o resumo, não a conversa inteira. O padrão do Claude Code só age a partir de 200 mil tokens; 100 mil é o mínimo aceito.',
    requisito: 'Claude Code 2.1.290 ou mais novo (compactação ociosa ligada por padrão).',
    env: { CLAUDE_CODE_IDLE_COMPACT_MIN_TOKENS: '100000' },
    ganchos: [],
    metrica: 'reescrita depois de pausa quando você volta ou outra sessão escreve',
    medir: (m) => (m?.reescritaPorGatilhoFrac ? (m.reescritaPorGatilhoFrac.usuario ?? 0) + (m.reescritaPorGatilhoFrac.recado ?? 0) : null),
  },
  {
    id: 'retomada-cara',
    titulo: 'Aviso antes de acordar sessão grande parada há mais de 1 hora',
    oQueFaz: 'Segura uma vez a mensagem para uma sessão de 200 mil tokens ou mais parada há mais de 1 hora, grava um resumo de passagem sem IA e mostra as duas saídas: seguir ali (qualquer texto, a mensagem volta junto) ou abrir sessão nova com o resumo.',
    env: {},
    ganchos: [{ evento: 'UserPromptSubmit', arquivo: 'retomada-cara.mjs' }],
    metrica: 'reescrita depois de pausa quando você volta',
    medir: g('usuario'),
  },
  {
    id: 'espera-curta',
    titulo: 'Recusa espera longa em segundo plano',
    oQueFaz: 'Recusa sleep de mais de 45 min ou laço "espere até X" em segundo plano e oferece o esperar.mjs, que acorda em no máximo 45 min (cache ainda quente) e diz PRONTO ou AINDA NAO.',
    env: {},
    ganchos: [{ evento: 'PreToolUse', matcher: 'Bash|PowerShell', arquivo: 'espera-longa.mjs' }],
    metrica: 'reescrita depois de pausa quando uma tarefa em segundo plano termina',
    medir: g('tarefa-fundo'),
  },
  {
    id: 'subagente-barato',
    titulo: 'Subagente sem modelo escolhido roda no Sonnet (busca no Haiku)',
    oQueFaz: 'Subagente que você não mandou rodar num modelo específico deixa de herdar o modelo caro da sessão. Quem passa o modelo na chamada continua decidindo.',
    env: { CLAUDE_CODE_SUBAGENT_MODEL: 'sonnet' },
    ganchos: [{ evento: 'PreToolUse', matcher: 'Agent|Task', arquivo: 'subagente-modelo.mjs' }],
    metrica: 'parte do modelo mais caro nos tokens de subagente',
    medir: (m) => m?.subagenteCaroFrac ?? null,
  },
];

export const ARQUIVOS_DOS_GANCHOS = ['_comum.mjs', 'espera-longa.mjs', 'esperar.mjs', 'subagente-modelo.mjs', 'retomada-cara.mjs'];
export const acaoPorId = (id) => ACOES.find((a) => a.id === id);

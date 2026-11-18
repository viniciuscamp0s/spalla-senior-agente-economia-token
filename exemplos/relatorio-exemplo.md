> **EXEMPLO COM NÚMEROS FICTÍCIOS.** Nada aqui vem de uso real.

# Economia de cota do Claude Code: 2030-01-01 a 2030-01-07

**Em 7 dias você gastou 24,8 milhões de tokens novos em 38 sessões. O maior vazamento: sessões com mais de 150 respostas, cerca de 8,6% do total.**

Escopo: todos os projetos (exemplo). Tokens novos = entrada + saída + escrita de cache (o que pesa no limite; reler o cache quase não pesa).

## Resumo

| Medida | Valor |
|---|---|
| Sessões | 38 (mais 26 transcrições de subagente) |
| Respostas | 3.514 |
| Tokens novos | 24,8 milhões |
| Reescrita depois de pausa | 14,1% |
| Abertura de sessão (mediana) | 83 mil tokens |
| Subagentes | 11% do total, 59,9% deles no modelo mais caro |
| Por modelo | claude-opus 18,5 milhões, claude-sonnet 5,1 milhões, claude-haiku 1,1 milhão |

## Onde dá para economizar (do maior para o menor)

### 1. Sessões com mais de 150 respostas (ganho alto: cerca de 8,6%)

- **O que é:** Cada resposta carrega a conversa inteira até ali. Numa sessão muito longa, cada passo custa caro, mesmo os pequenos.
- **O que achei:** 4 de 38 sessões passaram de 150 respostas e gastaram 2,1 milhões de tokens novos depois da resposta 150 (8,6% do período). A maior teve 280 respostas.
- **O que fazer:** Uma sessão, uma entrega. Passou do limite: peça um resumo de passagem e continue numa sessão nova.
- **Risco:** Baixo. O ganho real é menor que o número bruto, porque o trabalho continuaria em outra sessão.
- **De onde vem o número:** Respostas únicas por transcrição principal, sem subagentes.

### 2. Contexto reescrito depois de pausa de mais de 1 hora (ganho alto: cerca de 6%)

- **O que é:** O Claude guarda a conversa num cache que dura cerca de 1 hora. Se a sessão fica parada mais que isso e você (ou uma tarefa em segundo plano) a acorda, a conversa inteira entra de novo e é cobrada como nova.
- **O que achei:** 22 retomadas depois de pausa de mais de 60 min reescreveram o contexto inteiro: 3,5 milhões de tokens novos (14,1% do período). Em 20 delas, sair numa sessão nova teria sido mais barato (custo de abrir: 93 mil). O que acordou a sessão: uma tarefa em segundo plano terminou 7,2%, você voltou a escrever 3,9%, outra sessão escreveu nesta 3%.
- **O que fazer:** Sessão grande parada há mais de 1 hora: abra uma sessão nova com um resumo do que falta, em vez de continuar na antiga. Espera longa (build, horário) em segundo plano acorda no máximo a cada 45 min.
- **O pacote faz sozinho:** compactacao-ociosa, retomada-cara, espera-curta (`instalar`).
- **Risco:** Sessão nova perde o fio se o resumo for ruim; só vale acima do custo de abertura.
- **De onde vem o número:** Respostas com escrita de cache de 40 mil tokens ou mais logo depois de uma pausa de mais de 60 min.

### 3. Subagentes rodando no modelo mais caro (ganho médio: cerca de 3,3%)

- **O que é:** Subagente sem modelo escolhido herda o modelo da sessão. Se você trabalha no modelo mais caro, toda busca e leitura feita por subagente sai no mais caro também.
- **O que achei:** Subagentes gastaram 2,7 milhões de tokens novos (11% do período), 59,9% deles no modelo mais caro. Por modelo: claude-opus 1,6 milhão, claude-haiku 1,1 milhão.
- **O que fazer:** Busca e leitura em volume num modelo barato (Haiku ou Sonnet); decisão e revisão continuam no seu modelo. O ganho estimado supõe metade do custo por token (o peso exato de cada modelo no limite não é publicado).
- **O pacote faz sozinho:** subagente-barato (`instalar`).
- **Risco:** Modelo barato erra mais em leitura fina de código: use em busca e resumo.
- **De onde vem o número:** Transcrições em <sessão>/subagents/, tokens novos por modelo.

### 4. Custo de abrir sessão (ganho médio: cerca de 2,4%)

- **O que é:** Toda sessão nova começa lendo as suas instruções (CLAUDE.md, memória, lista de skills e de ferramentas). Isso é pago de novo a cada sessão.
- **O que achei:** 38 sessões abertas; a primeira resposta de cada uma escreve 83 mil tokens (mediana), 3 milhões no total (12,1% do período).
- **O que fazer:** Enxugar o que carrega sempre: mover explicações longas do CLAUDE.md para arquivos lidos só quando precisa, desligar servidores MCP sem uso. Cortar 20% da abertura economiza o valor estimado.
- **Risco:** Regra tirada da abertura deixa de ser seguida: corte texto repetido ou sem uso, nunca regra.
- **De onde vem o número:** Escrita de cache da primeira resposta de cada transcrição principal.

### 5. Mesmo arquivo lido inteiro várias vezes na sessão (ganho baixo: cerca de 0,7%)

- **O que é:** Ler um arquivo grande inteiro de novo, sem ele ter mudado, põe tudo no contexto outra vez.
- **O que achei:** 8 casos de arquivo lido inteiro 3 vezes ou mais na mesma sessão: cerca de 175 mil tokens de releitura. Maiores: modulo-20.ts (3x), modulo-25.ts (3x), modulo-5.ts (5x).
- **O que fazer:** Depois da primeira leitura, peça busca por trecho (Grep com contexto, ou leitura com início e limite de linhas).
- **Risco:** Nenhum.
- **De onde vem o número:** Leituras sem trecho definido do mesmo caminho na mesma sessão; tokens estimados a 3.5 caracteres por token.

### 6. Saídas de ferramenta acima de 30 mil caracteres (ganho baixo: cerca de 0,4%)

- **O que é:** Log de teste, listagem enorme, arquivo despejado no terminal: tudo isso entra no contexto e fica lá pelo resto da sessão.
- **O que achei:** 10 saídas grandes somaram cerca de 186 mil tokens. Maiores: Bash: npm test (186 mil).
- **O que fazer:** Filtrar a saída (head, grep, --quiet, só as linhas de erro) ou mandar a leitura em volume a um subagente barato que devolve só a conclusão. Ganho estimado: metade.
- **Risco:** Filtro errado esconde a linha do erro: filtre por padrão, não por corte cego.
- **De onde vem o número:** Tamanho de cada resultado de ferramenta, casado com a chamada que o pediu.

## Ações instaladas e o resultado de cada uma

| Ação | Situação | Métrica |
|---|---|---|
| Recusa espera longa em segundo plano | funcionou e fica ligada. Antes: 8,1%, depois: 1,2%. Economia estimada: 2,1 milhões de tokens. | reescrita depois de pausa quando uma tarefa em segundo plano termina |
| Subagente sem modelo escolhido roda no Sonnet (busca no Haiku) | funcionou e fica ligada. Antes: 58%, depois: 19%. Economia estimada: 1,4 milhão de tokens. | parte do modelo mais caro nos tokens de subagente |
| Aviso antes de acordar sessão grande parada há mais de 1 hora | não ajudou e foi desligada. Antes: 3%, depois: 3,1%. | reescrita depois de pausa quando você volta |
| Compactação ociosa a partir de 100 mil tokens | medindo (precisa de 7 dias inteiros depois de instalar). Antes: 5%. | reescrita depois de pausa quando você volta ou outra sessão escreve |

---
Gerado em 2030-01-08 (exemplo) por claude-economia-de-cota. Lido só nesta máquina; nada foi enviado para fora.

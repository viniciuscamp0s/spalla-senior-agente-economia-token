# spalla-senior-agente-economia-token

> **English summary.** A zero-dependency Node tool for people who keep hitting the Claude Code usage limit. It reads
> the Claude Code transcripts already on your machine (`~/.claude/projects`), measures where your *new* tokens go
> (context rewritten after the 1-hour cache expires, session start-up cost, very long sessions, subagents running on
> the most expensive model, huge tool outputs, files re-read in full) and writes a plain-language report (HTML,
> Markdown and JSON). It can also install, **per project**, a small set of Claude Code hooks and settings that cut
> that waste, measure each one against a baseline a week later, and switch off on its own whatever didn't save
> anything. Windows, macOS and Linux. No API key, no network, nothing leaves your computer. MIT license.
> Docs below are in Brazilian Portuguese.

Você usa o Claude Code todo dia e bate no limite da assinatura antes do fim da semana? Este pacote mostra **para onde
os seus tokens estão indo** e liga, no seu projeto, as correções que comprovadamente economizam, medindo cada uma e
desligando sozinho a que não funcionar.

Só Node (18.17 ou mais novo). Sem dependência, sem chave, sem rede. Lê as transcrições que o próprio Claude Code já
guarda no seu computador e não envia nada para lugar nenhum.

## O problema, em números

O que pesa no limite não é o tamanho da conversa: é o que entra de **novo** (entrada, saída e escrita de cache). Reler o
cache quase não pesa. Numa semana real de uso intenso, medida pelo autor com este mesmo diagnóstico:

| O que aconteceu | Parte dos tokens novos da semana |
|---|---|
| Contexto reescrito inteiro depois de pausa de mais de 1 hora (o cache venceu) | **22,7%** |
| ... porque uma tarefa em segundo plano terminou e acordou a sessão | 8,8% |
| ... porque a pessoa voltou a escrever numa sessão parada | 4,9% |
| ... porque um robô retomou uma sessão parada | 4,4% |
| ... porque outra sessão mandou recado | 2,6% |
| Subagentes (57% deles rodando no modelo mais caro, a maioria só lendo e buscando) | 11,4% |
| Abrir uma sessão nova (mediana) | 83 mil tokens por sessão |

Quase um quarto da semana foi gasto **reescrevendo o que já estava pago**, só porque a sessão foi acordada depois de o
cache vencer.

## Instalação em 3 passos

Precisa de [Node.js](https://nodejs.org) e do Git instalados. Rode no terminal, **dentro da pasta do seu projeto**:

**1. Veja o diagnóstico** (só leitura, não muda nada):

```bash
npx github:viniciuscamp0s/spalla-senior-agente-economia-token diagnostico --abrir
```

Mede os últimos 7 dias de todos os seus projetos e abre o relatório no navegador. Os arquivos ficam em
`./relatorio-economia-de-cota/`.

**2. Ligue as correções neste projeto:**

```bash
npx github:viniciuscamp0s/spalla-senior-agente-economia-token instalar
```

Grava em `.claude/settings.local.json` do projeto (só você, só este projeto: nunca na configuração global sem você
pedir) e guarda a medida de antes de cada ação. Vale para as sessões abertas a partir daí.

**3. Uma semana depois (8 dias), deixe ele decidir:**

```bash
npx github:viniciuscamp0s/spalla-senior-agente-economia-token semanal
```

Compara a semana que fechou com a medida de antes. O que economizou 5% ou mais fica; o que não economizou é
desligado na hora. O relatório da semana fica em `.claude/economia-de-cota/relatorios/`.

Para tirar tudo: `npx github:viniciuscamp0s/spalla-senior-agente-economia-token desinstalar`. As suas outras configurações e
variáveis voltam exatamente como eram.

> Prefere sem `npx`? `git clone https://github.com/viniciuscamp0s/spalla-senior-agente-economia-token` e troque
> `npx github:viniciuscamp0s/spalla-senior-agente-economia-token` por `node <pasta-do-clone>/bin/cli.mjs`.

## O que ele mede

| Medida | Como sabe | Por que importa |
|---|---|---|
| **Reescrita depois de pausa** | resposta com escrita de cache de 40 mil tokens ou mais logo depois de mais de 60 min parada; separa o que acordou a sessão (você, tarefa em segundo plano, recado de outra sessão, compactação) | o cache dura cerca de 1 hora; depois disso, a conversa inteira é cobrada de novo |
| **Custo de abrir sessão** | escrita de cache da primeira resposta de cada sessão | CLAUDE.md, memória, skills e ferramentas MCP entram de novo em toda sessão |
| **Sessões longas** | tokens gastos depois da resposta 150 | cada resposta carrega a conversa inteira até ali |
| **Subagentes por modelo** | transcrições de subagente, tokens por modelo | subagente sem modelo escolhido herda o modelo caro da sessão |
| **Saídas grandes** | resultado de ferramenta acima de 30 mil caracteres | log enorme fica no contexto pelo resto da sessão |
| **Leitura repetida** | o mesmo arquivo lido inteiro 3 vezes ou mais na sessão | cada releitura põe o arquivo inteiro no contexto de novo |

Cada achado vem com o número, de onde ele saiu, o que fazer e o risco. Os limiares são ajustáveis (veja Configuração).

## O que ele muda (só se você rodar `instalar`)

| Ação | O que faz | Como é medida |
|---|---|---|
| `compactacao-ociosa` | Sessão parada perto de 1 hora é resumida **antes** de o cache vencer, a partir de 100 mil tokens (o padrão do Claude Code é 200 mil). Requer Claude Code 2.1.290 ou mais novo. | reescrita depois de pausa quando você volta ou outra sessão escreve |
| `retomada-cara` | Ao escrever numa sessão de 200 mil tokens ou mais parada há mais de 1 hora, segura a mensagem **uma vez**, grava um resumo de passagem (sem IA) e oferece: seguir ali (qualquer texto, sua mensagem volta junto) ou abrir sessão nova com o resumo. | reescrita depois de pausa quando você volta |
| `espera-curta` | Recusa `sleep` de mais de 45 min ou laço "espere até X" em segundo plano e oferece o `esperar.mjs`, que acorda em no máximo 45 min, com o cache ainda quente. | reescrita quando uma tarefa em segundo plano termina |
| `subagente-barato` | Subagente sem modelo escolhido roda no Sonnet, e a busca (Explore) no Haiku. Quem passa o modelo na chamada continua decidindo. | parte do modelo mais caro nos tokens de subagente |

Escolha só algumas: `instalar --acoes espera-curta,subagente-barato`. Veja a descrição de todas: `acoes`.

**Onde instala:**

- padrão: `<projeto>/.claude/settings.local.json` (só você, só este projeto);
- `--compartilhado`: `<projeto>/.claude/settings.json`, que vai para o git e vale para o time;
- `--usuario`: `~/.claude/settings.json`, para toda sessão da máquina. **Só com essa opção explícita.**

Os ganchos são copiados para `.claude/economia-de-cota/ganchos/` do projeto, então continuam funcionando mesmo se o
cache do `npx` for limpo. Variável que você já tinha definido não é sobrescrita. Antes da primeira gravação fica uma
cópia do arquivo (`settings.local.json.antes-economia-de-cota`). Todo gancho falha aberto: se der qualquer erro, o
Claude Code segue como se ele não existisse.

## Exemplo de relatório

> **EXEMPLO COM NÚMEROS FICTÍCIOS.** Gerado por `npm run exemplo` a partir de sessões inventadas. O relatório completo
> está em [`exemplos/relatorio-exemplo.md`](exemplos/relatorio-exemplo.md) e em HTML em
> [`exemplos/relatorio-exemplo.html`](exemplos/relatorio-exemplo.html).

```text
Em 7 dias você gastou 24,8 milhões de tokens novos em 38 sessões.
O maior vazamento: sessões com mais de 150 respostas, cerca de 8,6% do total.

  1. Sessões com mais de 150 respostas ............ ganho alto, cerca de 8,6%
  2. Contexto reescrito depois de pausa de 1 h+ ... ganho alto, cerca de 6%
     (tarefa em segundo plano 7,2%, você voltou a escrever 3,9%, outra sessão 3%)
  3. Subagentes no modelo mais caro ............... ganho médio, cerca de 3,3%

Ações instaladas (exemplo):
  espera-curta        funcionou e fica ligada   antes 8,1%  depois 1,2%
  subagente-barato    funcionou e fica ligada   antes 58%   depois 19%
  retomada-cara       não ajudou e foi desligada
  compactacao-ociosa  medindo
```

## Todos os comandos

```text
diagnostico   (padrão) mede os últimos 7 dias e grava HTML, Markdown e JSON
instalar      liga as ações seguras neste projeto, com a medida de antes
semanal       mede a semana que fechou, mantém o que economizou, desliga o que não economizou
status        mostra o que está instalado e onde
desinstalar   tira tudo o que o pacote pôs
acoes         lista as ações do catálogo

--projeto <pasta>   projeto alvo (padrão: a pasta atual); no diagnóstico, filtra as sessões dele
--dias <n>          tamanho do período do diagnóstico (padrão 7)
--desde / --ate     período por data (AAAA-MM-DD; --ate é exclusivo)
--saida <pasta>     onde gravar o relatório
--formato html,md,json
--usuario | --compartilhado   escopo da instalação
--acoes a,b         instalar só estas ações
--simular           instalar: mostra o que mudaria, sem gravar
--abrir             abre o relatório no navegador
--config <arquivo>  configuração opcional
```

## Rodar toda semana sozinho (opcional)

macOS e Linux (`crontab -e`), toda segunda às 9h:

```cron
0 9 * * 1 cd /caminho/do/projeto && npx -y github:viniciuscamp0s/spalla-senior-agente-economia-token semanal
```

Windows (Agendador de Tarefas, num terminal):

```powershell
schtasks /Create /SC WEEKLY /D MON /ST 09:00 /TN "Economia de cota" /TR "cmd /c cd /d C:\caminho\do\projeto && npx -y github:viniciuscamp0s/spalla-senior-agente-economia-token semanal"
```

## Configuração (opcional)

Um arquivo `economia-de-cota.config.json` na pasta onde você roda (ou `--config <arquivo>`):

```json
{
  "limiares": { "sessaoLonga": 150, "pausaCacheMin": 60, "saidaGrande": 30000 },
  "gatilhos": { "meu-robo": "^\\[robo\\]" },
  "tokensPorPorcento": 750000,
  "subagentes": { "Explore": "haiku", "general-purpose": "sonnet" },
  "retomada": { "contextoMin": 200000, "paradaMin": 60, "liberarSe": "^\\[robo\\]" }
}
```

- `gatilhos`: se você tem um robô que retoma sessões, dê um nome ao texto que ele manda; a reescrita causada por ele
  aparece separada no relatório.
- `tokensPorPorcento`: quantos tokens novos valem 1% do limite semanal **do seu plano**. A Anthropic não publica esse
  número; para calibrar, anote o percentual de uso no começo e no fim de uma semana e divida os tokens novos do
  diagnóstico dessa semana pela diferença. Com ele, o relatório mostra também a porcentagem do limite.
- `subagentes` e `retomada`: ajustes dos ganchos, gravados junto deles na instalação.

## Perguntas

**Manda alguma coisa para fora?** Não. Não usa rede. Lê os arquivos `.jsonl` que o Claude Code grava em
`~/.claude/projects` (ou em `CLAUDE_CONFIG_DIR`) e grava o relatório no seu disco. O relatório mostra nomes de
arquivo e começo de comando seus: revise antes de compartilhar.

**Por que "tokens novos" e não o total?** Porque reler o cache é quase de graça no limite. O que consome é o contexto
que entra de novo (abrir sessão, reescrever depois de pausa, ler arquivo, saída de ferramenta) e o que o modelo escreve.

**Os ganhos são exatos?** São estimativas com a conta à mostra em cada achado. O peso de cada modelo no limite não é
publicado; onde isso importa, o relatório diz qual suposição usou.

**Posso usar no trabalho, em equipe?** Pode: `instalar --compartilhado` grava na configuração do projeto que vai para o
git. Estado, relatórios e resumos de passagem ficam fora do git (o instalador grava o `.gitignore`).

## Desenvolvimento

```bash
npm test          # testes (node --test), sem dependências
npm run exemplo   # regenera o relatório de exemplo com números fictícios
node ferramentas/varredura.mjs   # varredura de privacidade (e-mail, telefone, caminho pessoal, chave) antes de publicar um fork
```

## Licença e créditos

MIT. Feito por Vinicius Campos ([@viniciuscamp0s_](https://www.instagram.com/viniciuscamp0s_/) no Instagram), a
partir do agente que mede e corta o desperdício de cota no dia a dia dele.

# Equipe de IA pronta (plano Premium)

Quatro agentes de IA que servem a qualquer negócio, instalados a partir de um
questionário: **Atendimento** (SDR), **Agendamento**, **Propostas** e
**Recuperação de vendas**. A tela é IA › Equipe pronta (`/app/ai/equipe-pronta`).

Este documento descreve o que existe no código. O que ainda não existe está na
seção "O que falta".

## As três camadas

| Camada | Onde mora | Muda por empresa? | Quem edita |
|---|---|---|---|
| Papel (como cada agente trabalha) | `lib/ai/equipe-pronta/papeis/` | Não | A plataforma, subindo `versao` |
| Configuração da empresa (respostas do questionário) | `equipe_pronta_perfis.respostas`, validada por `lib/schemas/equipe-pronta.ts` | Sim | A empresa |
| Dados vivos (serviços, preços, horários, políticas, etapas) | Catálogo, agenda, base de conhecimento, memória da organização, funil | Sim | A empresa, nas telas de cada um |

As respostas viram um bloco `## Esta empresa` **gerado** no texto do agente
(`lib/ai/equipe-pronta/renderizar.ts`). Preço e horário não entram em nenhuma
das três partes do texto: o agente consulta o catálogo e a agenda por
ferramenta.

A cerca `lib/ai/equipe-pronta/papeis.test.ts` reprova o papel que contiver
termo de ramo, valor em moeda ou hora. `renderizar.test.ts` passa duas empresas
de ramos diferentes pelo mesmo renderizador e confere, byte a byte, que só o
bloco `## Esta empresa` muda.

## O que a instalação cria

`lib/ai/equipe-pronta/instalar.ts`, chamado por
`POST /api/v1/ai/equipe-pronta/instalar`. Cria ou atualiza; rodar de novo não
duplica nada.

1. **Memória da organização**: o resumo do negócio, num bloco delimitado. O
   resto da memória da empresa é preservado.
2. **Fonte de conhecimento** "Política comercial e perguntas frequentes", com
   as formas de pagamento e as perguntas frequentes. Sem texto, a fonte não é
   criada e o checklist acusa.
3. **Tipo de agenda principal**: o escolhido, ou um novo. Os três tipos de
   fábrica (`consulta`, `reuniao`, `atendimento`) são desativados quando não têm
   horário publicado nem compromisso.
4. **Etapas do funil**: as marcas `agent_stage_hint` de qualificado
   (`qualified`), proposta (`negotiating`) e perdido (`lost`), nas etapas
   escolhidas.
5. **Régua de follow-up** "Equipe pronta · Recuperação de vendas", com
   mensagens geradas (não texto fixo).
6. **Canal em ensaio**: só os telefones de teste do questionário falam com a
   IA. Vem ANTES do roteador e da publicação: num canal que já atende clientes,
   a equipe nova não pode ficar na frente deles sem o ensaio existir. Se o
   ensaio falhar, a instalação para aqui, sem ligar o roteador e sem publicar
   (`equipe_pronta_ensaio_nao_configurado`). Só acontece enquanto a equipe não
   foi ativada.
7. **Os quatro agentes**, marcados em `ai_agents.config.equipe_pronta` com
   `{ papel, versao, hash }`.
8. **Roteador do canal** com os quatro membros e o Atendimento como destino
   padrão.
9. **Publicação** dos agentes.

### Canal que já tem roteador

Antes de qualquer escrita a instalação lê o roteador ativo do canal. Se ele não
foi criado nem adotado pela equipe pronta, se o destino padrão dele é um agente
que não é da equipe, ou se tem membros que não são da equipe, a resposta é 409
`equipe_pronta_canal_com_roteador`, com `details.roteador`
(`{ id, nome, de_fora, fallback, membros }`), e nada é gravado. Com
`forcar: true` a instalação adota o roteador: o destino padrão passa a ser o
Atendimento, os quatro membros entram, e os membros que o cliente pôs ficam
como estão. O que foi aceito fica guardado (`instalacao.roteador_confirmado`):
instalar de novo só pergunta outra vez se o roteador mudou.

### Canal que já atende clientes

O ensaio é o pré-lançamento do canal e vale para o número inteiro. Por isso,
quando a instalação vai pôr o canal em ensaio e ele está aberto, ela lê
(`canalEmProducao`):

- os agentes publicados direto nesse canal
  (`ai_agent_versions.channel_session_id`) que não são da equipe pronta, não
  estão pausados nem arquivados;
- quantas conversas do canal tiveram resposta da IA nos últimos 7 dias.

Com qualquer um dos dois, a resposta é 409 `equipe_pronta_canal_em_producao`,
com `details.canal` (`{ agentes, conversas_recentes }`), e nada é gravado.
Canal que já está em pré-lançamento não pergunta, nem a equipe que já foi
ativada (instalar de novo não fecha o canal).

### Uma recusa só

As três recusas (`agentes_editados_a_mao`, `canal_com_roteador`,
`canal_em_producao`) saem juntas: o código é o do primeiro motivo, nessa
ordem, e `details` traz `agentes`, `roteador` e `canal`, cada um quando
existe. `forcar: true` vale para as três. A decisão é
`recusaAntesDeInstalar`, pura, medida em
`lib/ai/equipe-pronta/instalar.test.ts`.

O modelo de proposta é o `proposta_comercial` do catálogo base
(`lib/propostas/modelos/catalogo-base.ts`), que vale para toda empresa sem
gravar nada no banco dela.

### Agente editado à mão

A instalação compara o que está **publicado** com o que o renderizador geraria
agora e com o que ela gravou da última vez (`situacaoDoAgente`):

- publicado igual ao gerado: em dia;
- publicado igual ao que a instalação gravou, mas o perfil mudou: desatualizado,
  reaplica;
- diferente dos dois: editado à mão. A instalação responde 409 com a lista e não
  grava nada; com `forcar: true`, sobrescreve.

Só entram na comparação os campos que a equipe pronta decide: texto,
ferramentas, palavras de passagem, follow-up, funil, base e rascunho de
proposta. Trocar o modelo de IA ou o orçamento do agente não é editar à mão.

### Quando a publicação é recusada

Sem chave de IA válida ou sem WhatsApp conectado, o banco recusa a publicação.
A instalação termina com os agentes em rascunho, e o checklist diz o que falta.
Instalar de novo, depois de resolver, publica.

## Ensaio e ativação

- `POST /api/v1/ai/equipe-pronta/ativar`: abre o canal para todos. Só com o
  checklist inteiro verde; a conferência é refeita no servidor.
- `POST /api/v1/ai/equipe-pronta/pausar`: para os quatro agentes da equipe
  (`paused_at`), e só eles. O acesso da IA no canal não muda, e outros agentes
  do mesmo número seguem atendendo. O modo (ensaio ou ativo) também não muda.
- `POST /api/v1/ai/equipe-pronta/retomar`: religa os agentes que a pausa parou
  (a lista fica em `instalacao.pausa`). Quem o cliente tinha pausado à mão
  antes continua pausado. Ativar uma equipe pausada também a religa.

Decisão da revisão do PR #8: a primeira versão de Pausar punha o canal inteiro
em pré-lançamento, o que calava todo outro agente do mesmo número. Foi
escolhida a pausa só dos quatro agentes.

O ensaio usa o acesso da IA do canal que já existia (modo pré-lançamento com
telefones de teste). Esse acesso é por telefone; não há etiqueta de teste.

### Checklist

Calculado em `lib/ai/equipe-pronta/estado.ts`, devolvido pelo
`GET /api/v1/ai/equipe-pronta`:

| Item | Verde quando | Só se |
|---|---|---|
| Chave de IA | Há credencial ativa e validada, ou chave da instalação | sempre |
| Base preparada | A fonte foi indexada com sucesso | sempre |
| Agenda | O tipo principal tem horário livre em 14 dias | a empresa agenda |
| Catálogo | Há item ativo com preço | a empresa informa preço por mensagem |
| WhatsApp | O canal está conectado | sempre |
| Modelo de proposta | "Proposta comercial" disponível | a empresa usa proposta |
| Funil | Etapas de qualificado e perdido marcadas (e proposta, se usa) | sempre |
| Agentes | Os quatro publicados | sempre |

## Plano

O destino `/app/ai/equipe-pronta` está no catálogo de navegação. O Premium
(perfil "completa", sem lista) o recebe; Essencial e Standard, que usam lista
explícita, não. Empresa sem assinatura vê a tela, como as demais.

- **Tela**: o `proxy.ts` troca a página por "Isso não está no seu plano".
- **API**: `/api/v1/ai/equipe-pronta` responde 403
  `fora_do_plano:/app/ai/equipe-pronta`.
- **Motor** (`lib/cobranca/equipe-pronta-no-plano.ts`): agente marcado como da
  equipe pronta não responde, não arma follow-up e tem a régua adiada. Agente
  que a empresa criou por conta própria não é afetado. Se a leitura do plano
  falhar, o motor segue.

Rebaixar o plano pausa; não apaga nem despublica nada. Voltar ao Premium faz
tudo voltar a funcionar sem reinstalar.

## Atualização de papel

Subir `versao` de um papel no código faz o `GET` de estado devolver
`atualizacao_disponivel`, com `notasDaVersao`. Aplicar é instalar de novo.
Nunca é automático.

## Limites conhecidos

- **Régua em canal oficial**: num canal que exige modelo aprovado fora da
  janela de 24 horas, a segunda mensagem da régua em diante precisaria de um
  modelo de reserva, que a régua não leva. No WhatsApp conectado por QR não há
  essa exigência.
- **Etapa de "agendado"**: o motor não tem marca de etapa para compromisso
  marcado. O compromisso fica na agenda e na linha do tempo do negócio; a
  equipe pronta não move etapa por ele.
- **Silêncio de até 7 dias**: o gatilho de silêncio do follow-up alcança no
  máximo 7 dias. Contato parado há mais tempo só é retomado com aprovação
  humana, pela ferramenta de reativação.
- **Troca de roteador**: se o canal já tem um roteador, ele é reaproveitado, o
  destino padrão passa a ser o agente de Atendimento e a continuidade é ligada.
  Os outros membros do roteador não são mexidos.

## A tela

`/app/ai/equipe-pronta` (`app/app/ai/equipe-pronta/`), para `manager` ou acima.
Instalar, ativar e pausar são de `admin`.

- **Questionário em seis passos** (`lib/ai/equipe-pronta/questionario.ts`):
  negócio, atendente, como vende, perguntas e regras, recuperação e respostas,
  onde instalar. "Salvar e continuar" grava o rascunho do passo (os blocos
  dele, e só eles). Quem sai no meio volta no primeiro passo que falta.
- **Revisão**: o texto que cada agente vai receber (`texto_gerado` no estado,
  feito pelo mesmo renderizador do instalador) e o botão Instalar. Antes da
  primeira instalação o bloco "Esta empresa" ainda não cita agenda, funil nem
  base: é o instalador que os cria.
- **Painel** de quem instalou: modo (ensaio ou ativo), Ativar (só com o
  checklist inteiro pronto), Pausar (para só os quatro agentes; o texto ao
  lado do botão diz isso) e Retomar, o checklist com o link
  que resolve cada pendência, e um cartão por agente: publicado ou não, versão
  do papel, "editado à mão", atualização disponível com a nota do que mudou.
- Instalar por cima de agente editado à mão, ou num WhatsApp que já tem
  roteador com agentes do cliente, abre UMA confirmação com as duas listas;
  só "Substituir e instalar" manda `forcar: true`. Quando o WhatsApp já
  atende clientes (409 `canal_em_producao`), a mesma confirmação diz, em
  linguagem simples, que durante o ensaio a IA só responde os números de
  teste, e mostra os agentes que atendem por ele e quantas conversas a IA
  respondeu nos últimos 7 dias; sem nada a substituir, o botão é "Instalar
  mesmo assim".

Atalhos, só para quem tem a tela no plano (`equipeProntaNoPlanoDaOrg`; falha
de leitura = sem atalho): o primeiro card do tour no fim do onboarding e um
link em IA › Agentes. Fora do plano a tela é `/app/fora-do-plano`, que diz em
que plano a equipe está; e IA › Agentes avisa quando os agentes da equipe
estão pausados pelo plano (a mesma pergunta que o motor faz,
`agentesDaEquipeForaDoPlano`).

Jornada pela tela: `tests/e2e/equipe-pronta.spec.ts`.

## O que falta

- O texto do checklist e as notas de versão dos papéis saem do servidor em
  português: em espanhol, a moldura da tela é traduzida e essas frases não.
- Os textos dos planos em `cobranca_planos` (banco) não foram alterados: o
  texto novo do Premium está em `docs/arvisx/PLANOS.md`, para colar em
  /admin/cobranca.

# Vix: como ligar (passo a passo do dono)

O Vix sobe **desligado**. Nada neste roteiro foi executado por quem escreveu o código: a organização designada, a conta conectada e os valores abaixo são passos do Lucas, feitos à mão depois do deploy. Enquanto ninguém os fizer, o botão do assistente não aparece para ninguém.

**Antes de ligar em qualquer organização:** a conferência dos termos de uso da assinatura (uso dela dentro de um produto vendido a terceiros) ainda **não foi verificada**. Está com o Lucas e o Dr. Renan. O código não depende do resultado, só a decisão de ligar.

## O que decide se o Vix responde

Quatro condições, todas necessárias. Faltou uma, o assistente não responde e o botão não é montado.

1. A instalação escolheu um pagador (`VIX_PAGADOR` diferente de `desligado`).
2. A empresa não desligou o assistente (linha de `assistente_estado_da_empresa`; sem linha vale ligado).
3. A empresa tem direito: o plano dela tem linha em `assistente_planos`, ou ela tem a marca `sem_limite`.
4. O pagador escolhido está utilizável (conta conectada, modelo definido, ou a chave do servidor presente).

## Passo 1: escolher o pagador

Em Painel › Configuração, a chave `VIX_PAGADOR` aceita três valores:

| Valor | O que faz | Custo registrado |
|---|---|---|
| `desligado` | Padrão. O assistente não existe | nenhum |
| `assinatura_plataforma` | Chama a IA pela assinatura conectada na organização designada | tokens reais, custo zero |
| `chave_plataforma` | Chama `claude-haiku-5-5` pela chave de IA do servidor (`ANTHROPIC_API_KEY`) | tokens reais e custo real pela tabela de preços |

Vazio ou qualquer outro texto vale `desligado`.

**Não existe queda automática entre os dois.** Se a assinatura falhar, o assistente avisa que está indisponível e nada sai pela chave de API. Trocar de pagador é sempre uma decisão escrita nesta chave.

## Passo 2 (só para `assinatura_plataforma`): a organização designada

1. Criar uma organização nova na instalação, só para isso, sem agentes e sem canal. Ela existe para guardar a conta.
2. Ligar o módulo de login por assinatura (Painel › Sistema), se ainda não estiver ligado.
3. Entrar nessa organização e conectar a assinatura em IA › Credenciais.
4. Copiar o identificador da organização para a chave `VIX_ORGANIZACAO_DA_CONTA`.
5. Escolher o modelo entre os que a conta lista e gravar em `VIX_MODELO`. Vazio deixa o assistente indisponível nesse pagador.

O código lê essa conta num lugar só, `lib/assistente/provedor/assinatura-da-plataforma.ts`, e a organização vem sempre da chave da instalação, nunca de quem está perguntando.

## Passo 3: quem tem direito

Rodar `docs/arvisx/ci/VIX-LIMITES-E-MARCA-2026-11.sql`. O cabeçalho dele traz os dois comandos:

- limite de mensagens por mês para cada um dos três planos novos (os números são decisão do Lucas e não estão escritos em lugar nenhum);
- marca "sem limite" para uma organização, pelo slug dela.

Plano sem linha não tem o Vix. Isso vale para os planos antigos: quem estiver neles fica sem o assistente até alguém configurar o plano ou marcar a organização. Confirmar se é esse o desejado.

## Passo 4 (opcional): ações do assistente

Em Painel › Sistema, "Ações do assistente" nasce desligado. Desligado, o Vix só consulta e orienta. Ligado, ele propõe ações em cartões e cada uma só acontece no clique da pessoa.

## O que ainda NÃO está cumprido: custo em `llm_calls`

A tarefa pede que cada resposta registre o custo em `llm_calls`. **Isso não está ligado.** Hoje o uso do Vix é gravado só em `assistente_usos`.

O motivo: na `main` de hoje, toda linha de `llm_calls` soma no orçamento de IA da empresa e pode pausar os agentes de atendimento dela. A coluna que separa o gasto do assistente (`llm_calls.origem_da_chave`, com os valores `assinatura_plataforma` e `assistente_chave_plataforma`) vem da migration 9825, de outra entrega, que ainda não está na `main`. O nome da coluna e os dois valores foram conferidos na branch daquela entrega em 25/11/2026 e batem com o que este código grava.

Para ligar, depois que a 9825 estiver na `main`:

1. Em `lib/assistente/custo.ts`, trocar `REGISTRAR_EM_LLM_CALLS` para `true`.
2. Em `lib/ai/pontos/registro.ts`, no ponto `assistente_vix`, mudar `registraEm` para `"llm_calls"`.
3. Conferir que a linha montada por `linhaDeLlmCallsDoVix` é aceita pela tabela (colunas obrigatórias e o vocabulário de `status`), o que hoje **não foi testado contra o banco**.
4. Escrever o teste de banco que prova que uma linha do assistente não altera `ai_budgets` nem o gasto do mês da empresa.

## Desligar

- Tudo, para todas as empresas: `VIX_PAGADOR` de volta para `desligado`.
- Uma empresa: a rota existe (`PATCH /api/v1/assistente/configuracao`, só administrador da empresa, só o campo `ligado`), mas **ainda não há tela** que a chame. Até a tela existir, quem desliga é a plataforma, gravando `ligado = false` na linha da empresa em `assistente_estado_da_empresa`.
- Só as ações: desligar "Ações do assistente".

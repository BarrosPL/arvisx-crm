# Planos do ArvisX CRM

Referência para o dono e o Hermes criarem os planos à mão em **/admin/cobranca**.

**Oferta em 2026-11-12: três planos, Essencial, Standard e Premium.** O plano
Equipe Completa (€499,90) saiu da oferta nessa data, porque é prestação de
serviço e não sistema: está arquivado em `cobranca_planos`, sem assinantes, e a
página inicial não mostra o cartão dele. Os agentes de IA sob medida passaram a
ser os **Agentes Arvisx**, um serviço à parte de qualquer plano (ver a seção
"Agentes Arvisx (serviço à parte)").

Nenhum plano é criado por seed nem por migration. O preço e os textos vêm sempre
do cadastro do plano; o código não tem valor nem texto de plano escrito.

Todos mensais, em euro, cobrados pela Stripe, com o preço **+ IVA**: o preço
cadastrado no plano é SEM IVA. O imposto é escolhido em Admin › Cobrança › Régua,
"Imposto (IVA) na cobrança": Desligado, Stripe Tax (você vende; exige o Stripe
Tax ativo na conta, com endereço de origem e registro do IVA) ou Managed Payments
(a Stripe é a vendedora oficial e recolhe o IVA; taxa adicional da Stripe). Com
imposto, as telas e a página inicial mostram "+ IVA". O Equipe Completa
(arquivado) segue marcado "Fora do Managed Payments". O passo a passo está em
`docs/arvisx/STRIPE-MANAGED-PAYMENTS.md`. Os planos oferecidos aparecem sozinhos na página inicial (seção Planos),
lidos deste cadastro. A IA usa a credencial que o
próprio cliente conecta, em todos os planos (o consumo é cobrado pelo provedor
dele, nunca pela Arvisx). Empresas que já existem ficam em Premium sem cobrança.

| | Essencial | Standard | Premium |
|---|---|---|---|
| Preço mensal | €59,90 | €129,90 | €199,90 |
| Máximo de números conectados | 3 | 6 | vazio (ilimitado) |
| Máximo de pessoas | 5 | 10 | vazio (ilimitado) |
| Telas | 12 | 31 | 63 (todas) |
| Inclui agentes Arvisx (campo do plano) | não | não | não |

Nenhum plano ofertado marca "Inclui os agentes de IA feitos sob medida": os
Agentes Arvisx são contratados fora do plano.

## Telas de cada plano

No formulário do plano, em "Telas liberadas no plano", abra "Personalizar áreas
visíveis" e marque as telas abaixo (os planos de cima levam as de baixo).
Perfil, Segurança, Notificações, App no celular, Equipe, Plano e cobrança, Ajuda
e Guia de uso valem em todo plano e não aparecem no seletor.

As listas estão escritas à mão em `tests/helpers/distribuicao-dos-planos.ts`; a conferência automática é `tests/unit/planos-distribuicao-das-telas.test.ts`
(12 + 19 + 32 = 63; tela nova no catálogo sem degrau reprova o teste).

### Essencial — 12 telas (atender e organizar)

- Atendimento: Inbox, Agenda, Respostas rápidas.
- CRM: Funis, Etapas do funil, Contatos, Tarefas.
- Canais: Conexões.
- Organização: Tipos de agendamento, Aviso de agendamento, Tags, LGPD (obrigação legal: nunca fica de fora).

### Standard — mais 19 telas (total 31)

- Atendimento: Radar.
- CRM: Empresas, Pessoas, Planos de tarefa, Importações.
- Agente de IA: Agentes, Follow-ups, Fluxos de atendimento, Conhecimento, Credenciais, Provedores, Casos, Alertas, Aviso no WhatsApp, Uso e orçamento.
- Análise: Atividades.
- Organização: Distribuição de atendimento, Recursos opcionais, Automações.

### Premium — mais 32 telas (total 63, tudo)

- Vender: Propostas, Produtos, Comandas, Campanhas (CRM); Propostas, Modelos de proposta, Financeiro, Meta de vendas (Organização).
- Prospectar: Prospecção, Cold Call, Chamadas (CRM); Trunk SIP (Organização).
- IA avançada (Agente de IA): Roteadores, Memória, Skills, Propostas, Execuções.
- Medir e gerir: Desempenho, Faturamento, Honorários, Meta Ads, Evolução da IA, Audit Log (Análise); Conversões, Meta Ads (Organização).
- Integrar e controlar: Webhooks, Nuvemshop (Canais); API Tokens, Servidor MCP externo, Extensões, Dados externos, Marca (Organização).

No Premium basta deixar o perfil **Completa** sem personalizar: todas as telas.

### Por que essa divisão

- O Essencial é o que se precisa para atender e acompanhar clientes. LGPD fica aqui por obrigação legal.
- O Standard entrega a ferramenta de agentes de IA (agentes, conhecimento, follow-up, fluxo, casos, controle de custo), que o próprio cliente configura, mais o cadastro B2B e a importação de dados. O código não limita a quantidade de agentes.
- O Premium reúne o que faz a empresa crescer e se controlar: vender em escala, prospectar, medir, integrar e a IA avançada (vários agentes com roteamento, memória e ações próprias). Os Agentes Arvisx (serviço à parte) são vendidos para qualquer plano; o que cada agente precisa das telas do CRM é visto na reunião.
- Se uma tela do Standard fizer falta de verdade para o cliente, o dono ajusta a lista pelo /admin/cobranca.

## Textos de cada plano (para colar em /admin/cobranca)

Campos do formulário, em "Textos do plano" (migration 9803): **Descrição curta**
(até 140), **Para quem é** (até 200), **O que tem** (uma frase por linha, até 8
de 120), **O que não tem** (uma frase por linha, até 5 de 200) e **Como
funciona** (até 600, aparece em destaque no card). Campo vazio não aparece. Não
marque "Inclui os 4 agentes de IA feitos sob medida" em nenhum dos três planos.

### Essencial

- Descrição curta: Atender e organizar.
- Para quem é: Quem está começando ou atende com equipe pequena e quer sair do WhatsApp solto.
- O que tem:
  - Conversas de todos os canais num lugar só
  - Agenda
  - Funis de vendas
  - Contatos e tarefas
  - Respostas rápidas
  - Até 3 canais e 5 pessoas
- O que não tem:
  - Não tem agentes de IA, cadastro de empresas, propostas, campanhas nem relatórios.
  - Mude para o Standard quando quiser que a IA responda e faça follow-up por você, ou precisar de mais de 3 canais ou 5 pessoas.

### Standard

- Descrição curta: Atender e automatizar com IA.
- Para quem é: Equipe que já atende bem e perde tempo respondendo o que se repete.
- O que tem:
  - Tudo do Essencial
  - Agentes de IA que respondem e fazem follow-up
  - Base de conhecimento e fluxos de atendimento
  - Casos, alertas e controle de uso da IA
  - Cadastro de empresas e pessoas, e importação de planilhas
  - Distribuição de atendimento
  - Até 6 canais e 10 pessoas
  - A IA usa a credencial que você conecta
- O que não tem:
  - Não tem propostas, produtos, campanhas em massa nem prospecção.
  - Não tem relatórios de desempenho e financeiros nem integrações por API.
  - Não tem as telas de configuração avançada de IA (roteamento entre agentes, memória, ações próprias).
  - Você configura e gerencia os seus agentes; a Arvisx não cria agentes nesse plano.
  - Mude para o Premium quando precisar vender em escala, prospectar, medir resultado, integrar outros sistemas, usar IA avançada ou passar de 6 canais ou 10 pessoas.

### Premium

- Descrição curta: Operar a empresa inteira.
- Para quem é: Empresa que vende, acompanha números e tem equipe e canais crescendo.
- O que tem:
  - Tudo do Standard
  - Propostas, produtos e comandas
  - Campanhas, prospecção e Cold Call
  - Desempenho, faturamento e honorários
  - Meta Ads e conversões
  - Configuração avançada de IA: roteamento entre agentes, memória e ações próprias
  - Integrações (API, webhooks, Nuvemshop) e marca própria
  - Canais e pessoas ilimitados
- O que não tem:
  - Não tem agentes feitos sob medida pela Arvisx: esse é o serviço à parte Agentes Arvisx.
  - Você configura e gerencia os seus agentes; a Arvisx não cria agentes nesse plano.

### Equipe Completa (arquivado em 2026-11-12, não recriar)

Saiu da oferta em 2026-11-12, por decisão do dono: é prestação de serviço, não
sistema. O plano continua em `cobranca_planos`, arquivado e sem assinantes; não
foi apagado. Custava €499,90 e prometia 4 agentes de IA sob medida. O que ele
vendia passou a ser o serviço à parte Agentes Arvisx, sem quantidade fixa.

O que ficou no código só para quem tivesse esse plano, e por isso não dispara
mais: a lista "Equipe Completa aguardando contato" de /admin/cobranca e o e-mail
à equipe (migration 9804), a mensagem do painel da assinatura e a frase "Ao sair
do Equipe Completa…" na troca de plano. Ficam para uma limpeza futura.

## Agentes Arvisx (serviço à parte)

Agentes de IA desenvolvidos pela equipe Arvisx depois de entender a operação do
cliente, conectados a essa operação: ao Arvisx CRM ou aos sistemas que ele já usa.

- **Não depende do Arvisx CRM nem de plano.** Vale para quem usa o Arvisx CRM em
  qualquer plano (inclusive o Essencial) e para quem usa outras ferramentas. Não
  escrever que os agentes são "integrados ao CRM".
- **Começa por uma reunião** de 30 minutos (/agendar; o botão fica na seção
  "Agentes Arvisx" da página inicial). Depois da reunião a equipe envia a
  proposta, com escopo, prazo e valor.
- **Sem preço público.** O valor é orçado na reunião e cobrado fora da Stripe e
  fora da cobrança do CRM. Não crie plano nem preço para os Agentes Arvisx em
  /admin/cobranca.
- **Sem prometer quantidade nem funções fixas.** O nome do assistente é o do
  cliente, e o agente se apresenta como assistente virtual.
- A IA usa a credencial do próprio cliente, como nos planos.

## Quem cuida dos agentes de IA

Regra comercial (Lucas e Dr. Renan): no Essencial, no Standard e no Premium, a
gestão e a configuração dos agentes de IA dentro da plataforma são do cliente. A
Arvisx só desenvolve soluções personalizadas pelo serviço à parte Agentes Arvisx.

A reunião não depende de plano cadastrado: /agendar e o botão da seção dos
Agentes Arvisx na página inicial funcionam mesmo sem nenhum plano em
/admin/cobranca.

Esse aviso NÃO é texto de plano e não se cola em /admin/cobranca: é fixo, mora em
`lib/cobranca/quem-cuida-dos-agentes.ts` e aparece igual na página inicial (abaixo
dos planos) e no comparativo dos planos (fim do teste, Assinar, Plano e cobrança).
É só texto: nenhum plano limita a quantidade de agentes que o cliente cria.

## Teste de 7 dias

O teste de 7 dias é do plano que o cliente escolher: cadastre cada um dos três
planos com `trial_dias = 7`. Não há plano de entrada separado.

## Ordem para colocar no ar

1. Fechar o cadastro em /admin/cadastro, antes do deploy.
2. Aplicar as migrations 9801 a 9804 no banco (o `init.sh` aplica pela lista
   `deploy/arvisx/crm/migracoes-pos-baseline.txt`). Sem a 9802 no banco antes da
   imagem nova, toda empresa fica só com o Atendimento.
3. Subir a imagem nova.
4. Criar os 3 planos em /admin/cobranca, com os preços, as telas e os textos acima.
5. Testar a assinatura em modo de teste da Stripe (`docs/arvisx/STRIPE-MODO-TESTE.md`).
6. Só então reabrir o cadastro em /admin/cadastro.

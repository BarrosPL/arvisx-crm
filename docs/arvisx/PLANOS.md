# Planos do ArvisX CRM

Referência para o dono e o Hermes criarem os planos à mão em **/admin/cobranca**.
Nenhum plano é criado por seed nem por migration. O preço e os textos vêm sempre
do cadastro do plano; o código não tem valor nem texto de plano escrito.

Todos mensais, em euro, cobrados pela Stripe. A IA usa a credencial que o
próprio cliente conecta, em todos os planos (o consumo é cobrado pelo provedor
dele, nunca pela Arvisx). Empresas que já existem ficam em Premium sem cobrança.

| | Essencial | Standard | Premium | Equipe Completa |
|---|---|---|---|---|
| Preço mensal | €59,90 | €129,90 | €199,90 | €499,90 |
| Máximo de números conectados | 3 | 6 | vazio (ilimitado) | vazio (ilimitado) |
| Máximo de pessoas | 5 | 10 | vazio (ilimitado) | vazio (ilimitado) |
| Telas | 12 | 31 | 63 (todas) | 63 (todas) |
| Inclui agentes Arvisx | não | não | não | **sim** |

## Telas de cada plano

No formulário do plano, em "Telas liberadas no plano", abra "Personalizar áreas
visíveis" e marque as telas abaixo (os planos de cima levam as de baixo).
Perfil, Segurança, Notificações, App no celular, Equipe, Plano e cobrança, Ajuda
e Guia de uso valem em todo plano e não aparecem no seletor.

A conferência automática está em `tests/unit/planos-distribuicao-das-telas.test.ts`
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

No Premium e no Equipe Completa basta deixar o perfil **Completa** sem
personalizar: todas as telas.

### Por que essa divisão

- O Essencial é o que se precisa para atender e acompanhar clientes. LGPD fica aqui por obrigação legal.
- O Standard entrega um agente de IA funcionando (agente, conhecimento, follow-up, fluxo, casos, controle de custo), mais o cadastro B2B e a importação de dados.
- O Premium reúne o que faz a empresa crescer e se controlar: vender em escala, prospectar, medir, integrar e a IA avançada (vários agentes com roteamento, memória e ações próprias). Os 4 agentes do Equipe Completa usam Roteadores, Skills, Memória, Webhooks e API: por isso o Premium é o mínimo para eles.
- Se uma tela do Standard fizer falta de verdade para o cliente, o dono ajusta a lista pelo /admin/cobranca.

## Textos de cada plano (para colar em /admin/cobranca)

Campos do formulário, em "Textos do plano" (migration 9803): **Descrição curta**
(até 140), **Para quem é** (até 200), **O que tem** (uma frase por linha, até 8
de 120), **O que não tem** (uma frase por linha, até 5 de 200) e **Como
funciona** (até 600, aparece em destaque no card). Campo vazio não aparece. No
Equipe Completa, marque também "Inclui os 4 agentes de IA feitos sob medida".

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
  - Um agente de IA que responde e faz follow-up
  - Base de conhecimento e fluxos de atendimento
  - Casos, alertas e controle de uso da IA
  - Cadastro de empresas e pessoas, e importação de planilhas
  - Distribuição de atendimento
  - Até 6 canais e 10 pessoas
  - A IA usa a credencial que você conecta
- O que não tem:
  - Não tem propostas, produtos, campanhas em massa nem prospecção.
  - Não tem relatórios de desempenho e financeiros nem integrações por API.
  - Não tem a IA avançada (vários agentes, memória, ações próprias).
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
  - IA avançada: vários agentes, memória e ações
  - Integrações (API, webhooks, Nuvemshop) e marca própria
  - Canais e pessoas ilimitados
- O que não tem:
  - Não tem agentes feitos sob medida pela Arvisx (veja o Equipe Completa).

### Equipe Completa

- Descrição curta: O CRM completo e uma equipe de IA feita para a sua operação.
- Para quem é: Quem quer o CRM funcionando e também agentes prontos para o seu negócio, sem montar nada sozinho.
- O que tem:
  - Tudo do Premium
  - 4 agentes de IA criados pela Arvisx para o seu negócio
  - Tudo em uma assinatura só
- O que não tem:
  - O prazo e o escopo de cada agente são combinados no primeiro contato.
  - A IA usa a credencial do próprio cliente.
- Como funciona: Assim que a assinatura é confirmada, nossa equipe entra em contato para entender a sua operação e criar os 4 agentes personalizados de acordo com o que você precisa, integrados ao CRM e às demais ferramentas que você usa. Os agentes não são cópias prontas: são montados para o seu negócio.

O preço (€499,90) não vai no texto: o card mostra o preço do cadastro do plano.

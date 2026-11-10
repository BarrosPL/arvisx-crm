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

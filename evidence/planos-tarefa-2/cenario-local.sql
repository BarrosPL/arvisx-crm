-- Cenário da prova pela tela da tarefa 2 dos planos, SÓ no Supabase local de
-- desenvolvimento (arvisx-treinamento). Não é seed: em produção os planos e os
-- textos são criados à mão pelo dono em /admin/cobranca (docs/arvisx/PLANOS.md).
-- Liga a cobrança, escreve os textos dos quatro planos (os de docs/arvisx/PLANOS.md),
-- aplica a distribuição de telas 12 / 31 / 63 e cria o Equipe Completa.

insert into public.platform_config (chave, valor) values ('MODULO_COBRANCA', 'ligado')
on conflict (chave) do update set valor = excluded.valor;

update public.cobranca_planos set
  interface_settings = '{"preset":"completa","destinos":["/app/inbox","/app/agenda","/app/templates","/app/kanban","/app/settings/tenant/pipelines","/app/contacts","/app/tasks","/app/connections","/app/settings/tenant/agenda","/app/agenda/avisos","/app/settings/tags","/app/lgpd/requests"]}',
  descricao_curta = 'Atender e organizar.',
  para_quem = 'Quem está começando ou atende com equipe pequena e quer sair do WhatsApp solto.',
  destaques = array['Conversas de todos os canais num lugar só','Agenda','Funis de vendas','Contatos e tarefas','Respostas rápidas','Até 3 canais e 5 pessoas'],
  limites = array['Não tem agentes de IA, cadastro de empresas, propostas, campanhas nem relatórios.','Mude para o Standard quando quiser que a IA responda e faça follow-up por você, ou precisar de mais de 3 canais ou 5 pessoas.']
where nome = 'Essencial';

update public.cobranca_planos set
  interface_settings = '{"preset":"completa","destinos":["/app/inbox","/app/agenda","/app/templates","/app/kanban","/app/settings/tenant/pipelines","/app/contacts","/app/tasks","/app/connections","/app/settings/tenant/agenda","/app/agenda/avisos","/app/settings/tags","/app/lgpd/requests","/app/radar","/app/companies","/app/people","/app/tasks/planos","/app/imports","/app/ai/agents","/app/ai/followups","/app/ai/atendimento","/app/ai/knowledge/sources","/app/ai/credentials","/app/ai/providers","/app/ai/cases","/app/ai/inbox","/app/ai/cases/avisos","/app/ai/usage","/app/activities","/app/settings/atendimento","/app/settings/recursos","/app/settings/automacoes"]}',
  descricao_curta = 'Atender e automatizar com IA.',
  para_quem = 'Equipe que já atende bem e perde tempo respondendo o que se repete.',
  destaques = array['Tudo do Essencial','Um agente de IA que responde e faz follow-up','Base de conhecimento e fluxos de atendimento','Casos, alertas e controle de uso da IA','Cadastro de empresas e pessoas, e importação de planilhas','Distribuição de atendimento','Até 6 canais e 10 pessoas','A IA usa a credencial que você conecta'],
  limites = array['Não tem propostas, produtos, campanhas em massa nem prospecção.','Não tem relatórios de desempenho e financeiros nem integrações por API.','Não tem a IA avançada (vários agentes, memória, ações próprias).','Mude para o Premium quando precisar vender em escala, prospectar, medir resultado, integrar outros sistemas, usar IA avançada ou passar de 6 canais ou 10 pessoas.']
where nome = 'Standard';

update public.cobranca_planos set
  descricao_curta = 'Operar a empresa inteira.',
  para_quem = 'Empresa que vende, acompanha números e tem equipe e canais crescendo.',
  destaques = array['Tudo do Standard','Propostas, produtos e comandas','Campanhas, prospecção e Cold Call','Desempenho, faturamento e honorários','Meta Ads e conversões','IA avançada: vários agentes, memória e ações','Integrações (API, webhooks, Nuvemshop) e marca própria','Canais e pessoas ilimitados'],
  limites = array['Não tem agentes feitos sob medida pela Arvisx (veja o Equipe Completa).']
where nome = 'Premium';

insert into public.cobranca_planos
  (id, nome, preco_cents, moeda, intervalo, trial_dias, oferecido_ao_cliente, inclui_agentes_arvisx,
   descricao_curta, para_quem, destaques, limites, como_funciona)
values (
  'aaaaaaaa-0000-4000-8000-000000000004', 'Equipe Completa', 49990, 'EUR', 'mes', 7, true, true,
  'O CRM completo e uma equipe de IA feita para a sua operação.',
  'Quem quer o CRM funcionando e também agentes prontos para o seu negócio, sem montar nada sozinho.',
  array['Tudo do Premium','4 agentes de IA criados pela Arvisx para o seu negócio','Tudo em uma assinatura só'],
  array['O prazo e o escopo de cada agente são combinados no primeiro contato.','A IA usa a credencial do próprio cliente.'],
  'Assim que a assinatura é confirmada, nossa equipe entra em contato para entender a sua operação e criar os 4 agentes personalizados de acordo com o que você precisa, integrados ao CRM e às demais ferramentas que você usa. Os agentes não são cópias prontas: são montados para o seu negócio.'
) on conflict (id) do nothing;

-- A Clínica Bem Viver no teste grátis (plano Teste), sem nada assinado no provedor.
insert into public.cobranca_assinaturas (organization_id, plano_id, estado, trial_ate, modo)
values ('88aa185e-9df0-4abc-88aa-66974ddcb775', 'aaaaaaaa-0000-4000-8000-000000000000', 'trial', now() + interval '6 days', 'teste')
on conflict (organization_id) do update set plano_id = excluded.plano_id, estado = 'trial', trial_ate = excluded.trial_ate;

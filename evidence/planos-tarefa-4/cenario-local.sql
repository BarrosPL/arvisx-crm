-- Cenário da prova pela tela da tarefa 4 dos planos, SÓ no Supabase local de
-- desenvolvimento (arvisx-treinamento), por cima dos cenários das tarefas 2 e 3.
-- Não é seed nem migration: em produção os textos são colados à mão pelo dono em
-- /admin/cobranca. Só troca o "Para quem é" e o "Como funciona" do Equipe Completa
-- pelos de docs/arvisx/PLANOS.md depois da tarefa 4.

update public.cobranca_planos set
  para_quem = 'Para quem quer que a Arvisx entenda a operação e desenvolva os agentes junto com você.',
  como_funciona = 'Começa por uma reunião com a nossa equipe, que orienta a assinatura. Depois da assinatura, a equipe entra em contato para desenvolver os 4 agentes.'
where nome = 'Equipe Completa';

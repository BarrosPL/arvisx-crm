-- Cenário da prova pela tela da tarefa 3 dos planos, SÓ no Supabase local de
-- desenvolvimento (arvisx-treinamento), por cima do cenário da tarefa 2
-- (evidence/planos-tarefa-2/cenario-local.sql). Não é seed nem migration: em
-- produção os textos são colados à mão pelo dono em /admin/cobranca.
-- Só troca os textos do Standard e do Premium pelos de docs/arvisx/PLANOS.md
-- depois da tarefa 3. Não mexe em preço, telas, limites, IVA nem assinatura.

update public.cobranca_planos set
  destaques = array['Tudo do Essencial','Agentes de IA que respondem e fazem follow-up','Base de conhecimento e fluxos de atendimento','Casos, alertas e controle de uso da IA','Cadastro de empresas e pessoas, e importação de planilhas','Distribuição de atendimento','Até 6 canais e 10 pessoas','A IA usa a credencial que você conecta'],
  limites = array['Não tem propostas, produtos, campanhas em massa nem prospecção.','Não tem relatórios de desempenho e financeiros nem integrações por API.','Não tem as telas de configuração avançada de IA (roteamento entre agentes, memória, ações próprias).','Você configura e gerencia os seus agentes; a Arvisx não cria agentes nesse plano.','Mude para o Premium quando precisar vender em escala, prospectar, medir resultado, integrar outros sistemas, usar IA avançada ou passar de 6 canais ou 10 pessoas.']
where nome = 'Standard';

update public.cobranca_planos set
  destaques = array['Tudo do Standard','Propostas, produtos e comandas','Campanhas, prospecção e Cold Call','Desempenho, faturamento e honorários','Meta Ads e conversões','Configuração avançada de IA: roteamento entre agentes, memória e ações próprias','Integrações (API, webhooks, Nuvemshop) e marca própria','Canais e pessoas ilimitados'],
  limites = array['Não tem agentes feitos sob medida pela Arvisx (veja o Equipe Completa).','Você configura e gerencia os seus agentes; a Arvisx não cria agentes nesse plano.']
where nome = 'Premium';

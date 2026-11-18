---
impacto: nada_mudou
secao: corrigido
titulo: O agente de IA corrige sozinho o tipo de agenda errado, e o registro do turno mostra o que cada ferramenta respondeu
---

Quando o agente de IA pedia um tipo de atendimento que não existe na agenda, a
recusa não dizia quais tipos existem, e ele passava a conversa para uma pessoa.
Agora a recusa traz a lista dos tipos ativos e o agente tenta de novo com o tipo
certo. A lista de tipos que o agente consulta também passou a dizer quais têm
horário configurado, para ele não escolher um tipo vazio.

O registro técnico de cada turno do agente (leitura por API, para quem gerencia)
agora guarda um resumo do que cada ferramenta respondeu e marca como "recusado"
quando a ferramenta funcionou, mas disse não. Antes essa situação aparecia como
"ok" e não dava para saber por que o agente não marcou o horário. Ninguém precisa
fazer nada ao atualizar.

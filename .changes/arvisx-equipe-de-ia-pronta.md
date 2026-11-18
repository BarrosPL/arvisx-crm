---
impacto: capacidade_nova
secao: adicionado
titulo: Equipe de IA pronta no plano Premium (instalação por questionário)
---

O plano Premium passa a ter, em IA › Equipe pronta, quatro agentes de IA que
servem a qualquer negócio: Atendimento (recebe e qualifica), Agendamento,
Propostas e Recuperação de vendas. A empresa responde um questionário sobre o
próprio negócio e o CRM instala os agentes, o roteador do canal, a base de
conhecimento com as políticas e perguntas frequentes, o tipo de agenda
principal e o follow-up de recuperação. Tudo nasce em ensaio: só os telefones
de teste falam com os agentes até a empresa ativar.

Nesta versão entram o instalador e as travas; o questionário em passos, o
checklist e os botões de instalar e ativar pela tela chegam na versão seguinte.

Preço e horário não ficam no texto dos agentes: eles consultam o catálogo e a
agenda. Instalar de novo não duplica nada, e agente que a empresa alterou por
conta própria não é substituído sem confirmação.

Empresas no Essencial e no Standard não têm a tela. Quem sai do Premium tem os
quatro agentes pausados, sem perder nada; voltar ao Premium faz voltarem.

Há uma tabela nova no banco (`equipe_pronta_perfis`). Quem atualiza pelo kit
recebe a mudança sozinho; quem aplica as migrações à mão precisa aplicar a
`9808` antes de subir a versão nova.

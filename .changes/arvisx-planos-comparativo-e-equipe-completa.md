---
impacto: exige_acao
secao: adicionado
titulo: Planos com textos que vendem, comparativo por benefício e o plano Equipe Completa
---

Cada plano ganha textos do dono em Admin › Cobrança › Planos (descrição curta, para quem é, o que tem e não tem, "Como funciona"). A tela de assinatura compara os planos em cards e, ao escolher, mostra a diferença de preço mensal e o que entra e sai por área antes de confirmar.

O plano pode ser marcado "inclui os 4 agentes de IA feitos sob medida" (Equipe Completa): quando uma empresa o paga, a equipe da instalação recebe e-mail e o aviso "Equipe Completa aguardando contato" em Admin › Cobrança.

O IVA pode ser cobrado pela Stripe Tax (Admin › Cobrança › Régua, desligado por padrão), com "+ IVA" nas telas.

## Requer atenção

Aplicar as migrations 9803 e 9804 (o `init.sh` já as lista), preencher os textos e marcar as telas por `docs/arvisx/PLANOS.md`. Para IVA, ative o Stripe Tax na Stripe antes.

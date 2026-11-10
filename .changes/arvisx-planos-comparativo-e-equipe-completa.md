---
impacto: exige_acao
secao: adicionado
titulo: Planos com textos que vendem, comparativo por benefício e o plano Equipe Completa
---

Cada plano de cobrança ganha textos escritos pelo dono em Admin › Cobrança ›
Planos: descrição curta, para quem é, o que tem, o que não tem e um parágrafo
"Como funciona" em destaque. A tela de assinatura (fim do teste, Assinar e
Trocar de plano) passa a comparar os planos em cards com esses textos e, ao
escolher um plano, mostra a diferença de preço por mês e o que entra e o que
sai por área (Atender, Automatizar com IA, Vender, Prospectar, Medir e gerir,
Integrar, IA avançada) antes do botão de confirmar.

O plano pode ser marcado como "inclui os 4 agentes de IA feitos sob medida"
(Equipe Completa). Quando uma empresa paga esse plano, a equipe da instalação
recebe um e-mail e o aviso aparece em "Equipe Completa aguardando contato", no
topo de Admin › Cobrança; a empresa vê que o contato vem aí. Nenhum agente é
criado ou desligado pelo sistema.

O IVA passa a poder ser cobrado pela Stripe Tax (Admin › Cobrança › Régua,
desligado por padrão): o preço do plano vira sem IVA, o pagamento pede endereço e
número fiscal e as telas mostram "+ IVA". A página inicial troca o plano único
pelos planos cadastrados, cada um levando ao cadastro com 7 dias de teste grátis.

## Requer atenção

Aplicar as migrations 9803 e 9804 (o `init.sh` do deploy ArvisX já as lista).
Depois do deploy, preencher os textos de cada plano e marcar as telas conforme
`docs/arvisx/PLANOS.md`; enquanto nenhum plano for oferecido, a seção Planos da
página inicial fica só com o botão do teste grátis. Para cobrar IVA, ativar o
Stripe Tax na conta Stripe antes de ligar a opção na Régua.

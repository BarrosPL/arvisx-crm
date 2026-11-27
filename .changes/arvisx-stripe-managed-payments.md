---
impacto: exige_acao
secao: adicionado
titulo: Cobrança por Stripe Managed Payments e imposto em três modos
---

O imposto da cobrança ganha três modos em Admin › Cobrança › Régua: Desligado, Stripe Tax e Managed Payments (a Stripe vende e recolhe o IVA, com taxa adicional). Admin › Cobrança › Planos ganha "Sincronizar produtos na Stripe" (sem duplicar), exigido antes do primeiro Managed Payments, e cada plano pode ser marcado "Fora do Managed Payments" (Equipe Completa já vem). Assinatura de Managed Payments não troca para plano fora dele: cancele e assine de novo.

## Requer atenção

Aplicar a migration 9807 antes da imagem (o `init.sh` já a lista). Depois, seguir `docs/arvisx/STRIPE-MANAGED-PAYMENTS.md`: sincronizar, ativar o Managed Payments na Stripe e só então escolher o modo. Mantenha o Stripe Tax ativo para o plano fora dele.

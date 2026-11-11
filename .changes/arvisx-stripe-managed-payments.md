---
impacto: exige_acao
secao: adicionado
titulo: Cobrança por Stripe Managed Payments e imposto em três modos
---

O imposto da cobrança deixa de ser um liga/desliga e passa a ter três modos em
Admin › Cobrança › Régua: Desligado, Stripe Tax (você vende e a Stripe soma o
IVA) e Managed Payments (a Stripe é a vendedora oficial e recolhe o IVA, com
taxa adicional dela). Quem cobrava IVA pela Stripe Tax continua em Stripe Tax.

Os produtos dos planos na Stripe passam a levar o código fiscal de software, e
Admin › Cobrança › Planos ganha o botão "Sincronizar produtos na Stripe", que
cria ou atualiza o produto de cada plano ativo na conta conectada. É o que a
Stripe pede para ativar o Managed Payments antes da primeira venda; pode ser
repetido sem duplicar nada.

Cada plano pode ser marcado como "Fora do Managed Payments" (o Equipe Completa
já vem marcado): esse plano é cobrado por Stripe Tax mesmo com o modo em Managed
Payments. Uma assinatura de Managed Payments não muda para um plano fora dele:
a troca é recusada com uma mensagem clara, e o caminho é cancelar e assinar de novo.

## Requer atenção

Aplicar a migration 9807 antes da imagem nova (o `init.sh` do deploy ArvisX já a
lista). Depois, seguir a ordem de `docs/arvisx/STRIPE-MANAGED-PAYMENTS.md`:
sincronizar os produtos, ativar o Managed Payments na conta Stripe e só então
escolher o modo na Régua. O Stripe Tax precisa continuar ativo para o plano
marcado como fora do Managed Payments.

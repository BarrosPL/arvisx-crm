---
impacto: capacidade_nova
secao: adicionado
titulo: Onboarding guiado dentro do CRM
---

A empresa nova pode terminar de se montar dentro do próprio CRM. Depois das
boas-vindas ela entra no sistema, e um guia fixo no canto mostra o que falta e
qual é o próximo clique. Cada passo é feito na tela onde ele mora: o WhatsApp em
Conexões, o agente em Agentes, o funil em Funis e os convites em Equipe. O ensaio
do agente roda dentro do próprio guia.

O roteiro, os formulários e as regras de cada passo são os mesmos do wizard.
Quem não administra a empresa entra no CRM sem o guia.

Liga com `ONBOARDING_GUIADO=on`. Sem a variável, o wizard de `/onboarding`
continua como sempre foi. O compose do Easypanel da ArvisX liga por padrão;
`ONBOARDING_GUIADO=off` no `.env` volta ao wizard.

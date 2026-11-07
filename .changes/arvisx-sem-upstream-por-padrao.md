---
impacto: exige_acao
secao: alterado
titulo: A instalação ArvisX não consulta nem envia nada ao projeto de origem por padrão
---

A instalação deixou de apontar para o projeto de origem (DeskcommCRM). As
imagens padrão do compose, do kit e do Easypanel passam a ser as do fork
(`ghcr.io/barrospl/...`, mesmos nomes de pacote), o kit clona e consulta
versões em `BarrosPL/arvisx-crm`, o catálogo de extensões não tem mais origem
padrão e os erros não vão mais para o Sentry do projeto de origem: sem
`SENTRY_DSN`, nada é enviado. O painel "Atualizar pela tela" fica desligado
por padrão.

Webhooks de entrada aceitam o cabeçalho novo `x-arvisx-signature` e continuam
aceitando o antigo. Os webhooks de saída e o MCP externo enviam os cabeçalhos
`X-Arvisx-*` ao lado dos antigos, que continuam saindo.

## Requer atenção

- Quem quer o painel de atualização pela tela precisa de
  `ATUALIZACAO_PELA_TELA=on` no `.env`.
- Quem quer relatório de erros precisa de `SENTRY_DSN=<seu-dsn>` no `.env`.
- Quem usa o catálogo de extensões pelo kit precisa de `EXTENSOES_ORIGEM`.
- Instalações que fixam `APP_IMAGE`, `WORKER_IMAGE` e `SCHEDULER_IMAGE` no
  `.env` não mudam; só quem dependia do padrão passa a baixar do fork.

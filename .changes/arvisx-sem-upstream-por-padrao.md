---
impacto: exige_acao
secao: alterado
titulo: A instalação ArvisX não consulta nem envia nada ao projeto de origem por padrão
---

A instalação ArvisX deixa de consultar ou enviar dados ao projeto de origem (DeskcommCRM): imagens padrão do compose, do kit e do Easypanel são as do fork (`ghcr.io/barrospl/...`), o kit consulta versões em `BarrosPL/arvisx-crm`, sem `SENTRY_DSN` nada vai ao Sentry e "Atualizar pela tela" fica desligado. Webhooks de entrada aceitam `x-arvisx-signature` além do antigo, e os de saída enviam `X-Arvisx-*` ao lado dos antigos.

## Requer atenção

Atualização pela tela: `ATUALIZACAO_PELA_TELA=on`. Relatório de erros: `SENTRY_DSN`. Catálogo de extensões: `EXTENSOES_ORIGEM`. Quem fixa `APP_IMAGE`, `WORKER_IMAGE` e `SCHEDULER_IMAGE` no `.env` não muda.

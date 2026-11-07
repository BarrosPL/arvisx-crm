# ArvisX CRM

Sistema operacional de vendas com agentes de IA e WhatsApp, operado pela **[Arvisx](https://arvisx.com.br)**.
Inbox de WhatsApp (WAHA), funil, agentes de IA com RAG por cliente, automações e o CRM inteiro exposto via MCP.
Multi-tenant, LGPD by-design.

- Produção: <https://crm.arvisx.com.br>
- Repositório: <https://github.com/BarrosPL/arvisx-crm> (privado)
- Suporte: [suporte@arvisx.com.br](mailto:suporte@arvisx.com.br)

## Origem e crédito

O ArvisX CRM é um **fork do [DeskcommCRM](https://github.com/melgarafael/DeskcommCRM)**, criado por
**Rafael Melgaço** e pela comunidade dele, distribuído sob a [licença MIT](LICENSE). O copyright original
continua no [`LICENSE`](LICENSE), e o histórico de versões do upstream fica no [`CHANGELOG.md`](CHANGELOG.md).

O fork acompanha o upstream por merge mensal (registro em [`docs/arvisx/ATUALIZACOES.md`](docs/arvisx/ATUALIZACOES.md)).
O README original do projeto, com instalação self-host, telas, stack e roadmap, está guardado em
[`docs/upstream/README.md`](docs/upstream/README.md) ([English](docs/upstream/README.en.md) · [Español](docs/upstream/README.es.md)).

## Rodar local (desenvolvimento)

```bash
git clone https://github.com/BarrosPL/arvisx-crm.git
cd arvisx-crm
nvm use                     # Node 22
pnpm install
cp .env.example .env.local  # guia completo em docs/SETUP.md
pnpm dev                    # http://localhost:3000
```

O banco sobe a partir de `supabase/baseline.sql` (não pelas migrations). Passo a passo completo, com
extensões e integrações: [`docs/SETUP.md`](docs/SETUP.md). Convenções do código: [`CLAUDE.md`](CLAUDE.md)
e [`ARCHITECTURE.md`](ARCHITECTURE.md). Como contribuir: [`CONTRIBUTING.md`](CONTRIBUTING.md).

### Guias do assistente de IA (vindos do upstream)

O repositório traz os guias `deskcomm-*` do upstream em `.agents/skills/` (instalar, contribuir, métricas,
prompt do agente). Dentro do clone eles já carregam sozinhos no Claude Code, Codex, Cursor, OpenCode e
Antigravity: `/deskcomm-contribuir` no Claude Code, no Cursor e no Antigravity; `$deskcomm-instalar` no
Codex; no OpenCode, peça pelo nome. Para tê-los em qualquer pasta (cópia do upstream):

```bash
curl -fsSL https://raw.githubusercontent.com/melgarafael/DeskcommCRM/main/scripts/instalar-guias.sh | bash
```

Os guias **não** se atualizam sozinhos: rodar o comando de novo traz a versão nova. No Claude Code o guia
instalado vale mais que o do clone. Para desfazer:

```bash
curl -fsSL https://raw.githubusercontent.com/melgarafael/DeskcommCRM/main/scripts/instalar-guias.sh | bash -s -- --remover
```

## Produção (Easypanel)

A produção roda no **Easypanel**, com os arquivos em [`deploy/arvisx/`](deploy/arvisx/):

- [`deploy/arvisx/crm/`](deploy/arvisx/crm/): compose do app, worker e scheduler, `init.sh` e migrações pós-baseline;
- [`deploy/arvisx/supabase/`](deploy/arvisx/supabase/): Supabase self-hosted (compose gerado por `gerar_compose.py`).

Documentação da operação ArvisX em [`docs/arvisx/`](docs/arvisx/) (atualizações do upstream, cifra de
configurações, auditoria da marca).

## Licença

[MIT](LICENSE). Copyright (c) 2026 Rafael Melgaço (DeskcommCRM) e Copyright (c) 2026 Arvisx (alterações do fork).

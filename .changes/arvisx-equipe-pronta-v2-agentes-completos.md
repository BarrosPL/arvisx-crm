---
impacto: capacidade_nova
secao: adicionado
titulo: Equipe de IA pronta, versão 2 dos papéis — os agentes gravam direto, trabalham o mesmo negócio e passam a vez
---

Os quatro agentes da Equipe de IA pronta ganham a versão 2. Quem já instalou vê "atualização disponível" em IA › Equipe pronta; só entra quando alguém instala de novo, e nunca por cima de agente editado à mão sem confirmação.

- **Gravam direto no CRM** (`crm_update_contact`): só preenchem o que está vazio e deixam tarefa para a equipe conferir.
- **Um negócio por contato** aberto no funil.
- **Cada etapa tem dono**: a instalação cria as etapas que faltarem (sem renomear nem apagar) e cada agente só move para as suas.
- **Passam a vez entre si**: o roteador nasce com a passagem ligada, e IA › Roteadores ganha o botão "Passagem entre colegas".
- **Propostas envia** (`crm_send_proposal`) só a aprovada pela equipe, uma vez, da versão conferida.

**Correção:** instalar com o WhatsApp desconectado deixava os quatro agentes pausados; instalar de novo resolve, e pausa feita à mão continua.

Migrations 9814, 9815 e 9820: nenhuma linha existente muda.

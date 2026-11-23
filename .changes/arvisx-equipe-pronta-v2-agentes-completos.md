---
impacto: capacidade_nova
secao: adicionado
titulo: Equipe de IA pronta, versão 2 dos papéis — os agentes gravam direto, trabalham o mesmo negócio e passam a vez
---

Os quatro agentes da Equipe de IA pronta (Atendimento, Agendamento, Propostas e
Recuperação) ganham a versão 2 dos papéis. Quem já instalou vê "atualização
disponível" em IA › Equipe pronta; ela só entra quando alguém instala de novo, e
nunca por cima de um agente editado à mão sem confirmação.

- **Gravam direto no CRM** — os dados do contato (nome, e-mail, outro telefone,
  documento, endereço, data de nascimento e campos personalizados) entram no
  cadastro pela ferramenta nova `crm_update_contact`. Ela só preenche o que
  está vazio: o dado que já está no cadastro não é trocado pelo que o cliente
  escreveu na conversa, e o agente deixa uma tarefa para a equipe conferir. O
  documento é validado, guardado cifrado e nunca mostrado.
- **Um negócio por contato** — quando um agente da equipe tenta criar negócio
  para quem já tem um aberto no funil, recebe o que existe.
- **Cada etapa tem um dono** — a instalação cria no funil as etapas da equipe
  que faltarem (nunca renomeia nem apaga as suas) e cada agente só move o
  negócio para as etapas dele. Para as outras, passa a vez ao colega.
- **Passam a vez entre si** — o roteador que a instalação cria nasce com a
  passagem entre colegas ligada. A tela do roteador (IA › Roteadores) ganhou o
  botão "Passagem entre colegas" para ligar e desligar em qualquer roteador.
- **O agente de Propostas envia a proposta** — pela ferramenta nova
  `crm_send_proposal`. Por padrão só sai a proposta que a equipe aprovou; a
  empresa pode permitir o envio direto quando todos os itens são do catálogo,
  com o preço do catálogo e sem desconto. O botão de aprovar na tela da
  proposta vem na próxima entrega: até lá, no modo padrão, o agente prepara a
  proposta e avisa que ela está em revisão.

**Correção** — instalar a equipe com o WhatsApp desconectado e instalar de novo
depois de conectar publicava os quatro agentes e os deixava pausados, sem
responder ninguém, com o checklist todo verde. Agora o agente sai da pausa na
instalação em que é publicado. Quem ficou nesse estado só precisa instalar de
novo. A pausa que você fez num agente continua valendo.

Migration 9814: duas colunas opcionais em `crm_proposals` para a aprovação da
proposta. Nenhuma linha existente muda.

Migration 9815: editar o rascunho invalida a aprovação pelo banco. Mexer em um
item ou no conteúdo da proposta (título, condições, validade, valores, texto do
documento, modelo) soma um na revisão e derruba a aprovação, mesmo quando a
escrita não passa pela tela. Salvar a proposta passou a gravar campos e itens
de uma vez só: se a gravação dos itens falhar, o rascunho não fica mais sem
itens. Nenhuma linha existente muda.

Migration 9820: função que preenche campo personalizado do contato no banco, só
onde está vazio, sem perder o que outra pessoa gravou ao mesmo tempo. Nenhuma
linha existente muda.

O envio de proposta pelo agente (`crm_send_proposal`) sai uma vez só, mesmo com
dois pedidos ao mesmo tempo, e só da versão do rascunho que foi conferida. Fora
de um atendimento (chamada por integração), só a proposta aprovada pela equipe
é enviada.

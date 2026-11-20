---
impacto: capacidade_nova
secao: adicionado
titulo: Contatos duplicados por agente — achar, juntar com registro e desfazer a junção
---

Três capacidades para o agente externo cuidar da base sem a tela.

- **Achar duplicados** — `crm_find_duplicate_contacts` devolve os grupos de
  contatos que parecem a mesma pessoa: mesmo telefone (com ou sem o nono
  dígito), mesmo e-mail, telefone em conflito ou nome parecido. É a mesma
  detecção da tela de Duplicados. Só leitura. Não funciona dentro de um
  atendimento, e contato marcado como pessoal não aparece.
- **Juntar** — `crm_merge_contacts` junta dois contatos da mesma pessoa, com o
  motivo escrito. Exige papel de gerente: o token do sistema externo precisa
  estar marcado como "tratado como gerente" na tela de tokens. O agente do
  próprio CRM não junta contatos. Não entra por pacote: só marcada à mão.
- **Desfazer** — `crm_undo_contact_merge` separa de novo dois contatos juntados
  por agente, devolvendo a cada um as conversas, os negócios, as tarefas e as
  mensagens que eram dele. Mesmo papel de gerente.

A junção por agente guarda um registro do que mudou de contato, e é ele que
permite voltar atrás. O desfazer não devolve tudo: as etiquetas continuam
somadas no contato que ficou, e o que foi alterado depois da junção fica como
está. A resposta de cada chamada diz o que voltou e o que não voltou. A lista
completa está em `docs/arvisx/SUPERFICIE-DE-AGENTE.md`.

A junção pela tela continua igual: não gera registro e não tem desfazer.

Mudança de banco (migration 9813): a tabela `fusoes_de_contatos`, lida e
gravada só pelo servidor, e três funções. Ela guarda identificadores e nomes de
campo, nunca telefone, e-mail ou etiqueta. Nenhuma linha existente muda.

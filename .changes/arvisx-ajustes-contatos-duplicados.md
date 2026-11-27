---
impacto: capacidade_nova
secao: adicionado
titulo: Contatos duplicados por agente — achar os cadastros repetidos
---

`crm_find_duplicate_contacts` devolve grupos de contatos que parecem a mesma pessoa (telefone com ou sem nono dígito, e-mail, telefone em conflito, nome parecido), pela detecção da tela de Duplicados. Só leitura; não vale dentro de atendimento nem para contato pessoal. **O agente não junta contatos**: continua sendo de gerente, na tela. Migration 9813: tabela `fusoes_de_contatos` (só identificadores) e funções de junção e desfazer, ainda sem uso. Nenhuma linha muda.

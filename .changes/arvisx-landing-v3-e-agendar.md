---
impacto: capacidade_nova
secao: alterado
titulo: Página inicial pública volta com a landing nova e ganha a página /agendar
---

A raiz `/` deixa de ser o aviso provisório "em breve" e passa a mostrar a
landing do Arvisx CRM: plano único com 7 dias de teste grátis, telas do CRM em
carrossel, chamadas de voz e vídeo, IA com as credenciais da empresa, Agentes
Arvisx, perguntas frequentes e aviso de cookies. Quem já tem sessão continua
indo direto para `/app`, e `/login`, `/termos-de-uso` e `/privacidade-e-cookies`
seguem iguais.

O botão "Começar o teste grátis" leva ao cadastro aberto (`/signup`). Se a
instalação estiver em "Cadastro apenas por convite", a tela de cadastro mostra a
recusa, então troque o destino em `lib/landing/links.ts`.

A página nova `/agendar` é pública. Ela traz a reunião de 30 minutos com o time
Arvisx e a agenda do Google incorporada, que só aparece depois que o visitante
confirma que a reunião é para uma solução personalizada. Não há variável nova
nem passo de deploy: basta atualizar a imagem.

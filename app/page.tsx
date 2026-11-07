import type { Metadata } from "next";
import Image from "next/image";
import { redirect } from "next/navigation";

import { OndaDeDados } from "@/components/landing/OndaDeDados";
import { marcaDaSaida } from "@/lib/branding/saida";
import { createClient } from "@/lib/supabase/server";

import "./em-breve.css";

/**
 * Página inicial pública provisória de crm.arvisx.com.br: logo, aviso de que o
 * lançamento está em preparação, uma descrição do produto e os links da
 * política de privacidade e dos termos (o Google exige os dois na página
 * inicial do app para exibir a marca na tela de permissão). A landing
 * completa (protótipo em docs/arvisx/prototipo/landing/) volta depois; a
 * versão anterior desta rota está no histórico do git.
 *
 * Quem tem sessão segue direto para o painel, como sempre foi. `/login`
 * continua funcionando por endereço. `getUser()` e nunca `getSession()`: o
 * redirecionamento só vale para sessão que o servidor de autenticação
 * confirmou.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Arvisx CRM | Em breve",
  description:
    "Arvisx CRM: atendimento, funil de vendas, agenda e automações em um só lugar. Em breve.",
  alternates: { canonical: "https://crm.arvisx.com.br/" },
};

export default async function HomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) redirect("/app");

  // Nome da marca vem do banco (catraca nome-da-marca-nas-telas-vem-do-banco).
  const marca = await marcaDaSaida(null);

  return (
    <main className="em-breve">
      <OndaDeDados className="em-breve__onda" />
      <div className="em-breve__miolo">
        <Image
          className="em-breve__marca"
          src="/marca/arvisx-crm-escuro.png"
          alt={marca.nome}
          width={715}
          height={85}
          priority
        />
        <span className="em-breve__fio" aria-hidden="true" />
        <h1 className="em-breve__titulo">Estamos nos preparando para o nosso lançamento.</h1>
        <p className="em-breve__texto">Em breve, novidades por aqui.</p>
        <p className="em-breve__descricao">
          O {marca.nome} é uma plataforma de atendimento e vendas para empresas: reúne as conversas
          com clientes, o funil de vendas, a agenda de reuniões (com integração ao Google Agenda) e
          automações com inteligência artificial em um só lugar.
        </p>
        <nav className="em-breve__legal" aria-label="Documentos legais">
          <a href="/legal/privacy">Política de Privacidade</a>
          <span aria-hidden="true">·</span>
          <a href="/legal/terms">Termos de Serviço</a>
        </nav>
      </div>
    </main>
  );
}

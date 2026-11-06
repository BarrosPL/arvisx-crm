/**
 * Convite de time, em PT-BR, sem React Email. Devolve subject/html/text.
 * Estilo inline apenas (compatibilidade com cliente de e-mail); zero asset
 * externo.
 *
 * É o PRIMEIRO artefato que um usuário novo recebe do sistema — e chegava com
 * o nome do NOSSO produto em vez do da instalação que convidou. A marca entra
 * resolvida (`marcaDaSaida(organizationId)`, classe A: há organização), e as
 * cores deixam de ser hexes inventados aqui: o botão usa o accent derivado e o
 * resto vem dos neutros da régua do produto.
 *
 * O LOGO entrou depois, e por um motivo medido: `MarcaDeSaida.logoUrl` era
 * campo morto — resolvido, entregue a este template e a nenhum outro, e
 * renderizado por ninguém. Um e-mail que diz o nome do revendedor mas mostra a
 * arte de ninguém é meia marca; e este é o e-mail que a pessoa abre antes de
 * ter visto qualquer tela do produto.
 */
import { rotuloDoPapel } from "@/lib/auth/types";
import type { MarcaDeSaida } from "@/lib/branding/saida";
import { estruturaDeEmail } from "./estrutura";

export interface InviteEmailOptions {
  inviterName: string;
  orgName: string;
  acceptUrl: string;
  role: string;
  expiresAt: Date;
  /** A marca de quem convidou. Obrigatória — sem ela o e-mail não tem dono. */
  marca: MarcaDeSaida;
}

export function buildInviteEmail(opts: InviteEmailOptions): {
  subject: string;
  html: string;
  text: string;
} {
  const expiresStr = opts.expiresAt.toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
  });
  const marca = opts.marca.nome;
  const subject = `${opts.inviterName} convidou você para a ${opts.orgName} no ${marca}`;

  // O papel pelo NOME (« Atendente »), não pelo código (« agent »): o convite dizia
  // « convidou você como agent » em toda instalação.
  const papel = rotuloDoPapel(opts.role);

  const html = estruturaDeEmail(opts.marca, {
    preheader: `${opts.inviterName} convidou você para a ${opts.orgName}.`,
    etiqueta: "Convite",
    titulo: `Você foi convidado para a ${opts.orgName}`,
    corpo: `<p style="margin:0">${escapeHtml(opts.inviterName)} convidou você como <strong>${escapeHtml(papel)}</strong> no ${escapeHtml(marca)}.</p>`,
    botao: { rotulo: "Aceitar convite", href: escapeHtml(opts.acceptUrl) },
    link: escapeHtml(opts.acceptUrl),
    nota: `Este link expira em ${expiresStr}.`,
    rodape: "Se você não esperava este convite, pode ignorá-lo.",
  });

  const text = [
    `Você foi convidado para a ${opts.orgName} como ${papel} no ${marca}.`,
    "",
    `Aceitar: ${opts.acceptUrl}`,
    "",
    `Expira em ${expiresStr}.`,
  ].join("\n");

  return { subject, html, text };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

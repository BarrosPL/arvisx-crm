import {
  LOGO_DO_PRODUTO_SOBRE_ESCURO_URL,
  SITE_DO_PRODUTO,
  SUPORTE_DO_PRODUTO,
  marcaEhADoProduto,
} from "@/lib/branding";
import { NEUTROS_DE_SAIDA, type MarcaDeSaida } from "@/lib/branding/saida";

function escaparHtml(valor: string): string {
  return valor
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * A identidade fixa do e-mail: cabeçalho navy, fio com ponto dourado, corpo
 * branco e rodapé escuro (protótipo aprovado pelo Lucas, `molde-*.html`).
 * Navy e rodapé são a moldura e valem para qualquer marca; o DOURADO é só do
 * produto. Marca de revendedor pinta o botão com o accent dela.
 */
const MOLDURA = {
  cabecalho: "#0f131a",
  fio: "#2c3646",
  rodape: "#151b26",
  rodapeTexto: "#c9ced8",
  rodapeLegenda: "#aab1bd",
  corpo: "#ffffff",
  /** Etiqueta e ponto do fio quando a marca não é a do produto. */
  neutroSobreEscuro: "#c9ced8",
} as const;

const OURO = {
  base: "#d4af37",
  frente: "#0f131a",
  /** Link dourado sobre branco: #a8871f dava 3,4:1; este dá 4,9:1. */
  sobreBranco: "#8a6d12",
} as const;

export type ConteudoDoEmail = {
  /** Texto curto que a caixa de entrada mostra ao lado do assunto. */
  preheader?: string;
  /** Linha em caixa-alta acima do título. */
  etiqueta?: string;
  titulo: string;
  /** HTML do corpo, JÁ escapado pelo chamador. */
  corpo: string;
  /**
   * `href` e `link` chegam prontos para o HTML: o chamador escapa a URL dele, e
   * o molde do GoTrue passa as chaves duplas CRUAS, que são sintaxe do
   * renderizador (`acesso-gotrue.ts`).
   */
  botao?: { rotulo: string; href: string };
  /** O mesmo destino do botão, para copiar e colar. */
  link?: string;
  /** Linha pequena logo abaixo do botão (prazo, segurança). Texto puro. */
  nota?: string;
  /** "Não foi você?" — vai no rodapé escuro. Texto puro. */
  rodape: string;
  idioma?: string;
};

/**
 * Casca dos e-mails que o produto manda (acesso, convite, aviso de troca).
 *
 * Tabelas e estilo inline: é o que Outlook e Gmail respeitam. Sem webfont e sem
 * asset externo além do logo, com a dimensão no ATRIBUTO — o Outlook desktop
 * descarta `height` de style em imagem.
 *
 * O logo vai sobre o navy, então vale primeiro a versão para fundo escuro. Sem
 * logo configurado: a marca do produto usa a arte oficial; a de um revendedor
 * fica sem imagem, porque desenhar outra coisa no lugar seria pôr marca alheia.
 */
export function estruturaDeEmail(marca: MarcaDeSaida, c: ConteudoDoEmail): string {
  const doProduto = marcaEhADoProduto({ name: marca.nome, logoUrl: marca.logoUrl });
  const nome = escaparHtml(marca.nome);
  const logoUrl = doProduto
    ? LOGO_DO_PRODUTO_SOBRE_ESCURO_URL
    : (marca.logoDarkUrl ?? marca.logoUrl);
  const destaque = doProduto ? OURO.base : MOLDURA.neutroSobreEscuro;
  const botaoFundo = doProduto ? OURO.base : marca.accent;
  const botaoFrente = doProduto ? OURO.frente : marca.accentFg;
  const corDoLink = doProduto ? OURO.sobreBranco : marca.accent;
  const linha = NEUTROS_DE_SAIDA.linha;

  const logo = logoUrl
    ? `<img src="${escaparHtml(logoUrl)}" alt="${nome}" height="36" style="height:36px;width:auto;max-width:240px;border:0;display:block">`
    : `<p style="margin:0;font-size:20px;font-weight:bold;color:#ffffff">${nome}</p>`;

  const preheader = c.preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${NEUTROS_DE_SAIDA.fundo}">${escaparHtml(c.preheader)}</div>\n`
    : "";

  const etiqueta = c.etiqueta
    ? `<p style="margin:0 0 8px;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:${destaque};font-weight:bold">${escaparHtml(c.etiqueta)}</p>\n    `
    : "";

  const botao = c.botao
    ? `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="${botaoFundo}" style="background:${botaoFundo};border-radius:8px">
      <a href="${c.botao.href}" style="display:inline-block;padding:14px 30px;font-size:16px;font-weight:bold;color:${botaoFrente};text-decoration:none;border-radius:8px">${escaparHtml(c.botao.rotulo)}&nbsp;&rarr;</a>
    </td></tr></table>`
    : "";

  const nota = c.nota
    ? `
    <p style="margin:18px 0 0;font-size:13px;line-height:1.5;color:${NEUTROS_DE_SAIDA.suave}">${escaparHtml(c.nota)}</p>`
    : "";

  // O endereço numa caixa própria, em fonte de largura fixa e corpo menor. Sem
  // `break-all`: ele quebrava em qualquer letra e sobrava o "f6" sozinho na
  // última linha. `anywhere` só corta palavra quando não há outro ponto, e quem
  // chama pode oferecer um `<wbr>` (o molde do GoTrue quebra antes do token).
  const link = c.link
    ? `
  <tr><td bgcolor="${MOLDURA.corpo}" style="background:${MOLDURA.corpo};padding:24px 32px 30px;border-left:1px solid ${linha};border-right:1px solid ${linha}">
    <div style="border-top:1px solid ${linha};padding-top:16px;font-size:12px;line-height:1.6;color:${NEUTROS_DE_SAIDA.suave}">O botão não funciona? Copie e cole este endereço no navegador:</div>
    <div style="margin-top:8px;padding:10px 12px;background:${NEUTROS_DE_SAIDA.fundo};border-radius:6px;font-family:Consolas,Menlo,'Courier New',monospace;font-size:11px;line-height:1.55;word-break:break-word;overflow-wrap:anywhere"><span style="color:${corDoLink}">${c.link}</span></div>
  </td></tr>`
    : "";

  const assinatura = doProduto
    ? `${nome} &middot; <a href="${SITE_DO_PRODUTO}" style="color:${OURO.base};text-decoration:none">${SITE_DO_PRODUTO.replace(/^https:\/\//, "")}</a> &middot; ${SUPORTE_DO_PRODUTO}`
    : nome;

  return `<!doctype html>
<html lang="${escaparHtml(c.idioma ?? "pt-BR")}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${escaparHtml(c.titulo)}</title></head>
<body style="margin:0;padding:0;background:${NEUTROS_DE_SAIDA.fundo};font-family:Arial,'Segoe UI',Helvetica,sans-serif;color:${NEUTROS_DE_SAIDA.texto}">
${preheader}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${NEUTROS_DE_SAIDA.fundo}" style="background:${NEUTROS_DE_SAIDA.fundo}"><tr><td align="center" style="padding:32px 12px">
 <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:560px">
  <tr><td bgcolor="${MOLDURA.cabecalho}" align="left" style="background:${MOLDURA.cabecalho};border-radius:14px 14px 0 0;padding:28px 32px 22px">
    ${logo}
  </td></tr>
  <tr><td bgcolor="${MOLDURA.cabecalho}" style="background:${MOLDURA.cabecalho};padding:0 32px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td style="border-top:1px solid ${MOLDURA.fio};font-size:0;line-height:0;height:1px" width="100%">&nbsp;</td>
      <td width="8" style="font-size:0;line-height:0"><div style="width:7px;height:7px;border-radius:7px;background:${destaque};margin-left:-4px">&nbsp;</div></td>
    </tr></table>
  </td></tr>
  <tr><td bgcolor="${MOLDURA.cabecalho}" style="background:${MOLDURA.cabecalho};padding:22px 32px 30px">
    ${etiqueta}<h1 style="margin:0;font-size:26px;line-height:1.25;color:#ffffff;font-weight:bold">${escaparHtml(c.titulo)}</h1>
  </td></tr>
  <tr><td bgcolor="${MOLDURA.corpo}" style="background:${MOLDURA.corpo};padding:30px 32px ${c.link ? "8px" : "30px"};border-left:1px solid ${linha};border-right:1px solid ${linha}">
    <div style="margin:0 0 ${c.botao ? "24px" : "0"};font-size:16px;line-height:1.6;color:${NEUTROS_DE_SAIDA.texto}">${c.corpo}</div>${botao}${nota}
  </td></tr>${link}
  <tr><td bgcolor="${MOLDURA.rodape}" style="background:${MOLDURA.rodape};border-radius:0 0 14px 14px;padding:20px 32px">
    <p style="margin:0 0 6px;font-size:13px;line-height:1.5;color:${MOLDURA.rodapeTexto}">${escaparHtml(c.rodape)}</p>
    <p style="margin:0;font-size:12px;line-height:1.5;color:${MOLDURA.rodapeLegenda}">${assinatura}</p>
  </td></tr>
 </table>
</td></tr></table>
</body></html>`;
}

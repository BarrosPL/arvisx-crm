import { respostaDePonte } from "@/lib/auth/ponte-de-volta";
import { marcaDaSaida } from "@/lib/branding/saida";
import { destinoDaVolta } from "@/lib/channels/meta-social/volta";

/**
 * A VOLTA do login do Facebook da conexão direta (Instagram e Messenger).
 *
 * Chega por navegação de outro site, então o cookie de sessão (Strict) não vem:
 * esta rota é pública e NÃO grava nada — nem troca o código. Ela só repassa à
 * tela de Conexões › Redes sociais, por uma ponte same-origin
 * (`respostaDePonte`), o que a Meta trouxe (`destinoDaVolta` filtra cada valor
 * por um formato fixo). Quem conclui é a tela, autenticada, chamando
 * `POST /api/v1/channels/meta-social`, e lá o servidor confere o estado contra
 * a SESSÃO e troca o código.
 *
 * Este caminho (`/auth/meta-social-return`) é o "URI de redirecionamento do
 * OAuth válido" que o dono cadastra no app da Meta — exatamente este.
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const alvo = destinoDaVolta(new URL(request.url).searchParams);
  const marca = await marcaDaSaida(null);
  return respostaDePonte(alvo, marca.nome, "Voltando para suas conexões…");
}

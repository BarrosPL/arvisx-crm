/**
 * O CADASTRO QUE O PLANO RECUSOU NÃO DEIXA LOGIN PENDURADO (auditoria de 11/11/2026).
 *
 * O cadastro pela tela confere o plano ANTES de criar a conta
 * (`app/actions/auth/signUp.ts`). Mas a conta também nasce por fora da tela —
 * `POST /auth/v1/signup` é público para quem tem a chave do navegador — e aí o
 * `cobranca_plan_id` da metadata é o que a pessoa quiser escrever. Quando o
 * e-mail é confirmado, o gatilho da 0679 recusa a empresa (`plano_obrigatorio`)
 * e sobrava uma conta confirmada, com sessão, sem empresa.
 *
 * Aqui a conta recusada é APAGADA, e só ela: quem já teve vínculo com alguma
 * empresa (vivo ou revogado), quem tem pedido de empresa registrado e quem
 * administra a instalação nunca são apagados. Na dúvida (leitura que falhou),
 * a conta fica — apagar errado não tem volta, e o caminho de antes
 * (`/get-started`, escolher um plano) continua existindo para ela.
 */
import { createAdminClient } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";

/** O provisionamento falhou porque o gatilho da cobrança recusou o plano? */
export function recusaPorPlano(motivo: string): boolean {
  return /plano_obrigatorio|plano_invalido/.test(motivo);
}

export type DescarteDaConta = "apagada" | "mantida" | "falhou";

type Admin = ReturnType<typeof createAdminClient>;

async function temLinha(admin: Admin, tabela: string, userId: string): Promise<boolean | null> {
  const { count, error } = await admin.from(tabela).select("user_id", { count: "exact", head: true }).eq("user_id", userId);
  if (error) return null;
  return (count ?? 0) > 0;
}

/**
 * Apaga a conta de quem NUNCA teve empresa e cujo cadastro foi recusado.
 * `userId` vem do usuário que o provedor de auth acabou de validar, nunca de formulário.
 */
export async function descartarContaSemEmpresa(userId: string): Promise<DescarteDaConta> {
  try {
    const admin = createAdminClient();
    for (const tabela of ["user_organizations", "registration_requests", "platform_admins"]) {
      const tem = await temLinha(admin, tabela, userId);
      // `null` é leitura que falhou: não é prova de que a conta é descartável.
      if (tem !== false) return "mantida";
    }
    const { error } = await admin.auth.admin.deleteUser(userId);
    if (error) {
      logger.error("cadastro recusado: não deu para apagar a conta sem empresa", {
        user_id: userId,
        detalhe: error.message,
      });
      return "falhou";
    }
    return "apagada";
  } catch (erro) {
    logger.error("cadastro recusado: falha ao descartar a conta sem empresa", {
      user_id: userId,
      detalhe: erro instanceof Error ? erro.message : String(erro),
    });
    return "falhou";
  }
}

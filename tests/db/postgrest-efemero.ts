/**
 * UM POSTGREST DE VERDADE NA FRENTE DO BANCO DO TESTE, e o cliente de SESSÃO
 * que o código de produção usa.
 *
 * ═══ POR QUE ISTO EXISTE ═══
 *
 * `pnpm test:db` sobe Postgres puro. Para rodar código que fala
 * `supabase.from(...)` existe `tests/pg-como-supabase.ts`, que conecta como
 * `postgres` (sem RLS) e implementa uma parte pequena do construtor de consulta.
 *
 * O Vix lê o CRM com o cliente de SESSÃO do usuário, e a prova que importa é a
 * do caminho inteiro: a ferramenta real, o construtor real, o PostgREST real e
 * a RLS real, com o JWT de uma pessoa. Aqui sobe um contêiner do PostgREST
 * apontado para o banco do teste, e `clienteDeSessao(userId)` devolve um
 * `SupabaseClient` de verdade, autenticado como aquele usuário, papel
 * `authenticated`. Nada é emulado.
 *
 * ═══ O QUE ELE NÃO REPRODUZ ═══
 *
 * Auth (GoTrue), Storage e Realtime não existem aqui: `supabase.auth.getUser()`
 * e `supabase.storage` não funcionam. Código que dependa deles não é medido
 * por este instrumento.
 *
 * ═══ USO ═══
 *
 *   let rest: PostgrestEfemero;
 *   beforeAll(async () => { rest = await subirPostgrest(); }, 120_000);
 *   afterAll(() => rest.derrubar());
 *   const db = await rest.clienteDeSessao(userId);
 */
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SignJWT } from "jose";

/** Versão fixa: imagem de terceiro é referenciada por tag, nunca `latest`. */
const IMAGEM = "postgrest/postgrest:v12.2.3";

export interface PostgrestEfemero {
  url: string;
  /** Cliente autenticado como `userId` (papel `authenticated`), como a sessão do navegador. */
  clienteDeSessao: (userId: string) => Promise<SupabaseClient>;
  /** Cliente com o papel `service_role` (ignora RLS), como `createAdminClient()`. */
  clienteDeServico: () => Promise<SupabaseClient>;
  /** Recarrega o cache de schema (depois de DDL feito pelo teste). */
  recarregar: () => void;
  derrubar: () => void;
}

function docker(args: string[]): string {
  return execFileSync("docker", args, { encoding: "utf8" }).trim();
}

export async function subirPostgrest(): Promise<PostgrestEfemero> {
  const banco = process.env.TEST_DB_CONTAINER;
  if (!banco) {
    throw new Error("TEST_DB_CONTAINER ausente — rode por `pnpm test:db` (scripts/test-db.sh).");
  }
  const ip = docker([
    "inspect",
    "-f",
    "{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}",
    banco,
  ]);
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(ip)) {
    throw new Error(`não consegui ler o IP do contêiner do banco (${banco}): "${ip}"`);
  }

  const segredo = randomBytes(48).toString("hex");
  const nome = `${banco}-postgrest-${randomBytes(4).toString("hex")}`;
  docker([
    "run",
    "-d",
    "--rm",
    "--name",
    nome,
    "--label",
    "deskcomm.harness=test-db",
    "-p",
    "127.0.0.1::3000",
    "-e",
    `PGRST_DB_URI=postgres://postgres:postgres@${ip}:5432/postgres`,
    "-e",
    "PGRST_DB_SCHEMAS=public",
    "-e",
    "PGRST_DB_ANON_ROLE=anon",
    "-e",
    `PGRST_JWT_SECRET=${segredo}`,
    "-e",
    "PGRST_DB_POOL=4",
    IMAGEM,
  ]);

  const derrubar = () => {
    try {
      docker(["rm", "-f", nome]);
    } catch {
      /* já saiu */
    }
  };

  try {
    const porta = docker(["port", nome, "3000/tcp"]).split("\n")[0]?.replace(/.*:/, "");
    if (!porta) throw new Error("não consegui ler a porta publicada do PostgREST");
    const url = `http://127.0.0.1:${porta}`;

    const chave = new TextEncoder().encode(segredo);
    const assinar = (claims: Record<string, unknown>) =>
      new SignJWT(claims).setProtectedHeader({ alg: "HS256" }).setExpirationTime("1h").sign(chave);

    const cliente = (jwt: string): SupabaseClient =>
      createClient(url, jwt, {
        auth: { persistSession: false, autoRefreshToken: false },
        global: {
          // O supabase-js chama `<url>/rest/v1/...`; o PostgREST serve na raiz.
          fetch: (entrada, init) => fetch(String(entrada).replace("/rest/v1/", "/"), init),
        },
      });

    // Espera o cache de schema: a raiz responde 200 quando ele está carregado.
    const prazo = Date.now() + 90_000;
    for (;;) {
      try {
        const r = await fetch(`${url}/`, { method: "HEAD" });
        if (r.ok) break;
      } catch {
        /* ainda subindo */
      }
      if (Date.now() > prazo) {
        throw new Error(`PostgREST não respondeu em 90s. Log:\n${docker(["logs", "--tail", "40", nome])}`);
      }
      await new Promise((r) => setTimeout(r, 500));
    }

    return {
      url,
      clienteDeSessao: async (userId) => cliente(await assinar({ role: "authenticated", sub: userId })),
      clienteDeServico: async () => cliente(await assinar({ role: "service_role" })),
      recarregar: () => {
        docker(["kill", "-s", "SIGUSR1", nome]);
      },
      derrubar,
    };
  } catch (erro) {
    derrubar();
    throw erro;
  }
}

import { beforeEach, describe, expect, it, vi } from "vitest";

import type * as Instalacao from "@/lib/branding/instalacao";

/**
 * Link colado no WhatsApp ou numa rede social só ganha imagem quando a página
 * declara `og:image`. A página inicial já declarava; /login, /signup e as demais
 * herdam do layout raiz — e só quando a marca em vigor é a do produto, porque a
 * arte soletra o nome dele.
 */
vi.mock("next/font/local", () => ({ default: () => ({ variable: "" }) }));
vi.mock("next/headers", () => ({ headers: vi.fn() }));

const marcaDaInstalacao = vi.hoisted(() => vi.fn());
vi.mock("@/lib/branding/instalacao", async (original) => ({
  ...(await original<typeof Instalacao>()),
  marcaDaInstalacao,
}));

import { generateMetadata } from "@/app/layout";

describe("metadata de compartilhamento do layout raiz", () => {
  beforeEach(() => marcaDaInstalacao.mockReset());

  it("com a marca do produto, declara a imagem com endereço absoluto e o cartão grande", async () => {
    marcaDaInstalacao.mockResolvedValue({ app_name: "Arvisx CRM" });
    const meta = await generateMetadata();
    const imagens = meta.openGraph?.images as { url: string; width: number; height: number }[];
    expect(imagens).toHaveLength(1);
    expect(imagens[0]?.url).toMatch(/^https?:\/\/[^/]+\/og-arvisx\.jpg$/);
    expect(imagens[0]).toMatchObject({ width: 1200, height: 630 });
    expect(meta.twitter).toMatchObject({ card: "summary_large_image", images: [imagens[0]?.url] });
  });

  it("com marca própria, não anuncia a instalação com a arte do produto", async () => {
    marcaDaInstalacao.mockResolvedValue({ app_name: "Central" });
    const meta = await generateMetadata();
    expect(meta.openGraph).toBeUndefined();
    expect(meta.twitter).toBeUndefined();
  });
});

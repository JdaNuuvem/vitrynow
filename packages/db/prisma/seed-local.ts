import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { prisma } from "../src/index";

const storeId = "local-ramenku";
const slug = "ramenku";
const email = "dono@ramenku.local";
// SEC: nenhuma senha fixa no repositorio (publico). Vem de SEED_LOCAL_PASSWORD ou e gerada na hora e mostrada UMA vez, so quando a loja e criada.
const initialPassword = process.env.SEED_LOCAL_PASSWORD?.trim() || randomBytes(12).toString("base64url");
const passwordFromEnv = Boolean(process.env.SEED_LOCAL_PASSWORD?.trim());
const media = "/local-ramenku";

type LocalProduct = {
  name: string;
  description: string;
  photo: string;
  priceCents: number;
  featured?: boolean;
  soldOut?: boolean;
  additionals?: { name: string; priceCents: number }[];
};

const ramenExtras = [
  { name: "Ovo marinado", priceCents: 450 },
  { name: "Chashu extra", priceCents: 750 },
];

const catalog: { name: string; products: LocalProduct[] }[] = [
  {
    name: "Ramen",
    products: [
      { name: "Tonkotsu ramen", description: "Caldo de porco, chashu, ovo marinado e nori.", photo: "tonkotsu", priceCents: 4290, featured: true, additionals: ramenExtras },
      { name: "Miso ramen", description: "Caldo de missô, macarrão fresco e cebolinha.", photo: "miso", priceCents: 3890, featured: true, additionals: ramenExtras },
      { name: "Shoyu ramen", description: "Caldo de shoyu, bambu e ovo marinado.", photo: "shoyu", priceCents: 3990, soldOut: true, additionals: ramenExtras },
    ],
  },
  {
    name: "Acompanhamentos",
    products: [
      { name: "Gyoza da casa", description: "Seis guiozas de carne e legumes com molho da casa.", photo: "gyoza", priceCents: 2490 },
    ],
  },
  {
    name: "Bebidas",
    products: [
      { name: "Chá verde gelado", description: "Chá verde com gelo, 350 ml.", photo: "cha-verde", priceCents: 990, soldOut: true },
    ],
  },
];

function checkDatabaseTarget() {
  if (process.env.NODE_ENV === "production" || !process.env.DATABASE_URL) {
    throw new Error("A carga Ramenku precisa de DATABASE_URL em ambiente de desenvolvimento.");
  }
  const url = new URL(process.env.DATABASE_URL);
  const localHosts = new Set(["localhost", "127.0.0.1", "[::1]", "postgres", "db"]);
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !localHosts.has(url.hostname) || url.pathname !== "/vitry_local") {
    throw new Error("A carga Ramenku aceita somente o PostgreSQL local vitry_local.");
  }
}

async function main() {
  checkDatabaseTarget();
  const passwordHash = await bcrypt.hash(initialPassword, 10);
  const created = await prisma.$transaction(async (tx) => {
    // Dois inicializadores concorrentes devem observar a mesma decisão de criar ou preservar.
    await tx.$queryRaw`SELECT 1::int AS locked FROM pg_advisory_xact_lock(24011, 1)`;
    const existing = await tx.store.findUnique({ where: { id: storeId }, select: { id: true } });
    if (existing) return false;

    await tx.store.create({
      data: {
        id: storeId,
        slug,
        code: "RAMENKU-LOCAL",
        name: "Ramenku",
        coverImageUrl: `${media}/fachada.webp`,
        primaryColor: "#A81E22",
        openingHours: "Todos os dias, das 11h às 22h",
        deliveryEnabled: true,
        pickupEnabled: true,
        acceptingOrders: true,
        minOrderCents: 1500,
        deliveryFeeCents: 600,
        users: { create: { email, passwordHash, role: "OWNER" } },
        subscription: { create: { trialEndsAt: new Date(Date.now() + 14 * 86_400_000) } },
      },
    });

    for (const [position, category] of catalog.entries()) {
      const saved = await tx.category.create({
        data: { id: category.name === "Ramen" ? "local-ramenku-ramen" : undefined, storeId, name: category.name, position },
      });
      for (const [itemPosition, item] of category.products.entries()) {
        await tx.product.create({
          data: {
            storeId,
            categoryId: saved.id,
            name: item.name,
            description: item.description,
            imageUrl: `${media}/${item.photo}.webp`,
            priceCents: item.priceCents,
            featured: item.featured ?? false,
            soldOut: item.soldOut ?? false,
            position: itemPosition,
            additionals: item.additionals && { create: item.additionals },
          },
        });
      }
    }
    return true;
  });
  console.log(created ? `Ramenku local criada em /loja/${slug}. Proprietário: ${email}.${passwordFromEnv ? " Senha: a de SEED_LOCAL_PASSWORD." : ` Senha gerada (anote, não aparece de novo): ${initialPassword}`}` : "A loja Ramenku local já foi inicializada.");
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Falha ao carregar a loja local.");
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

import bcrypt from "bcryptjs";
import { prisma } from "../src/index";

async function main() {
  // B25: o seed cria a conta conhecida dono@lojateste.com / senha123. Nunca em produção.
  if (process.env.NODE_ENV === "production") {
    throw new Error("seed recusado: NODE_ENV=production (cria uma conta com senha conhecida)");
  }
  const passwordHash = await bcrypt.hash("senha123", 10);

  const store = await prisma.store.upsert({
    where: { slug: "loja-teste" },
    update: {},
    create: { name: "Loja Teste", slug: "loja-teste", code: "0001" },
  });

  await prisma.user.upsert({
    where: { email: "dono@lojateste.com" },
    update: {},
    create: { storeId: store.id, email: "dono@lojateste.com", passwordHash, role: "OWNER" },
  });

  const existingCategories = await prisma.category.count({ where: { storeId: store.id } });
  if (existingCategories === 0) {
    const lanches = await prisma.category.create({ data: { storeId: store.id, name: "Lanches", position: 0 } });
    const bebidas = await prisma.category.create({ data: { storeId: store.id, name: "Bebidas", position: 1 } });

    const cheeseburguer = await prisma.product.create({
      data: { storeId: store.id, categoryId: lanches.id, name: "Cheeseburguer", priceCents: 1500, position: 0, featured: true },
    });
    await prisma.productAdditional.createMany({
      data: [
        { productId: cheeseburguer.id, name: "Bacon extra", priceCents: 400 },
        { productId: cheeseburguer.id, name: "Queijo extra", priceCents: 300 },
      ],
    });
    await prisma.product.createMany({
      data: [
        { storeId: store.id, categoryId: lanches.id, name: "X-Bacon", priceCents: 1800, position: 1 },
        { storeId: store.id, categoryId: bebidas.id, name: "Refrigerante lata", priceCents: 600, position: 0 },
      ],
    });
  }

  console.log(`Loja de teste pronta: slug=${store.slug} login=dono@lojateste.com senha=senha123`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

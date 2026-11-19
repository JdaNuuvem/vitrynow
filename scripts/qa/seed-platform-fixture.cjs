const assert = require("node:assert/strict");
const { randomBytes } = require("node:crypto");

async function seedPlatformFixture(prisma, bcrypt) {
  const suffix = randomBytes(5).toString("hex");
  const credentials = (name) => ({ email: `qa-${name}-${suffix}@example.test`, password: randomBytes(18).toString("base64url") });
  const admin = credentials("admin");
  const support = credentials("support");
  const owner = credentials("owner");
  const staff = credentials("staff");
  const [adminHash, supportHash, ownerHash, staffHash] = await Promise.all(
    [admin, support, owner, staff].map((account) => bcrypt.hash(account.password, 10)),
  );
  const orderCode = "QA1001";
  const openOrderCode = "QA1002";
  const customerName = "Cliente fict\u00edcio de QA";
  const now = new Date();
  const store = await prisma.$transaction(async (tx) => {
    await tx.platformAdmin.createMany({ data: [
      { email: admin.email, passwordHash: adminHash, role: "ADMIN" },
      { email: support.email, passwordHash: supportHash, role: "SUPPORT" },
    ] });
    return tx.store.create({
      data: {
        name: `Loja QA plataforma ${suffix}`,
        slug: `qa-platform-${suffix}`,
        code: suffix.toUpperCase(),
        subscription: { create: { trialEndsAt: new Date(now.getTime() + 14 * 86_400_000) } },
        users: { create: [
          { email: owner.email, passwordHash: ownerHash, role: "OWNER", emailVerifiedAt: now },
          { email: staff.email, passwordHash: staffHash, role: "STAFF", emailVerifiedAt: now },
        ] },
        orders: { create: [
          { code: orderCode, status: "CONCLUIDO", type: "BALCAO", customerName, customerPhone: "11911110001", totalCents: 2200 },
          { code: openOrderCode, status: "PENDENTE", type: "BALCAO", customerName, customerPhone: "11911110002", totalCents: 3500 },
        ] },
        deviceAlerts: { create: { code: "MODE_UNCONFIRMED", lastAt: now, windowStart: now, expiresAt: new Date(now.getTime() + 30 * 86_400_000) } },
      },
      select: { id: true, name: true, slug: true },
    });
  });
  return { store, owner, staff, support, admin, orderCode, openOrderCode, customerName };
}

async function seedFromCompose() {
  assert.equal(process.env.VITRY_PLATFORM_QA_STACK, "vitry-handoff-qa", "A sobreposição da QA da plataforma não está ativa.");
  assert.equal(process.env.NODE_ENV, "development");
  const dbUrl = new URL(process.env.DATABASE_URL);
  assert.equal(dbUrl.protocol, "postgresql:");
  assert.equal(dbUrl.hostname, "postgres");
  assert.equal(dbUrl.port, "5432");
  assert.equal(dbUrl.pathname, "/vitry_local");
  const { prisma } = require("@meucardapio/db");
  try {
    const [row] = await prisma.$queryRaw`SELECT current_database() AS name`;
    assert.equal(row.name, "vitry_local");
    process.stdout.write(JSON.stringify(await seedPlatformFixture(prisma, require("bcrypt"))));
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1] === "-") {
  void seedFromCompose().catch((error) => {
    process.stderr.write(`A preparação da fixture foi interrompida (${error.code || error.name}). Confira o projeto descartável, a sobreposição e as migrações.\n`);
    process.exitCode = 1;
  });
}

module.exports = { seedPlatformFixture };

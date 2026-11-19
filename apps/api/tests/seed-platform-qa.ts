import { randomBytes } from "node:crypto";
import bcrypt from "bcrypt";
import { assertSafeToReset, assertTestDatabaseUrl } from "./dbGuard";

async function main() {
  if (process.env.NODE_ENV === "production") throw new Error("A conta de QA exige um ambiente de teste local.");
  const role = process.argv[2] ?? "SUPPORT";
  if (role !== "ADMIN" && role !== "SUPPORT" && role !== "BROWSER") throw new Error("Informe ADMIN, SUPPORT ou BROWSER.");
  process.env.DATABASE_URL = assertTestDatabaseUrl(process.env.TEST_DATABASE_URL);
  const { prisma } = await import("@meucardapio/db");
  try {
    await assertSafeToReset({ currentDatabase: async () => {
      const [row] = await prisma.$queryRaw<{ name: string }[]>`SELECT current_database() AS name`;
      return row.name;
    } });
    if (role !== "BROWSER") {
      const email = `qa-${role.toLowerCase()}-${randomBytes(5).toString("hex")}@example.test`;
      const password = randomBytes(18).toString("base64url");
      await prisma.platformAdmin.create({ data: { email, passwordHash: await bcrypt.hash(password, 10), role } });
      process.stdout.write(`${role}\nE-mail: ${email}\nSenha: ${password}\n`);
      return;
    }

    const { seedPlatformFixture } = require("../../../scripts/qa/seed-platform-fixture.cjs") as {
      seedPlatformFixture(db: typeof prisma, hasher: typeof bcrypt): Promise<unknown>;
    };
    process.stdout.write(JSON.stringify(await seedPlatformFixture(prisma, bcrypt)));
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch(() => {
  process.stderr.write("Falha ao criar conta de QA. Confira o perfil, TEST_DATABASE_URL e as migrações.\n");
  process.exitCode = 1;
});

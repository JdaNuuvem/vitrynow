// Cria (ou redefine a senha de) uma conta da EQUIPE da plataforma (API-25). Nada de credencial no código ou no argumento:
//   PLATFORM_ADMIN_EMAIL=... PLATFORM_ADMIN_PASSWORD=... [PLATFORM_ADMIN_ROLE=ADMIN|SUPPORT] pnpm --filter @meucardapio/api exec tsx scripts/create-platform-admin.ts
// Usa o DATABASE_URL do ambiente. Senha com no mínimo 12 caracteres. Não imprime a senha.
import { prisma } from "@meucardapio/db";
import { bcryptPasswordHasher } from "../src/shared/passwordHasher";

async function main() {
  const email = (process.env.PLATFORM_ADMIN_EMAIL ?? "").trim().toLowerCase();
  const password = process.env.PLATFORM_ADMIN_PASSWORD ?? "";
  const role = process.env.PLATFORM_ADMIN_ROLE === "ADMIN" ? "ADMIN" : "SUPPORT";
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("PLATFORM_ADMIN_EMAIL inválido");
  if (password.length < 12) throw new Error("PLATFORM_ADMIN_PASSWORD precisa ter 12 caracteres ou mais");
  const passwordHash = await bcryptPasswordHasher.hash(password, "script");
  const admin = await prisma.platformAdmin.upsert({
    where: { email },
    create: { email, passwordHash, role },
    update: { passwordHash, role, disabledAt: null, tokenVersion: { increment: 1 } },
  });
  console.log(`conta da plataforma pronta: ${admin.email} (${admin.role})`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

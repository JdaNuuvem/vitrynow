import { randomInt, timingSafeEqual } from "node:crypto";
import { nanoid } from "nanoid";
import { prisma } from "@meucardapio/db";
import type { MfaPurpose } from "@meucardapio/shared-types";
import { mfaHmac } from "./securityConfig";

export const CODE_TTL_MS = 10 * 60 * 1000;
export const PROOF_TTL_MS = 10 * 60 * 1000;
export const MAX_ATTEMPTS = 5;

export type VerifyOutcome = "ok" | "invalid" | "expired" | "locked";

export function hashCode(challengeId: string, code: string): string {
  return mfaHmac(`${challengeId}:${code}`);
}

export function generateCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

export function mfaEnforced(): boolean {
  return process.env.MFA_ENFORCED === "true";
}

export function maskEmail(email: string): string {
  const [name, domain] = email.split("@");
  return `${name.slice(0, 2)}${"*".repeat(Math.max(name.length - 2, 1))}@${domain}`;
}

export async function createChallenge(userId: string, purpose: MfaPurpose, now: Date = new Date()) {
  const id = nanoid(24);
  const code = generateCode();
  const challenge = await prisma.mfaChallenge.create({
    data: { id, userId, purpose, codeHash: hashCode(id, code), expiresAt: new Date(now.getTime() + CODE_TTL_MS) },
  });
  return { challenge, code };
}

export async function verifyChallenge(userId: string, challengeId: string, code: string, now: Date = new Date()): Promise<VerifyOutcome> {
  const challenge = await prisma.mfaChallenge.findFirst({ where: { id: challengeId, userId } });
  if (!challenge || challenge.verifiedAt) return "invalid";
  if (challenge.expiresAt <= now) return "expired";
  if (challenge.attempts >= MAX_ATTEMPTS) return "locked";

  const expected = Buffer.from(challenge.codeHash, "hex");
  const received = Buffer.from(hashCode(challenge.id, code), "hex");
  const matches = expected.length === received.length && timingSafeEqual(expected, received);

  if (!matches) {
    await prisma.mfaChallenge.update({ where: { id: challenge.id }, data: { attempts: { increment: 1 } } });
    return "invalid";
  }
  await prisma.mfaChallenge.update({ where: { id: challenge.id }, data: { verifiedAt: now } });
  return "ok";
}

// Consome (uso único) um comprovante verificado há menos de PROOF_TTL_MS. O updateMany
// condicional garante que duas requisições simultâneas não gastem o mesmo comprovante.
export async function spendProof(userId: string, challengeId: string, purpose: MfaPurpose, now: Date = new Date()): Promise<boolean> {
  const result = await prisma.mfaChallenge.updateMany({
    where: {
      id: challengeId,
      userId,
      purpose,
      spentAt: null,
      verifiedAt: { gte: new Date(now.getTime() - PROOF_TTL_MS) },
    },
    data: { spentAt: now },
  });
  return result.count === 1;
}

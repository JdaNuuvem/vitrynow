-- AlterTable: "consumedAt" vira "verifiedAt" (preserva dados) e ganha "spentAt" para uso único.
ALTER TABLE "MfaChallenge" RENAME COLUMN "consumedAt" TO "verifiedAt";
ALTER TABLE "MfaChallenge" ADD COLUMN "spentAt" TIMESTAMP(3);

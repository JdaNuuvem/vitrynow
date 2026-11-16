import bcrypt from "bcryptjs";

// Porta de hash de senha: os serviços não dependem do bcrypt, só deste contrato.
export interface PasswordHasher {
  hash(plain: string): Promise<string>;
  verify(plain: string, hash: string): Promise<boolean>;
}

const BCRYPT_COST = 10;

export const bcryptPasswordHasher: PasswordHasher = {
  hash: (plain) => bcrypt.hash(plain, BCRYPT_COST),
  verify: (plain, hash) => bcrypt.compare(plain, hash),
};

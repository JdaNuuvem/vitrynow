import bcrypt from "bcrypt";
import { hashLane } from "./hashLane";

// Porta de hash de senha: os serviços não dependem do bcrypt, só deste contrato. O segundo argumento é a CHAVE da origem (`clientKey(ip)`), que a
// faixa usa para que uma origem só nunca ocupe mais que `maxPerKey` vagas (SEC-34, R3).
export interface PasswordHasher {
  hash(plain: string, laneKey: string): Promise<string>;
  verify(plain: string, hash: string, laneKey: string): Promise<boolean>;
}

const BCRYPT_COST = 10;

// ÚNICO lugar da API que chama `bcrypt.hash`/`bcrypt.compare` (um teste de varredura garante): tudo passa pela `hashLane`. O `bcrypt` nativo roda no
// threadpool do libuv e, sem a faixa, 16 logins simultâneos travam a API inteira. Os hashes `$2a$` gravados antes (bcryptjs) continuam verificando.
export const bcryptPasswordHasher: PasswordHasher = {
  hash: (plain, laneKey) => hashLane.run(laneKey, () => bcrypt.hash(plain, BCRYPT_COST)),
  verify: (plain, hash, laneKey) => hashLane.run(laneKey, () => bcrypt.compare(plain, hash)),
};

// Hash de uma senha que ninguém conhece, no MESMO custo dos hashes reais: login com e-mail inexistente gasta o mesmo trabalho e passa pela MESMA
// faixa do login com senha errada (ST-05, sem enumeração de contas por tempo nem pela faixa). Calculado uma vez, na subida (fora do caminho de pedido).
export const DUMMY_HASH = bcrypt.hashSync(`nao-existe-${Math.random()}-${Date.now()}`, BCRYPT_COST);

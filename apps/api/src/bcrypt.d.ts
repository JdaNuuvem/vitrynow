// O `bcrypt` 6.0.0 não traz tipos e o lockfile está travado (SEC-34): só o que a API usa. Quem chama é `shared/passwordHasher.ts`, atrás da faixa.
declare module "bcrypt" {
  export function hash(data: string, saltOrRounds: number): Promise<string>;
  export function hashSync(data: string, saltOrRounds: number): string;
  export function compare(data: string, encrypted: string): Promise<boolean>;
  const bcrypt: { hash: typeof hash; hashSync: typeof hashSync; compare: typeof compare };
  export default bcrypt;
}

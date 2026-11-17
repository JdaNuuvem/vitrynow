// Id de pedido da API: `cuid()` do Prisma ("c" + 24 letras minúsculas e dígitos). Todo id que vem de URL (`?pedido=`) só vira caminho de
// requisição depois de passar por aqui: sem isso, `..%2F..%2Fauth%2Fme` ou `x%3Fcode%3D1` faria o painel pedir qualquer rota do site com a sessão.
const ORDER_ID = /^c[a-z0-9]{24}$/;

export function isOrderId(value: string | null | undefined): value is string {
  return typeof value === "string" && ORDER_ID.test(value);
}

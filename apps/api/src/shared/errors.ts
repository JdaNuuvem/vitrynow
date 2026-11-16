import type { FastifyInstance } from "fastify";

// Erros de regra de negócio. Os serviços lançam estes (sem saber de HTTP); a tradução para
// status + corpo { error } acontece em useDomainErrors, na borda.
export class DomainError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class BadRequestError extends DomainError {
  constructor(message: string) {
    super(400, message);
  }
}

export class UnauthorizedError extends DomainError {
  constructor(message: string) {
    super(401, message);
  }
}

export class NotFoundError extends DomainError {
  constructor(message: string) {
    super(404, message);
  }
}

export class ConflictError extends DomainError {
  constructor(message: string) {
    super(409, message);
  }
}

// Registra no escopo do plugin (encapsulado, não afeta as outras rotas) a resposta padrão
// para DomainError. Qualquer outro erro segue o tratamento padrão do Fastify.
export function useDomainErrors(app: FastifyInstance) {
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof DomainError) {
      return reply.code(error.statusCode).send({ error: error.message });
    }
    return reply.send(error);
  });
}

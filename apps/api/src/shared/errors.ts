import type { FastifyInstance } from "fastify";

// Erros de regra de negócio. Os serviços lançam estes (sem saber de HTTP); a tradução para
// status + corpo { error } acontece em useDomainErrors, na borda.
export class DomainError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
    // Código estável para o front (contrato B3): { error, code, ...extra }.
    readonly code?: string,
    readonly extra?: Record<string, unknown>,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class BadRequestError extends DomainError {
  constructor(message: string, code?: string) {
    super(400, message, code);
  }
}

// Erro com status e código arbitrários do contrato (ex. 409 INVALID_TRANSITION, 403 FORBIDDEN_ROLE).
export class CodedError extends DomainError {
  constructor(statusCode: number, code: string, message: string, extra?: Record<string, unknown>) {
    super(statusCode, message, code, extra);
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
      return reply.code(error.statusCode).send({ error: error.message, ...(error.code ? { code: error.code } : {}), ...error.extra });
    }
    return reply.send(error);
  });
}

export class DmError extends Error {
  constructor(
    public override message: string,
    public statusCode: number = 400,
    public code: string = 'BAD_REQUEST'
  ) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class DmValidationError extends DmError {
  constructor(message: string) {
    super(message, 400, 'BAD_REQUEST');
  }
}

export class DmUnauthorizedError extends DmError {
  constructor(message: string = 'Authentication required') {
    super(message, 401, 'UNAUTHORIZED');
  }
}

export class DmForbiddenError extends DmError {
  constructor(message: string) {
    super(message, 403, 'FORBIDDEN');
  }
}

export class DmNotFoundError extends DmError {
  constructor(message: string) {
    super(message, 404, 'NOT_FOUND');
  }
}

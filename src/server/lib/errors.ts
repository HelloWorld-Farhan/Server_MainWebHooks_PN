export class AppError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode = 400,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "Unauthorized") {
    super(message, "UNAUTHORIZED", 401);
    this.name = "UnauthorizedError";
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "Forbidden") {
    super(message, "FORBIDDEN", 403);
    this.name = "ForbiddenError";
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Not found") {
    super(message, "NOT_FOUND", 404);
    this.name = "NotFoundError";
  }
}

export class ContractNotFoundError extends AppError {
  constructor(message = "Contract ID not found in the database") {
    super(message, "CONTRACT_NOT_FOUND", 404);
    this.name = "ContractNotFoundError";
  }
}

export class ValidationError extends AppError {
  constructor(message = "Invalid input") {
    super(message, "VALIDATION", 400);
    this.name = "ValidationError";
  }
}

export class ConflictError extends AppError {
  constructor(message = "Conflict") {
    super(message, "CONFLICT", 409);
    this.name = "ConflictError";
  }
}

export class InvalidApiKeyError extends AppError {
  constructor(message = "Invalid API key") {
    super(message, "INVALID_API_KEY", 401);
    this.name = "InvalidApiKeyError";
  }
}

export class InvalidApiKeyFormatError extends AppError {
  constructor(message = "Invalid API key format") {
    super(message, "INVALID_API_KEY_FORMAT", 401);
    this.name = "InvalidApiKeyFormatError";
  }
}

export class ApiKeyNotFoundError extends AppError {
  constructor(message = "API key not found") {
    super(message, "API_KEY_NOT_FOUND", 404);
    this.name = "ApiKeyNotFoundError";
  }
}

export class ApiKeyDisabledError extends AppError {
  constructor(message = "API key is disabled") {
    super(message, "API_KEY_DISABLED", 403);
    this.name = "ApiKeyDisabledError";
  }
}

export class ApiKeyExpiredError extends AppError {
  constructor(message = "API key has expired") {
    super(message, "API_KEY_EXPIRED", 403);
    this.name = "ApiKeyExpiredError";
  }
}

export class MissingScopeError extends AppError {
  constructor(scope: string) {
    super(`Missing scope: ${scope}`, "MISSING_SCOPE", 403);
    this.name = "MissingScopeError";
  }
}

export class MissingBranchAccessError extends AppError {
  constructor(message = "Missing branch access") {
    super(message, "MISSING_BRANCH_ACCESS", 403);
    this.name = "MissingBranchAccessError";
  }
}

export class InvalidScopeError extends AppError {
  constructor(scope: string) {
    super(`Invalid scope: ${scope}`, "INVALID_SCOPE", 400);
    this.name = "InvalidScopeError";
  }
}

export class InvalidBranchError extends AppError {
  constructor(message = "Invalid branch") {
    super(message, "INVALID_BRANCH", 400);
    this.name = "InvalidBranchError";
  }
}

export class DuplicateApiKeyNameError extends AppError {
  constructor(message = "An API key with this name already exists") {
    super(message, "DUPLICATE_API_KEY_NAME", 409);
    this.name = "DuplicateApiKeyNameError";
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

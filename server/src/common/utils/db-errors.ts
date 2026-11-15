export interface PgErrorLike {
  code?: string;
  constraint?: string;
  detail?: string;
  message?: string;
}

export function isPgError(error: unknown): error is PgErrorLike {
  return (
    typeof error === 'object' &&
    error !== null &&
    typeof (error as PgErrorLike).code === 'string'
  );
}

/** PostgreSQL unique_violation (SQLSTATE 23505). */
export function isUniqueViolation(error: unknown, constraint?: string): boolean {
  if (!isPgError(error) || error.code !== '23505') return false;
  return constraint ? error.constraint === constraint : true;
}

/** PostgreSQL foreign_key_violation (SQLSTATE 23503). */
export function isForeignKeyViolation(error: unknown): boolean {
  return isPgError(error) && error.code === '23503';
}

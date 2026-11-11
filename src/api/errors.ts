// Consistent JSON errors: {"error": {"code": "...", "message": "..."}}.

export type ApiErrorCode =
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "invalid_request"
  | "insufficient_credits"
  | "rate_limited"
  | "idempotency_conflict"
  | "not_available"
  | "server_error";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ApiErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
    readonly headers: Record<string, string> = {},
  ) {
    super(message);
  }
  toBody() {
    return { error: { code: this.code, message: this.message, ...(this.details ? { details: this.details } : {}) } };
  }
}

export const unauthorized = () => new ApiError(401, "unauthorized", "Missing or invalid API key. Send it as: Authorization: Bearer fl_live_…");
export const notFound = (what = "Not found") => new ApiError(404, "not_found", what);
export const invalid = (message: string, details?: Record<string, unknown>) => new ApiError(400, "invalid_request", message, details);

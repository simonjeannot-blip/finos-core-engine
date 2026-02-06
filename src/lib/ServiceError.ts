/**
 * Zero-Inference Error Handling System
 * 
 * All system failures are classified into three forensic buckets:
 * - HANDSHAKE_ERROR: Connection/API/Network failures
 * - LOGIC_ERROR: Mathematical/Protocol calculation failures
 * - STATUTORY_ERROR: Tax/Compliance threshold breaches
 * 
 * Each error carries a machine-readable code, human-readable message,
 * and retry eligibility for the Steel Thread diagnostic pipeline.
 */

export type ErrorBucket = "HANDSHAKE_ERROR" | "LOGIC_ERROR" | "STATUTORY_ERROR";

export interface ServiceErrorOptions {
  /** Machine-readable error code (e.g., AUTH_KEY_MISSING, VAT_THRESHOLD_BREACH) */
  code: string;
  /** Human-readable description for UI display */
  message: string;
  /** Error classification bucket */
  bucket: ErrorBucket;
  /** HTTP status code if applicable */
  statusCode?: number;
  /** Whether this error is retryable */
  canRetry: boolean;
  /** Original error for stack trace preservation */
  cause?: unknown;
  /** Additional diagnostic metadata */
  metadata?: Record<string, unknown>;
}

export class ServiceError extends Error {
  readonly code: string;
  readonly bucket: ErrorBucket;
  readonly statusCode?: number;
  readonly canRetry: boolean;
  readonly metadata: Record<string, unknown>;
  declare readonly cause?: unknown;

  constructor(options: ServiceErrorOptions) {
    super(options.message);
    this.name = "ServiceError";
    this.code = options.code;
    this.bucket = options.bucket;
    this.statusCode = options.statusCode;
    this.canRetry = options.canRetry;
    this.metadata = options.metadata ?? {};
    
    if (options.cause) {
      this.cause = options.cause;
    }
  }

  /**
   * Format for UI toast display
   */
  toToast(): { title: string; description: string } {
    const statusText = this.statusCode ? ` [HTTP ${this.statusCode}]` : "";
    return {
      title: `${this.bucket}: ${this.code}${statusText}`,
      description: this.message,
    };
  }

  /**
   * Format for console/forensic logging
   */
  toLog(): string {
    return `[${this.bucket}] ${this.code}: ${this.message}${
      this.statusCode ? ` (HTTP ${this.statusCode})` : ""
    }${this.canRetry ? " [RETRYABLE]" : " [TERMINAL]"}`;
  }
}

// ============================================
// HANDSHAKE ERROR FACTORY
// Connection/API/Network failures
// ============================================

export function createHandshakeError(
  code: string,
  message: string,
  options?: Partial<Pick<ServiceErrorOptions, "statusCode" | "canRetry" | "cause" | "metadata">>
): ServiceError {
  return new ServiceError({
    code,
    message,
    bucket: "HANDSHAKE_ERROR",
    canRetry: options?.canRetry ?? true,
    statusCode: options?.statusCode,
    cause: options?.cause,
    metadata: options?.metadata,
  });
}

// ============================================
// LOGIC ERROR FACTORY
// Mathematical/Protocol failures
// ============================================

export function createLogicError(
  code: string,
  message: string,
  options?: Partial<Pick<ServiceErrorOptions, "statusCode" | "canRetry" | "cause" | "metadata">>
): ServiceError {
  return new ServiceError({
    code,
    message,
    bucket: "LOGIC_ERROR",
    canRetry: options?.canRetry ?? false,
    statusCode: options?.statusCode,
    cause: options?.cause,
    metadata: options?.metadata,
  });
}

// ============================================
// STATUTORY ERROR FACTORY
// Tax/Compliance threshold breaches
// ============================================

export function createStatutoryError(
  code: string,
  message: string,
  options?: Partial<Pick<ServiceErrorOptions, "statusCode" | "canRetry" | "cause" | "metadata">>
): ServiceError {
  return new ServiceError({
    code,
    message,
    bucket: "STATUTORY_ERROR",
    canRetry: options?.canRetry ?? false,
    statusCode: options?.statusCode,
    cause: options?.cause,
    metadata: options?.metadata,
  });
}

// ============================================
// ERROR CLASSIFICATION ENGINE
// Parses unknown errors into the correct bucket
// ============================================

export function classifyError(
  error: unknown,
  responseData?: { error?: string; message?: string; status_code?: number; details?: unknown }
): ServiceError {
  // Already a ServiceError - return as-is
  if (error instanceof ServiceError) return error;

  // Structured response from edge function
  if (responseData?.error) {
    const statusCode = responseData.status_code;
    const isRetryable = statusCode === 429 || statusCode === 503 || statusCode === 500;

    // Classify based on error code patterns
    if (responseData.error.includes("VAT") || responseData.error.includes("STATUTORY")) {
      return createStatutoryError(
        responseData.error,
        responseData.message || "Statutory compliance check failed",
        { statusCode, canRetry: false }
      );
    }

    if (responseData.error.includes("MATH") || responseData.error.includes("PROTOCOL") || responseData.error.includes("MALFORMED")) {
      return createLogicError(
        responseData.error,
        responseData.message || "Protocol integrity violation",
        { statusCode, canRetry: false }
      );
    }

    return createHandshakeError(
      responseData.error,
      responseData.message || "Unknown server error",
      { statusCode, canRetry: isRetryable }
    );
  }

  // Native Error parsing
  if (error instanceof Error) {
    const msg = error.message;

    if (msg.includes("Failed to fetch") || msg.includes("NetworkError") || msg.includes("ECONNREFUSED")) {
      return createHandshakeError("NETWORK_FETCH_ERR", "Network connection failed. Check WiFi/cellular signal.", { cause: error });
    }
    if (msg.includes("TIMEOUT") || msg.includes("AbortError")) {
      return createHandshakeError("TIMEOUT_60S", "Server did not respond within 60 seconds.", { cause: error });
    }
    if (msg.includes("IMG_COMPRESS")) {
      return createLogicError("IMG_COMPRESS_ERR", msg, { canRetry: false, cause: error });
    }
    if (msg.includes("storage") || msg.includes("STORAGE")) {
      return createHandshakeError("STORAGE_ERR", msg, { cause: error });
    }
    if (msg.includes("AUTH") || msg.includes("401") || msg.includes("403")) {
      return createHandshakeError("AUTH_ERR", "Authentication failed. Please re-login.", { statusCode: 401, cause: error });
    }
    if (msg.includes("S_NUMBER") || msg.includes("HASH_MISMATCH")) {
      return createLogicError("S_NUMBER_INTEGRITY", "S-Number calculation integrity check failed.", { cause: error });
    }

    return createHandshakeError("UNKNOWN_ERR", msg, { cause: error });
  }

  return createHandshakeError("CRITICAL_ERR", String(error), { canRetry: false });
}

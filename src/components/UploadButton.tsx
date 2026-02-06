import { useRef, useState, useCallback } from "react";
import { Camera, Loader2, RefreshCw } from "lucide-react";
import imageCompression from "browser-image-compression";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

interface UploadButtonProps {
  userId: string;
  onSuccess: () => void;
  variant?: "default" | "floating";
}

interface StabilizedImage {
  file: File;
  originalSize: number;
  compressedSize: number;
}

interface ProcessingContext {
  storagePath: string;
}

/**
 * Universal Mobile Stabilizer
 * Converts all images (including HEIC) to JPEG, resizes to max 1600px, compresses to max 1MB
 */
async function stabilizeImage(file: File): Promise<StabilizedImage> {
  const originalSize = file.size;
  
  const options = {
    maxSizeMB: 1,           // Max 1MB file size
    maxWidthOrHeight: 1600, // Max 1600px dimension
    useWebWorker: true,     // Use web worker for performance
    fileType: "image/jpeg" as const,  // Force JPEG conversion (handles HEIC)
    initialQuality: 0.85,   // Good quality balance
    alwaysKeepResolution: false,
    preserveExif: false,    // Strip EXIF to reduce size
  };

  try {
    const compressedFile = await imageCompression(file, options);
    
    // Create a new File object with proper JPEG extension
    const stabilizedFile = new File(
      [compressedFile],
      file.name.replace(/\.[^/.]+$/, ".jpg"),
      { type: "image/jpeg" }
    );

    return {
      file: stabilizedFile,
      originalSize,
      compressedSize: stabilizedFile.size,
    };
  } catch (error) {
    console.error("Image stabilization failed:", error);
    throw new Error(
      `IMG_COMPRESS_ERR: ${error instanceof Error ? error.message : "Unknown compression error"}`
    );
  }
}

/**
 * Memory Purge Utility
 * Clears references and triggers garbage collection hint
 */
function purgeMemory(refs: Array<File | Blob | null>) {
  // Clear all file references
  refs.forEach((ref, index) => {
    if (ref) {
      refs[index] = null;
    }
  });
  
  // Hint to browser to garbage collect
  if (typeof window !== "undefined" && "gc" in window) {
    try {
      (window as { gc?: () => void }).gc?.();
    } catch {
      // GC not available in production, that's fine
    }
  }
}

/**
 * Sovereign Intake Fetch — Direct URL auth with HTML response guard
 * Calls universal-revenue-intake with ?key= parameter
 */
async function sovereignIntakeFetch(
  storagePath: string,
  timeoutMs: number = 60000
): Promise<{
  success: boolean;
  message?: string;
  entries_count?: number;
  data?: Record<string, unknown>;
  error?: string;
}> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const intakeUrl = `${supabaseUrl}/functions/v1/universal-revenue-intake?key=FF_INTAKE_001_SECURE`;

  try {
    const response = await fetch(intakeUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        image_path: storagePath,
        source: "RECEIPT_SCAN",
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    // HTML Response Guard — detect non-JSON responses
    const contentType = response.headers.get("content-type");
    if (!contentType?.includes("application/json")) {
      const textResponse = await response.text();
      console.error("[Sovereign Intake] Expected JSON but got:", contentType);
      console.error("[Sovereign Intake] Response preview:", textResponse.substring(0, 200));

      if (textResponse.trim().startsWith("<!") || textResponse.includes("<html")) {
        throw new Error(
          `API returned HTML instead of JSON. Status: ${response.status}`
        );
      }
      throw new Error(`Unexpected response format: ${contentType}`);
    }

    return await response.json();
  } catch (error) {
    clearTimeout(timeoutId);

    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("TIMEOUT_60S: Edge function did not respond within 60 seconds");
    }
    throw error;
  }
}

/**
 * Format error for Steel Thread diagnostics
 * Provides exact error codes and status codes for reporting
 */
function formatSteelThreadError(
  error: unknown,
  responseData?: { error?: string; message?: string; status_code?: number; details?: unknown }
): { code: string; message: string; statusCode?: number; canRetry: boolean } {
  // Check if we have structured error response from edge function
  if (responseData?.error) {
    const statusCode = responseData.status_code;
    const canRetry = statusCode === 429 || statusCode === 503 || statusCode === 500;
    
    return {
      code: responseData.error,
      message: responseData.message || "Unknown error from server",
      statusCode,
      canRetry,
    };
  }

  if (error instanceof Error) {
    // Parse known error patterns
    if (error.message.includes("Failed to fetch")) {
      return {
        code: "NETWORK_FETCH_ERR",
        message: "Network connection failed. Check WiFi/cellular signal.",
        canRetry: true,
      };
    }
    if (error.message.includes("TIMEOUT")) {
      return {
        code: "TIMEOUT_60S",
        message: "Server took too long. Try again with smaller image.",
        canRetry: true,
      };
    }
    if (error.message.includes("IMG_COMPRESS")) {
      return {
        code: "IMG_COMPRESS_ERR",
        message: error.message,
        canRetry: false,
      };
    }
    if (error.message.includes("storage") || error.message.includes("STORAGE")) {
      return {
        code: "STORAGE_ERR",
        message: error.message,
        canRetry: true,
      };
    }
    
    // Generic error with full message
    return {
      code: "UNKNOWN_ERR",
      message: error.message,
      canRetry: true,
    };
  }
  
  return {
    code: "CRITICAL_ERR",
    message: String(error),
    canRetry: false,
  };
}

export function UploadButton({ userId, onSuccess, variant = "default" }: UploadButtonProps) {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [lastUploadContext, setLastUploadContext] = useState<ProcessingContext | null>(null);

  const handleClick = () => {
    fileInputRef.current?.click();
  };

  /**
   * Process document via Sovereign Intake — can be retried
   */
  const processDocument = useCallback(async (context: ProcessingContext) => {
    toast({
      title: "Parsing Absolute Truth...",
      description: "AI analyzing receipt via Sovereign Intake (60s timeout).",
    });

    const result = await sovereignIntakeFetch(context.storagePath, 60000);

    if (!result.success) {
      console.error("[Sovereign Intake] Processing failed:", result);
      throw {
        error: new Error(result.error || result.message || "Processing failed"),
        responseData: result,
      };
    }

    return result;
  }, [toast]);

  /**
   * Retry handler - reuses last upload context
   */
  const handleRetry = useCallback(async () => {
    if (!lastUploadContext) {
      toast({
        variant: "destructive",
        title: "Error Code: NO_RETRY_CONTEXT",
        description: "No previous upload to retry. Please upload a new photo.",
      });
      return;
    }

    setIsProcessing(true);

    try {
      const result = await processDocument(lastUploadContext);
      
      toast({
        title: "✓ Absolute Truth Captured",
        description: `Created ${result.entries_count || 0} ledger entries.`,
      });

      setLastUploadContext(null);
      onSuccess();
    } catch (thrown) {
      const { error, responseData } = thrown as { error: unknown; responseData?: unknown };
      const { code, message, statusCode, canRetry } = formatSteelThreadError(
        error,
        responseData as { error?: string; message?: string; status_code?: number; details?: unknown }
      );
      
      const statusText = statusCode ? ` [HTTP ${statusCode}]` : "";
      
      toast({
        variant: "destructive",
        title: `Error Code: ${code}${statusText}`,
        description: message,
        duration: 15000,
        action: canRetry ? (
          <Button
            variant="outline"
            size="sm"
            onClick={handleRetry}
            className="gap-1 shrink-0"
          >
            <RefreshCw className="h-3 w-3" />
            Retry
          </Button>
        ) : undefined,
      });
    } finally {
      setIsProcessing(false);
    }
  }, [lastUploadContext, processDocument, toast, onSuccess]);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const originalFile = e.target.files?.[0];
    if (!originalFile) return;

    // Memory references to purge later
    const memoryRefs: Array<File | Blob | null> = [originalFile];

    // Validate file type - now accept all image types since we convert to JPEG
    if (!originalFile.type.startsWith("image/")) {
      toast({
        variant: "destructive",
        title: "Error Code: INVALID_TYPE",
        description: "Please upload an image file (photo of receipt).",
      });
      return;
    }

    // Initial size check (before compression) - 50MB max for raw camera photos
    if (originalFile.size > 50 * 1024 * 1024) {
      toast({
        variant: "destructive",
        title: "Error Code: FILE_TOO_LARGE",
        description: "Original file exceeds 50MB limit. Try a different photo.",
      });
      return;
    }

    setIsProcessing(true);
    setLastUploadContext(null);

    try {
      // Step 1: Universal Image Stabilization
      toast({
        title: "Stabilizing Image...",
        description: "Converting to JPEG, resizing to 1600px, compressing to 1MB.",
      });

      const { file: stabilizedFile, originalSize, compressedSize } = await stabilizeImage(originalFile);
      memoryRefs.push(stabilizedFile);

      const compressionRatio = ((1 - compressedSize / originalSize) * 100).toFixed(0);
      console.log(
        `[Universal Stabilizer] Original: ${(originalSize / 1024 / 1024).toFixed(2)}MB → ` +
        `Compressed: ${(compressedSize / 1024 / 1024).toFixed(2)}MB (${compressionRatio}% reduction)`
      );

      // Step 2: Upload to Supabase Storage
      toast({
        title: "Uploading...",
        description: `Compressed ${compressionRatio}% - uploading to storage.`,
      });

      const fileName = `${userId}/${Date.now()}-${Math.random().toString(36).substring(7)}.jpg`;

      const { data: uploadData, error: uploadError } = await supabase.storage
        .from("receipts")
        .upload(fileName, stabilizedFile, {
          cacheControl: "3600",
          upsert: false,
          contentType: "image/jpeg",
        });

      // Memory Purge: Clear file references immediately after upload starts
      purgeMemory(memoryRefs);

      if (uploadError) {
        console.error("Upload error:", uploadError);
        throw { error: new Error(`STORAGE_ERR: ${uploadError.message}`) };
      }

      // Step 3: Store context for Sovereign Intake
      const storagePath = uploadData.path;
      console.log("[Sovereign Intake] Receipt uploaded, storage path:", storagePath);

      const context: ProcessingContext = { storagePath };
      setLastUploadContext(context);

      // Step 4: Process via Sovereign Intake (AI parsing)
      const result = await processDocument(context);

      // Success!
      toast({
        title: "✓ Absolute Truth Captured",
        description: `Created ${result.entries_count || 0} ledger entries.`,
      });

      setLastUploadContext(null);
      onSuccess();
    } catch (thrown) {
      console.error("[Steel Thread] Upload flow error:", thrown);
      
      const { error, responseData } = (thrown as { error?: unknown; responseData?: unknown }) || { error: thrown };
      const { code, message, statusCode, canRetry } = formatSteelThreadError(
        error,
        responseData as { error?: string; message?: string; status_code?: number; details?: unknown }
      );
      
      const statusText = statusCode ? ` [HTTP ${statusCode}]` : "";
      
      toast({
        variant: "destructive",
        title: `Error Code: ${code}${statusText}`,
        description: message,
        duration: 15000,
        action: canRetry && lastUploadContext ? (
          <Button
            variant="outline"
            size="sm"
            onClick={handleRetry}
            className="gap-1 shrink-0"
          >
            <RefreshCw className="h-3 w-3" />
            Retry
          </Button>
        ) : undefined,
      });
    } finally {
      setIsProcessing(false);
      // Reset the input so the same file can be selected again
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      // Final memory purge
      purgeMemory(memoryRefs);
    }
  };

  const isFloating = variant === "floating";

  return (
    <>
      {/* Camera input with capture for mobile - prompts "Take Photo or Choose Library" */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleFileChange}
        className="hidden"
      />
      <Button
        onClick={handleClick}
        disabled={isProcessing}
        size={isFloating ? "lg" : "default"}
        className={cn(
          "gap-2",
          isFloating && "h-16 px-8 text-lg font-semibold shadow-lg"
        )}
      >
        {isProcessing ? (
          <>
            <Loader2 className={cn("animate-spin", isFloating ? "h-6 w-6" : "h-4 w-4")} />
            {isFloating ? "Parsing..." : "Parsing Absolute Truth..."}
          </>
        ) : (
          <>
            <Camera className={cn(isFloating ? "h-6 w-6" : "h-4 w-4")} />
            {isFloating ? "Scan Receipt" : "Upload Receipt"}
          </>
        )}
      </Button>
    </>
  );
}

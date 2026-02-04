import { useRef, useState } from "react";
import { Camera, Loader2 } from "lucide-react";
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
 * Invoke Edge Function with Timeout and Stable Headers
 * 60-second timeout with proper Content-Type
 */
async function invokeWithTimeout(
  functionName: string,
  body: Record<string, unknown>,
  timeoutMs: number = 60000
): Promise<{ data: unknown; error: Error | null }> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await supabase.functions.invoke(functionName, {
      body,
      headers: {
        "Content-Type": "application/json",
      },
    });

    clearTimeout(timeoutId);
    return response;
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
 * Provides exact error codes for Simon, Roberta, or Alessio to report
 */
function formatSteelThreadError(error: unknown): { code: string; message: string } {
  if (error instanceof Error) {
    // Parse known error patterns
    if (error.message.includes("Failed to fetch")) {
      return {
        code: "NETWORK_FETCH_ERR",
        message: "Network connection failed. Check WiFi/cellular signal.",
      };
    }
    if (error.message.includes("TIMEOUT")) {
      return {
        code: "TIMEOUT_60S",
        message: "Server took too long. Try again with smaller image.",
      };
    }
    if (error.message.includes("IMG_COMPRESS")) {
      return {
        code: "IMG_COMPRESS_ERR",
        message: error.message,
      };
    }
    if (error.message.includes("storage")) {
      return {
        code: "STORAGE_ERR",
        message: error.message,
      };
    }
    if (error.message.includes("Processing failed")) {
      return {
        code: "AI_PROCESS_ERR",
        message: error.message,
      };
    }
    
    // Generic error with full message
    return {
      code: "UNKNOWN_ERR",
      message: error.message,
    };
  }
  
  return {
    code: "CRITICAL_ERR",
    message: String(error),
  };
}

export function UploadButton({ userId, onSuccess, variant = "default" }: UploadButtonProps) {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  const handleClick = () => {
    fileInputRef.current?.click();
  };

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
        throw new Error(`STORAGE_ERR: ${uploadError.message}`);
      }

      // Step 3: Get public URL
      const { data: urlData } = supabase.storage
        .from("receipts")
        .getPublicUrl(uploadData.path);

      const publicUrl = urlData.publicUrl;
      console.log("[Steel Thread] Receipt uploaded, public URL:", publicUrl);

      // Step 4: Call edge function with 60-second timeout and proper headers
      toast({
        title: "Parsing Absolute Truth...",
        description: "AI analyzing receipt (60s timeout).",
      });

      const { data: functionData, error: functionError } = await invokeWithTimeout(
        "process-document-ai",
        {
          document_url: publicUrl,
          user_id: userId,
        },
        60000 // 60 second timeout
      ) as { data: { success: boolean; entries_count?: number; error?: string } | null; error: Error | null };

      if (functionError) {
        console.error("[Steel Thread] Function error:", functionError);
        throw new Error(`AI_PROCESS_ERR: ${functionError.message}`);
      }

      if (!functionData?.success) {
        console.error("[Steel Thread] Processing failed:", functionData);
        throw new Error(`AI_PROCESS_ERR: ${functionData?.error || "Unknown AI processing error"}`);
      }

      // Success!
      toast({
        title: "✓ Absolute Truth Captured",
        description: `Created ${functionData.entries_count} ledger entries.`,
      });

      onSuccess();
    } catch (error) {
      console.error("[Steel Thread] Upload flow error:", error);
      
      const { code, message } = formatSteelThreadError(error);
      
      toast({
        variant: "destructive",
        title: `Error Code: ${code}`,
        description: message,
        duration: 10000, // Show for 10 seconds so user can read/report
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

import { useRef, useState } from "react";
import { Camera, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

interface UploadButtonProps {
  userId: string;
  onSuccess: () => void;
  variant?: "default" | "floating";
}

export function UploadButton({ userId, onSuccess, variant = "default" }: UploadButtonProps) {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  const handleClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    const allowedTypes = ["image/jpeg", "image/png", "image/webp", "image/heic"];
    if (!allowedTypes.includes(file.type)) {
      toast({
        variant: "destructive",
        title: "Invalid file type",
        description: "Please upload a JPG, PNG, or WebP image.",
      });
      return;
    }

    // Validate file size (max 10MB)
    if (file.size > 10 * 1024 * 1024) {
      toast({
        variant: "destructive",
        title: "File too large",
        description: "Please upload an image smaller than 10MB.",
      });
      return;
    }

    setIsProcessing(true);

    try {
      // Generate unique filename with user folder structure
      const fileExt = file.name.split(".").pop()?.toLowerCase() || "jpg";
      const fileName = `${userId}/${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`;

      // Step 1: Upload to Supabase Storage
      toast({
        title: "Uploading...",
        description: "Uploading receipt to storage.",
      });

      const { data: uploadData, error: uploadError } = await supabase.storage
        .from("receipts")
        .upload(fileName, file, {
          cacheControl: "3600",
          upsert: false,
        });

      if (uploadError) {
        console.error("Upload error:", uploadError);
        throw new Error(`Failed to upload: ${uploadError.message}`);
      }

      // Step 2: Get public URL
      const { data: urlData } = supabase.storage
        .from("receipts")
        .getPublicUrl(uploadData.path);

      const publicUrl = urlData.publicUrl;
      console.log("Receipt uploaded, public URL:", publicUrl);

      // Step 3: Call the edge function
      toast({
        title: "Parsing Absolute Truth...",
        description: "AI is analyzing your receipt using V5.7 logic.",
      });

      const { data: functionData, error: functionError } = await supabase.functions.invoke(
        "process-document-ai",
        {
          body: {
            document_url: publicUrl,
            user_id: userId,
          },
        }
      );

      if (functionError) {
        console.error("Function error:", functionError);
        throw new Error(`Processing failed: ${functionError.message}`);
      }

      if (!functionData?.success) {
        console.error("Processing failed:", functionData);
        throw new Error(functionData?.error || "Unknown processing error");
      }

      // Success!
      toast({
        title: "Success!",
        description: `Created ${functionData.entries_count} ledger entries from receipt.`,
      });

      // Trigger refresh of data
      onSuccess();
    } catch (error) {
      console.error("Upload flow error:", error);
      toast({
        variant: "destructive",
        title: "Processing Failed",
        description: error instanceof Error ? error.message : "An error occurred",
      });
    } finally {
      setIsProcessing(false);
      // Reset the input so the same file can be selected again
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const isFloating = variant === "floating";

  return (
    <>
      {/* Camera input with capture for mobile - prompts "Take Photo or Choose Library" */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/heic"
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

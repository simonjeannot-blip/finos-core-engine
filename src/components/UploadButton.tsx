import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

export function UploadButton() {
  const { toast } = useToast();

  const handleClick = () => {
    toast({
      title: "Coming Soon",
      description:
        "Receipt scanning via Edge Function will be available in the next phase.",
    });
  };

  return (
    <Button onClick={handleClick} className="gap-2">
      <Upload className="h-4 w-4" />
      Upload Receipt
    </Button>
  );
}

import { 
  Instagram, 
  Youtube, 
  Facebook, 
  Twitter, 
  Music2, 
  Send, 
  Linkedin, 
  Music, 
  Share2,
  Globe
} from "lucide-react";
import { cn } from "@/lib/utils";

interface CategoryIconProps {
  category: string;
  iconUrl?: string;
  className?: string;
}

export default function CategoryIcon({ category, iconUrl, className }: CategoryIconProps) {
  if (iconUrl && iconUrl.trim() !== "") {
    return (
      <img 
        src={iconUrl} 
        alt={category} 
        className={cn("object-contain", className)} 
        referrerPolicy="no-referrer"
      />
    );
  }

  const cat = category?.toLowerCase() || "";
  
  if (cat.includes("instagram")) return <Instagram className={cn("text-pink-600", className)} />;
  if (cat.includes("youtube")) return <Youtube className={cn("text-red-600", className)} />;
  if (cat.includes("facebook")) return <Facebook className={cn("text-blue-600", className)} />;
  if (cat.includes("twitter") || cat.includes(" x ")) return <Twitter className={cn("text-sky-500", className)} />;
  if (cat.includes("tiktok")) return <Music2 className={cn("text-black", className)} />;
  if (cat.includes("telegram")) return <Send className={cn("text-blue-400", className)} />;
  if (cat.includes("linkedin")) return <Linkedin className={cn("text-blue-700", className)} />;
  if (cat.includes("spotify") || cat.includes("music")) return <Music className={cn("text-green-500", className)} />;
  
  return <Share2 className={cn("text-primary", className)} />;
}

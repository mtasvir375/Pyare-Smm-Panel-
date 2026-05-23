import { Link, useLocation } from "react-router-dom";
import { Home, BookOpen, PlayCircle, User } from "lucide-react";
import { cn } from "@/lib/utils";

export default function Navbar() {
  const location = useLocation();

  const navItems = [
    { icon: BookOpen, label: "New Order", path: "/courses" },
    { icon: PlayCircle, label: "Orders", path: "/dashboard" },
    { icon: User, label: "Profile", path: "/profile" },
  ];

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 bg-white border-t border-gray-200 pb-safe md:top-0 md:bottom-auto md:border-t-0 md:border-b">
      <div className="max-w-md mx-auto px-6 h-16 flex items-center justify-between md:max-w-7xl">
        <div className="hidden md:flex items-center gap-2 font-bold text-xl text-primary mr-8">
          <PlayCircle className="w-6 h-6" />
          <span>SMM Panel Pro</span>
        </div>
        
        <div className="flex flex-1 justify-around md:justify-start md:gap-8">
          {navItems.map((item) => {
            const isActive = location.pathname === item.path || (item.path === "/courses" && location.pathname === "/");
            const Icon = item.icon;
            
            return (
              <Link
                key={item.path}
                to={item.path}
                className={cn(
                  "flex flex-col items-center gap-1 transition-colors md:flex-row md:gap-2",
                  isActive ? "text-primary" : "text-gray-500 hover:text-gray-900"
                )}
              >
                <Icon className={cn("w-6 h-6", isActive && "fill-primary/10")} />
                <span className="text-[10px] font-medium md:text-sm">{item.label}</span>
              </Link>
            );
          })}
        </div>
      </div>
    </nav>
  );
}

import { Link, useLocation } from "react-router-dom";
import { Home, BookOpen, PlayCircle, User, LogIn } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/context/AuthContext";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";

export default function Navbar() {
  const location = useLocation();
  const { user, userProfile: profile } = useAuth() as any;

  const navItems = [
    { icon: BookOpen, label: "New Order", path: "/courses" },
    { icon: PlayCircle, label: "Orders", path: "/dashboard" },
    { icon: User, label: "Profile", path: "/profile" },
  ];

  const displayName = profile?.displayName || user?.displayName || user?.email?.split("@")[0] || "User";
  const photoURL = user?.photoURL || "";

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 bg-card border-t border-border pb-safe md:top-0 md:bottom-auto md:border-t-0 md:border-b transition-colors duration-500 shadow-md md:shadow-none">
      <div className="max-w-md mx-auto px-6 h-16 flex items-center justify-between md:max-w-7xl">
        <Link to="/" className="hidden md:flex items-center gap-2 font-bold text-xl text-primary mr-8">
          <img src="/favicon.png" alt="Pyare SMM" className="w-8 h-8 rounded-lg" />
          <span>Pyare SMM Panel</span>
        </Link>
        
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

        <div className="hidden md:flex items-center gap-4">
          {user ? (
            <Link to="/profile" className="flex items-center gap-3 bg-gray-50 hover:bg-gray-100 px-3 py-1.5 rounded-full transition-colors">
              <div className="text-right">
                <p className="text-xs font-bold text-gray-900 leading-tight">{displayName}</p>
                <p className="text-[10px] text-gray-400 font-medium leading-tight">₹{Number(profile?.balance || 0).toFixed(2)}</p>
              </div>
              <Avatar className="w-8 h-8 border border-white shadow-sm">
                <AvatarImage src={photoURL} />
                <AvatarFallback className="bg-primary/10 text-primary text-[10px] font-bold">
                  {displayName.charAt(0)}
                </AvatarFallback>
              </Avatar>
            </Link>
          ) : (
            <Link to="/login">
              <Button size="sm" className="rounded-full px-5 font-bold gap-2">
                <LogIn className="w-4 h-4" />
                Login
              </Button>
            </Link>
          )}
        </div>
      </div>
    </nav>
  );
}

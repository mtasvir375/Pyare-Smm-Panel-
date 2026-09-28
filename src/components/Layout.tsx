import { useEffect } from "react";
import { Outlet, Link, useLocation, Navigate } from "react-router-dom";
import Navbar from "./Navbar";
import { Toaster } from "sonner";
import WhatsAppButton from "./WhatsAppButton";
import { useAuth } from "@/context/AuthContext";

export default function Layout() {
  const location = useLocation();
  const { user, userProfile, loading } = useAuth() as any;

  useEffect(() => {
    const applyTheme = async () => {
      try {
        const { getCachedSettings } = await import("@/lib/cache");
        const settings = await getCachedSettings();
        if (settings && settings.selectedTheme) {
          document.documentElement.setAttribute("data-theme", settings.selectedTheme);
        } else {
          document.documentElement.setAttribute("data-theme", "charcoal");
        }
      } catch (err) {
        console.error("Failed to load layout theme:", err);
      }
    };
    applyTheme();
  }, [location.pathname]);

  // While checking auth status, render a modern loading animation
  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-6 text-center">
        <div className="animate-spin rounded-full h-10 w-10 border-4 border-primary border-t-transparent shadow-md"></div>
        <p className="mt-4 text-sm font-bold text-gray-500 tracking-wide animate-pulse">
          Verifying secure node session...
        </p>
      </div>
    );
  }

  // Allow unrestricted access ONLY to /login and SEO Landing Pages (/p/:slug)
  const isPublicPath = 
    location.pathname === "/login" || 
    location.pathname.startsWith("/p/");

  // If unauthenticated and trying to access any protected route, redirect to login page immediately
  if (!user && !isPublicPath) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return (
    <div className="min-h-screen bg-background text-foreground transition-colors duration-500 pb-20 md:pb-0 md:pt-16 flex flex-col justify-between">
      <div>
        {userProfile?.isFallback && (
          <div className="bg-red-600 text-white text-xs font-bold py-2.5 px-4 text-center sticky top-0 z-50 flex items-center justify-center gap-2 animate-pulse shadow-sm">
            <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <span>कनेक्शन त्रुटि: ऑफ़लाइन डेटा दिखाया जा रहा है। कृपया पेज रीफ्रेश करें। (Connection Issue: Displaying offline data. Please refresh the page.)</span>
          </div>
        )}
        <Navbar />
        <main className="w-full max-w-7xl mx-auto px-4 py-6">
          <Outlet />
        </main>
      </div>

      <footer id="global-smm-footer" className="w-full bg-card border-t border-border py-6 px-4 mt-12 text-center text-xs text-gray-400 transition-colors duration-500">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
          <span>© 2026 Pyare SMM Panel. All rights reserved. Wholesale Direct SMM Provider Node.</span>
          <div className="flex flex-wrap items-center justify-center gap-3 md:gap-5 font-semibold text-gray-500">
            <Link to="/courses" className="hover:text-gray-950 transition">Place Order</Link>
            <span className="text-gray-300">|</span>
            <Link to="/dashboard" className="hover:text-gray-950 transition">My Dashboard</Link>
          </div>
        </div>
      </footer>

      <WhatsAppButton />
      <Toaster position="top-center" />
    </div>
  );
}

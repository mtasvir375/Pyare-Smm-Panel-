import { useEffect, useState } from "react";
import { Outlet, Link, useLocation, Navigate } from "react-router-dom";
import Navbar from "./Navbar";
import { Toaster, toast } from "sonner";
import WhatsAppButton from "./WhatsAppButton";
import { useAuth } from "@/context/AuthContext";

export default function Layout() {
  const location = useLocation();
  const { user, userProfile, loading } = useAuth() as any;

  // Mobile-Only Mode state: check local cache first for instant response
  const [mobileOnlyMode, setMobileOnlyMode] = useState<boolean>(() => {
    try {
      return localStorage.getItem("cached_mobile_only") === "true";
    } catch (e) {
      return false;
    }
  });

  // Track if current visitor is on desktop/laptop or desktop site mode
  const [isDesktopDevice, setIsDesktopDevice] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    const ua = navigator.userAgent || "";
    const isMobileUA = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile|mobile|CriOS/i.test(ua);
    return !isMobileUA || window.innerWidth > 820;
  });

  useEffect(() => {
    const checkDevice = () => {
      if (typeof window === "undefined") return;
      const ua = navigator.userAgent || "";
      const isMobileUA = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile|mobile|CriOS/i.test(ua);
      // Desktop is true if User-Agent is desktop OR screen viewport is wide (laptops / Desktop site mode)
      const isDesktop = !isMobileUA || window.innerWidth > 820;
      setIsDesktopDevice(isDesktop);
    };

    checkDevice();
    window.addEventListener("resize", checkDevice);

    // 1. Immediately apply cached theme from localStorage to avoid delay or flashing
    try {
      const cached = localStorage.getItem("cached_settings");
      if (cached) {
        const parsed = JSON.parse(cached);
        if (parsed && parsed.selectedTheme) {
          document.documentElement.setAttribute("data-theme", parsed.selectedTheme);
        }
        if (parsed && parsed.mobileOnlyMode !== undefined) {
          setMobileOnlyMode(!!parsed.mobileOnlyMode);
        }
      }
      const directTheme = localStorage.getItem("cached_theme");
      if (directTheme) {
        document.documentElement.setAttribute("data-theme", directTheme);
      }
      const directMobileOnly = localStorage.getItem("cached_mobile_only");
      if (directMobileOnly !== null) {
        setMobileOnlyMode(directMobileOnly === "true");
      }
    } catch (e) {}

    // 2. Fetch latest authoritative settings from backend
    const applyTheme = async () => {
      try {
        const { getCachedSettings } = await import("@/lib/cache");
        const settings = await getCachedSettings();
        if (settings && settings.selectedTheme) {
          document.documentElement.setAttribute("data-theme", settings.selectedTheme);
          localStorage.setItem("cached_theme", settings.selectedTheme);
        } else {
          const directTheme = localStorage.getItem("cached_theme");
          if (directTheme) {
            document.documentElement.setAttribute("data-theme", directTheme);
          } else {
            document.documentElement.setAttribute("data-theme", "amber");
          }
        }

        if (settings && settings.mobileOnlyMode !== undefined) {
          const isMobOnly = !!settings.mobileOnlyMode;
          setMobileOnlyMode(isMobOnly);
          try {
            localStorage.setItem("cached_mobile_only", isMobOnly ? "true" : "false");
          } catch (e) {}
        }
      } catch (err) {
        console.error("Failed to load layout theme:", err);
      }
    };
    applyTheme();

    // 3. Listen for dynamic theme & mobile-only changes from Admin panel
    const handleThemeChange = (e: any) => {
      const newTheme = e.detail || "amber";
      document.documentElement.setAttribute("data-theme", newTheme);
      try {
        localStorage.setItem("cached_theme", newTheme);
      } catch (err) {}
    };

    const handleMobileOnlyChange = (e: any) => {
      const isMob = !!e.detail;
      setMobileOnlyMode(isMob);
      try {
        localStorage.setItem("cached_mobile_only", isMob ? "true" : "false");
      } catch (err) {}
    };

    window.addEventListener("themeChange", handleThemeChange);
    window.addEventListener("mobileOnlyChange", handleMobileOnlyChange);
    return () => {
      window.removeEventListener("resize", checkDevice);
      window.removeEventListener("themeChange", handleThemeChange);
      window.removeEventListener("mobileOnlyChange", handleMobileOnlyChange);
    };
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

  // If user is blocked by admin
  if (userProfile && (userProfile.isBlocked || userProfile.blocked) && userProfile.email !== "mtasvir375@gmail.com") {
    return (
      <div className="min-h-screen bg-gray-950 text-white flex flex-col items-center justify-center p-6 text-center">
        <div className="max-w-md w-full bg-gray-900 border border-red-500/30 p-8 rounded-3xl shadow-2xl space-y-4">
          <div className="w-16 h-16 bg-red-500/10 text-red-500 rounded-full flex items-center justify-center mx-auto text-2xl font-bold">
            🚫
          </div>
          <h1 className="text-xl font-bold text-white">Access Restricted</h1>
          <p className="text-base text-red-400 font-semibold leading-relaxed">
            admin has blocked you for inappropriate activity.
          </p>
          <button
            onClick={async () => {
              try {
                const { auth } = await import("@/lib/firebase");
                await auth.signOut();
              } catch (e) {}
              window.location.href = "/login";
            }}
            className="w-full py-3 bg-red-600 hover:bg-red-700 text-white font-bold rounded-xl transition shadow-md text-sm mt-4"
          >
            Sign Out / Login Again
          </button>
        </div>
      </div>
    );
  }

  // Check if Mobile-Only Mode blocks this desktop session
  const isUserAdmin = 
    userProfile?.email === "mtasvir375@gmail.com" || 
    user?.email === "mtasvir375@gmail.com" || 
    userProfile?.role === "admin";

  const isBlockedByMobileOnly = 
    mobileOnlyMode && 
    isDesktopDevice && 
    location.pathname !== "/admin";

  if (isBlockedByMobileOnly) {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex flex-col items-center justify-center p-6 text-center selection:bg-indigo-500 selection:text-white">
        <div className="max-w-md w-full bg-slate-900/95 backdrop-blur-2xl border border-indigo-500/30 p-8 rounded-3xl shadow-2xl shadow-indigo-500/10 space-y-6">
          <div className="relative mx-auto w-20 h-20">
            <div className="absolute inset-0 bg-indigo-500/20 rounded-3xl blur-xl animate-pulse"></div>
            <div className="relative w-20 h-20 bg-gradient-to-br from-indigo-600 to-purple-600 rounded-3xl flex items-center justify-center shadow-lg border border-white/20 text-4xl">
              📱
            </div>
          </div>

          <div className="space-y-2">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-indigo-500/10 border border-indigo-500/30 text-indigo-400 rounded-full text-xs font-bold tracking-wide uppercase">
              🛡️ Security Policy: Mobile Devices Only
            </span>
            <h1 className="text-2xl font-black text-white tracking-tight">
              Access Restricted to Mobile Devices
            </h1>
            <p className="text-sm font-semibold text-indigo-300">
              यह वेबसाइट केवल स्मार्टफोन और मोबाइल में उपलब्ध है।
            </p>
          </div>

          <p className="text-xs text-slate-400 leading-relaxed bg-slate-800/60 p-4 rounded-2xl border border-slate-700/60 text-left">
            सुरक्षा नीति के अनुसार, Pyare SMM Panel पर <b>लैपटॉप, कंप्यूटर या डेस्कटॉप</b> से एक्सेस बंद कर दिया गया है। सेवाओं का उपयोग करने, ऑर्डर लगाने और बैलेंस जोड़ने के लिए कृपया अपने <b>स्मार्टफ़ोन के ब्राउज़र</b> (Chrome, Safari, etc.) में वेबसाइट खोलें।
          </p>

          <div className="bg-slate-800/80 p-4 rounded-2xl border border-indigo-500/20 space-y-3">
            <p className="text-[11px] font-bold text-slate-300 uppercase tracking-wider">
              Scan with your phone camera to open:
            </p>
            <div className="bg-white p-2.5 rounded-xl inline-block shadow-md">
              <img
                src={`https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent("https://pyaresmmpanel.online")}`}
                alt="Scan to open on smartphone"
                className="w-32 h-32 rounded-lg mx-auto"
              />
            </div>
            <div className="flex items-center justify-center gap-2 pt-1">
              <code className="text-xs font-mono font-bold text-indigo-400 bg-slate-900/80 px-3 py-1.5 rounded-lg border border-slate-700">
                pyaresmmpanel.online
              </code>
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard.writeText("https://pyaresmmpanel.online");
                  toast.success("Website URL copied! Open in your mobile browser.");
                }}
                className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold transition shadow-xs"
              >
                Copy Link
              </button>
            </div>
          </div>

          {isUserAdmin ? (
            <div className="pt-3 border-t border-slate-800 space-y-2">
              <div className="bg-amber-500/10 border border-amber-500/30 p-2.5 rounded-xl text-xs text-amber-300 flex items-center justify-between">
                <span className="font-semibold">👑 Admin Access</span>
                <Link to="/admin" className="px-3 py-1 bg-amber-500 hover:bg-amber-400 text-slate-950 font-black rounded-lg text-xs transition">
                  Go to Admin Panel →
                </Link>
              </div>
            </div>
          ) : (
            <div className="pt-2 border-t border-slate-800 flex items-center justify-between text-xs text-slate-500">
              <span>Admin / Site Owner?</span>
              <Link to="/login" className="text-indigo-400 hover:text-indigo-300 font-bold hover:underline">
                Admin Login →
              </Link>
            </div>
          )}
        </div>
      </div>
    );
  }

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

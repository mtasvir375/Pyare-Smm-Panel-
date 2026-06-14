import { Outlet, Link } from "react-router-dom";
import Navbar from "./Navbar";
import { Toaster } from "sonner";
import WhatsAppButton from "./WhatsAppButton";

export default function Layout() {
  return (
    <div className="min-h-screen bg-gray-50 pb-20 md:pb-0 md:pt-16 flex flex-col justify-between">
      <div>
        <Navbar />
        <main className="w-full max-w-7xl mx-auto px-4 py-6">
          <Outlet />
        </main>
      </div>

      <footer id="global-smm-footer" className="w-full bg-white border-t border-gray-200 py-6 px-4 mt-12 text-center text-xs text-gray-400">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
          <span>© 2026 Pyare SMM Panel. All rights reserved. Wholesale Direct SMM Provider Node.</span>
          <div className="flex flex-wrap items-center justify-center gap-3 md:gap-5 font-semibold text-gray-500">
            <Link to="/courses" className="hover:text-gray-950 transition">Place Order</Link>
            <span className="text-gray-300">|</span>
            <Link to="/seo-services" className="hover:text-indigo-600 font-bold text-indigo-500 transition">
              Browse Sitemap (50+ SEO Landing Pages)
            </Link>
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

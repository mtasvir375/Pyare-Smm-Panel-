import { Outlet } from "react-router-dom";
import Navbar from "./Navbar";
import { Toaster } from "sonner";
import WhatsAppButton from "./WhatsAppButton";

export default function Layout() {
  return (
    <div className="min-h-screen bg-gray-50 pb-20 md:pb-0 md:pt-16 flex flex-col">
      <Navbar />
      <main className="w-full max-w-7xl mx-auto px-4 py-6 flex-grow">
        <Outlet />
      </main>
      <WhatsAppButton />
      <Toaster position="top-center" />
    </div>
  );
}

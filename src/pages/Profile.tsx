import { motion } from "motion/react";
import { 
  User, 
  Settings, 
  Shield, 
  LogOut, 
  ChevronRight,
  LayoutDashboard,
  PlusCircle,
  Wallet,
  QrCode,
  Upload,
  History,
  Copy,
  Check,
  Gift,
  RefreshCw
} from "lucide-react";

import axios from "axios";

const WhatsAppIcon = ({ className }: { className?: string }) => (
  <svg 
    viewBox="0 0 24 24" 
    className={className}
    fill="currentColor"
  >
    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
  </svg>
);
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle, 
  DialogDescription,
  DialogFooter
} from "@/components/ui/dialog";
import { useAuth } from "@/context/AuthContext";
import { logout, db, handleFirestoreError, OperationType } from "@/lib/firebase";
import { collection, addDoc, serverTimestamp, doc, getDoc, query, where, getDocs, updateDoc, increment, limit, runTransaction } from "firebase/firestore";
import { useNavigate, Link } from "react-router-dom";
import { toast } from "sonner";
import { useState, useEffect } from "react";
import imageCompression from "browser-image-compression";
import { QRCodeSVG } from "qrcode.react";

// Helper to pull youtube video ID
const getYoutubeEmbedUrl = (url: string) => {
  if (!url) return '';
  try {
    // Handle youtu.be, youtube.com/watch, m.youtube.com/watch, youtube.com/shorts, etc.
    const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=|shorts\/)([^#\&\?]*).*/;
    const match = url.match(regExp);

    if (match && match[2].length === 11) {
      return `https://www.youtube.com/embed/${match[2]}`;
    }
    
    // Fallback simple replacements if regex fails for some reason
    if (url.includes('watch?v=')) {
      return url.replace('m.youtube.com', 'www.youtube.com').replace('watch?v=', 'embed/');
    }
  } catch (e) {
    console.error("Error parsing youtube URL", e);
  }
  return url;
};

export default function Profile() {
  const { user, profile, isAdmin, isPaymentAdmin } = useAuth();
  const navigate = useNavigate();
  const [isAddFundsOpen, setIsAddFundsOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [utr, setUtr] = useState("");
  const [screenshot, setScreenshot] = useState<File | null>(null);
  const [screenshotPreview, setScreenshotPreview] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isRazorpayLoading, setIsRazorpayLoading] = useState(false);
  const [paymentSettings, setPaymentSettings] = useState<{
    upiId: string;
    merchantName: string;
    paymentQrUrl: string;
    whatsappLink?: string;
    guideVideoUrl?: string;
    razorpayEnabled?: boolean;
    razorpayKeyId?: string;
  } | null>(null);

  useEffect(() => {
    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.async = true;
    document.body.appendChild(script);
    return () => {
      if (document.body.contains(script)) {
        document.body.removeChild(script);
      }
    };
  }, []);

  const handleRazorpayPayment = async () => {
    if (!amount || Number(amount) < 1) {
      toast.error("Minimum amount is ₹1");
      return;
    }

    setIsRazorpayLoading(true);
    try {
      const response = await axios.post("/api/razorpay/create-order", {
        amount: Number(amount),
        userId: user?.uid,
      });

      const { order } = response.data;
      
      const options = {
        key: paymentSettings?.razorpayKeyId,
        amount: order.amount,
        currency: "INR",
        name: paymentSettings?.merchantName || "SMM Panel",
        description: "Wallet Refill",
        order_id: order.id,
        handler: async (response: any) => {
          const verifyRes = await axios.post("/api/razorpay/verify", {
            ...response,
            amount: Number(amount),
            userId: user?.uid,
            userEmail: user?.email,
          });

          if (verifyRes.data.success) {
            toast.success("Payment Received! Balance updated.");
            setIsAddFundsOpen(false);
            setAmount("");
          }
        },
        prefill: {
          email: user?.email,
        },
        theme: {
          color: "#000000",
        },
      };

      const rzp = new (window as any).Razorpay(options);
      rzp.open();
    } catch (error: any) {
      toast.error("Payment failed to initialize");
    } finally {
      setIsRazorpayLoading(false);
    }
  };

  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const { getCachedSettings } = await import("@/lib/cache");
        const settingsData = await getCachedSettings();
        if (settingsData) {
          setPaymentSettings(settingsData);
        }
      } catch (error) {
        console.error("Error fetching settings:", error);
      }
    };
    fetchSettings();
  }, []);

  const handleLogout = async () => {
    try {
      await logout();
      toast.success("Logged out successfully");
      navigate("/login");
    } catch (error) {
      toast.error("Failed to logout");
    }
  };

  const handleImageChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      try {
        const options = {
          maxSizeMB: 0.05,
          maxWidthOrHeight: 600,
          useWebWorker: true
        };
        const compressedFile = await imageCompression(file, options);
        setScreenshot(compressedFile);
        const reader = new FileReader();
        reader.onloadend = () => setScreenshotPreview(reader.result as string);
        reader.readAsDataURL(compressedFile);
      } catch (error) {
        toast.error("Failed to compress image");
      }
    }
  };

  const resetAddFunds = () => {
    setIsAddFundsOpen(false);
    setAmount("");
    setUtr("");
    setScreenshot(null);
    setScreenshotPreview(null);
  };

  const handleAddFunds = async () => {
    if (!amount || !user) {
      toast.error("Please enter an amount");
      return;
    }

    if (!utr || utr.replace(/\D/g, "").length < 12) {
      toast.error("Please provide a valid 12-digit UTR number");
      return;
    }

    if (!screenshotPreview) {
      toast.error("Please upload a payment screenshot");
      return;
    }

    setIsUploading(true);
    try {
      const numAmount = Number(amount);
      const cleanUtr = utr.replace(/\D/g, ""); // Keep only digits

      if (cleanUtr.length !== 12) {
        toast.error("UTR must be exactly 12 digits.");
        setIsUploading(false);
        return;
      }

      // 1. Submit via Secure API (includes transactional duplicate check)
      const response = await axios.post("/api/deposits/submit-manual", {
        amount: numAmount,
        utr: cleanUtr,
        screenshotUrl: screenshotPreview,
        userId: user.uid,
        userEmail: user.email
      });

      if (response.data.success) {
        if (response.data.isAutoApproved) {
          toast.success("🎉 Payment verified automatically! ₹" + numAmount + " has been added to your wallet.");
        } else {
          toast.success("Fund request submitted! Admin will verify it soon.");
        }
        resetAddFunds();
      } else {
        toast.error(response.data.error || "Submission failed.");
      }

    } catch (error: any) {
      console.error("Server payment submission failed, trying client-side fallback...", error);
      
      // OPTION 2: Client-side Direct Write Fallback (Bypasses Server IAM issues)
      // Enforce One UTR = One Request via Transaction
      try {
        const cleanUtr = utr.replace(/\D/g, "");
        if (cleanUtr.length !== 12) throw new Error("Invalid UTR format");

        await runTransaction(db, async (transaction) => {
          const lockRef = doc(db, "utr_locks", cleanUtr);
          const lockSnap = await transaction.get(lockRef);
          
          if (lockSnap.exists()) {
            throw new Error("This UTR has already been submitted.");
          }

          transaction.set(lockRef, {
            userId: user.uid,
            createdAt: serverTimestamp(),
            amount: Number(amount)
          });

          const depositRef = doc(collection(db, "deposits"));
          transaction.set(depositRef, {
            userId: user.uid,
            userEmail: user.email || "not-provided",
            amount: Number(amount),
            utr: cleanUtr,
            screenshotUrl: screenshotPreview,
            status: "pending",
            createdAt: serverTimestamp(),
            source: "client-transaction-fallback"
          });
        });

        toast.success("Request submitted successfully!");
        resetAddFunds();
      } catch (clientError: any) {
        console.error("Client fallback failed:", clientError);
        let msg = "Submission failed.";
        if (clientError.message?.includes("already been submitted")) {
          msg = "This UTR number has already been used for a payment request.";
        } else if (clientError.code === "permission-denied" || clientError.message?.includes("permissions")) {
          msg = "Permission Denied: Please contact admin to check database settings.";
        } else {
          msg = clientError.message || "An unexpected error occurred.";
        }
        toast.error(msg);
      }
    } finally {
      setIsUploading(false);
    }
  };

  const upiLink = paymentSettings?.upiId 
    ? `upi://pay?pa=${paymentSettings.upiId}&pn=${encodeURIComponent(paymentSettings.merchantName || "SMM Panel")}&am=${amount}&cu=INR`
    : "";

  const menuItems = [
    { 
      icon: Wallet, 
      label: "Add Funds", 
      color: "text-blue-600", 
      onClick: () => setIsAddFundsOpen(true),
      value: `₹${Number(profile?.balance || 0).toFixed(2)}`
    },
    { 
      icon: WhatsAppIcon, 
      label: "Follow For Offer", 
      color: "text-green-500", 
      onClick: () => {
        if (paymentSettings?.whatsappLink) {
          window.open(paymentSettings.whatsappLink, "_blank");
        } else {
          toast.info("WhatsApp channel link not set by admin.");
        }
      } 
    },
    { icon: Shield, label: "Privacy & Security", color: "text-purple-500" },
  ];

  if (!user) {
    return (
      <div className="w-full max-w-xl mx-auto py-20 text-center space-y-4">
        <div className="p-4 bg-gray-100 rounded-full w-20 h-20 mx-auto flex items-center justify-center">
          <User className="w-10 h-10 text-gray-400" />
        </div>
        <h2 className="text-xl font-bold">Not Logged In</h2>
        <p className="text-gray-500">Log in to manage your profile and orders.</p>
        <Button onClick={() => navigate("/login")} className="rounded-full px-8">
          Go to Login
        </Button>
      </div>
    );
  }

  return (
    <div className="w-full max-w-xl mx-auto space-y-3">
      <div className="flex items-center gap-4 bg-white p-4 rounded-3xl shadow-sm border border-gray-50">
        <div className="relative shrink-0">
          <Avatar className="w-16 h-16 border-2 border-white shadow-md">
            <AvatarImage src={user.photoURL || ""} />
            <AvatarFallback>{user.displayName?.charAt(0) || "U"}</AvatarFallback>
          </Avatar>
          <Button size="icon" variant="secondary" className="absolute -bottom-1 -right-1 rounded-full w-6 h-6 shadow-sm">
            <PlusCircle className="w-3 h-3" />
          </Button>
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold truncate">{user.displayName || "User"}</h1>
          <p className="text-sm text-gray-500 truncate">{user.email}</p>
          <div className="mt-1 flex items-center gap-2">
            <span className="text-[10px] font-bold uppercase tracking-widest bg-primary/10 text-primary px-2 py-0.5 rounded-full">
              {profile?.role || "student"}
            </span>
            <button className="text-[10px] font-bold text-blue-600 hover:underline">Edit Profile</button>
          </div>
        </div>
      </div>

      {paymentSettings?.guideVideoUrl && (
        <Card className="border-none shadow-sm bg-white overflow-hidden rounded-3xl">
          <CardContent className="p-0">
            <div className="aspect-video w-full">
              <iframe
                className="w-full h-full"
                src={getYoutubeEmbedUrl(paymentSettings.guideVideoUrl)}
                title="Guide Video"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
              ></iframe>
            </div>
            <div className="p-3 bg-gray-50/50">
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest text-center">
                Guide: How to add funds & place order
              </p>
            </div>
          </CardContent>
        </Card>
      )}



      <div className="pt-0">
        <Dialog open={isAddFundsOpen} onOpenChange={setIsAddFundsOpen}>
        <DialogContent className="max-w-[90vw] sm:max-w-md rounded-3xl p-4 sm:p-6 overflow-y-auto max-h-[90vh]">
          <DialogHeader className="pb-2">
            <DialogTitle className="text-lg sm:text-xl font-bold">Add Funds to Wallet</DialogTitle>
            <DialogDescription className="text-xs font-medium text-gray-500">
              Enter amount, scan QR, provide 12-digit UTR <b>AND</b> upload screenshot.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2">
            <div className="space-y-1">
              <label className="text-xs font-bold text-gray-700">1. Enter Amount (₹)</label>
              <Input 
                type="number" 
                placeholder="e.g. 500" 
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="rounded-xl h-9 text-base font-bold"
              />
            </div>

            {paymentSettings?.razorpayEnabled && amount && Number(amount) > 0 && (
              <div className="space-y-2 pt-2 animate-in fade-in slide-in-from-top-2">
                <div className="relative flex items-center py-2">
                  <div className="flex-grow border-t border-gray-100"></div>
                  <span className="flex-shrink mx-4 text-[10px] font-bold text-gray-400 uppercase tracking-widest">Automatic Payment</span>
                  <div className="flex-grow border-t border-gray-100"></div>
                </div>
                <Button 
                  onClick={handleRazorpayPayment}
                  disabled={isRazorpayLoading}
                  className="w-full h-12 rounded-2xl bg-[#3395FF] hover:bg-[#2085ee] text-white font-bold flex items-center justify-center gap-2"
                >
                  {isRazorpayLoading ? (
                    <RefreshCw className="w-5 h-5 animate-spin" />
                  ) : (
                    <>
                      <Wallet className="w-5 h-5" />
                      Pay with Razorpay (Instant)
                    </>
                  )}
                </Button>
                <div className="relative flex items-center py-2">
                  <div className="flex-grow border-t border-gray-100"></div>
                  <span className="flex-shrink mx-4 text-[10px] font-bold text-gray-400 uppercase tracking-widest">OR Manual QR</span>
                  <div className="flex-grow border-t border-gray-100"></div>
                </div>
              </div>
            )}

            {amount && Number(amount) > 0 && paymentSettings?.upiId && (
              <div className="space-y-2 animate-in fade-in slide-in-from-top-2">
                <div className="flex flex-col items-center gap-1.5 p-3 bg-primary/5 rounded-2xl border-2 border-primary/10">
                  <div className="bg-white p-1.5 rounded-xl shadow-sm">
                    <QRCodeSVG 
                      value={upiLink} 
                      size={120}
                      level="H"
                      includeMargin={true}
                    />
                  </div>
                  <div className="text-center">
                    <p className="text-xs font-bold text-primary">{paymentSettings.merchantName}</p>
                    <p className="text-[9px] text-gray-500 font-medium">{paymentSettings.upiId}</p>
                  </div>
                  <Button 
                    variant="outline" 
                    size="sm" 
                    className="rounded-full h-6 text-[9px] font-bold px-3"
                    onClick={() => {
                      navigator.clipboard.writeText(paymentSettings.upiId);
                      toast.success("UPI ID copied!");
                    }}
                  >
                    <Copy className="w-3 h-3 mr-1" />
                    Copy UPI ID
                  </Button>
                </div>

                <div className="space-y-2">
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-gray-700">2. Transaction ID / UTR (Mandatory)</label>
                    <Input 
                      placeholder="Enter 12-digit UTR number" 
                      value={utr}
                      onChange={(e) => setUtr(e.target.value.replace(/\D/g, ''))}
                      className="rounded-xl h-9 text-sm"
                      inputMode="numeric"
                    />
                  </div>

                  <div className="relative">
                    <div className="absolute inset-0 flex items-center">
                      <span className="w-full border-t" />
                    </div>
                    <div className="relative flex justify-center text-[10px] uppercase">
                      <span className="bg-white px-2 text-gray-500 font-bold">AND MANDATORY SCREENSHOT</span>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleImageChange}
                      className="hidden"
                      id="screenshot-upload"
                    />
                    <label
                      htmlFor="screenshot-upload"
                      className="flex flex-col items-center justify-center gap-1 p-3 border-2 border-dashed border-primary/20 bg-primary/5 rounded-2xl cursor-pointer hover:bg-primary/10 transition-colors"
                    >
                      {screenshotPreview ? (
                        <div className="relative w-full">
                          <img src={screenshotPreview} alt="Preview" className="w-full h-24 object-contain rounded-lg shadow-sm" />
                          <div className="absolute top-0 right-0 bg-green-500 text-white p-1 rounded-full shadow-md">
                            <Check className="w-2 h-2" />
                          </div>
                        </div>
                      ) : (
                        <>
                          <Upload className="w-5 h-5 text-primary/60" />
                          <span className="text-[10px] text-primary/60 font-medium">Upload Payment Screenshot</span>
                        </>
                      )}
                    </label>
                  </div>
                </div>
              </div>
            )}

            {!paymentSettings?.upiId && (
              <div className="p-4 bg-orange-50 text-orange-700 rounded-2xl text-xs border border-orange-100">
                Payment system is currently being set up by admin. Please try again later.
              </div>
            )}
          </div>

          <DialogFooter>
            <Button 
              className="w-full h-12 rounded-xl text-lg font-bold" 
              onClick={handleAddFunds}
              disabled={isUploading || !amount || Number(amount) <= 0}
            >
              {isUploading ? "Verifying..." : "Confirm Payment"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      </div>

      {(isAdmin || isPaymentAdmin || user?.email === "mtasvir375@gmail.com") && (
        <div className="space-y-2">
          <h2 className="text-sm font-bold text-gray-400 uppercase tracking-widest px-2">Admin Tools</h2>
          <Link to="/admin" className="block w-full">
            <Button 
              variant="ghost" 
              className="w-full justify-between h-14 rounded-2xl bg-white shadow-sm border-none px-4"
            >
              <div className="flex items-center gap-3">
                <div className="p-2 bg-indigo-100 rounded-xl">
                  <LayoutDashboard className="w-5 h-5 text-indigo-600" />
                </div>
                <span className="font-semibold">Admin Dashboard</span>
              </div>
              <ChevronRight className="w-5 h-5 text-gray-400" />
            </Button>
          </Link>
        </div>
      )}

      <div className="space-y-2">
        <h2 className="text-sm font-bold text-gray-400 uppercase tracking-widest px-2">Settings</h2>
        <div className="bg-white rounded-3xl shadow-sm overflow-hidden">
          {menuItems.map((item, index) => (
            <button
              key={item.label}
              onClick={item.onClick}
              className={`w-full flex items-center justify-between p-4 hover:bg-gray-50 transition-colors ${
                index !== menuItems.length - 1 ? "border-b border-gray-100" : ""
              }`}
            >
              <div className="flex items-center gap-3">
                <item.icon className={`w-6 h-6 ${item.color}`} />
                <span className="text-base font-semibold">{item.label}</span>
              </div>
              <div className="flex items-center gap-2">
                {item.value && <span className="text-base font-bold text-primary">{item.value}</span>}
                <ChevronRight className="w-6 h-6 text-gray-400" />
              </div>
            </button>
          ))}
        </div>
      </div>

      <Button 
        variant="ghost" 
        className="w-full text-red-500 hover:text-red-600 hover:bg-red-50 rounded-2xl h-14"
        onClick={handleLogout}
      >
        <LogOut className="w-5 h-5 mr-2" />
        Log Out
      </Button>
    </div>
  );
}


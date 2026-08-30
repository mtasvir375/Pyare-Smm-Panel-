import { where } from "firebase/firestore";
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
  Key,
  Check,
  Gift,
  RefreshCw,
  Zap,
  AlertCircle
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
import { dbClient } from "@/lib/dbClient";
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
  const { user, userProfile: profile, loading: authLoading, isAdmin, isPaymentAdmin, signOut, updateUserProfileLocal } = useAuth() as any;
  const navigate = useNavigate();
  const [isAddFundsOpen, setIsAddFundsOpen] = useState(false);
  const [paymentStep, setPaymentStep] = useState<"amount" | "payment">("amount");
  const [amount, setAmount] = useState("");
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [generatingApiKey, setGeneratingApiKey] = useState(false);

  useEffect(() => {
    if (user) {
      dbClient.getDocs("api_keys", [where("userId", "==", user.uid)]).then(docs => {
        if (docs && docs.length > 0) {
          setApiKey(docs[0].id);
        }
      }).catch(console.warn);
    }
  }, [user]);

  const generateApiKey = async () => {
    if (!user) return;
    setGeneratingApiKey(true);
    try {
      if (apiKey) {
        await dbClient.deleteDoc("api_keys", apiKey).catch(() => {});
      }
      const newKey = "ak_" + Math.random().toString(36).substring(2) + Date.now().toString(36);
      await dbClient.saveDoc("api_keys", newKey, { userId: user.uid, createdAt: new Date().toISOString() });
      setApiKey(newKey);
      toast.success("New API Key generated successfully!");
    } catch (e: any) {
      toast.error(e.message || "Failed to generate API Key");
    } finally {
      setGeneratingApiKey(false);
    }
  };
  const [utr, setUtr] = useState("");
  const [screenshot, setScreenshot] = useState<File | null>(null);
  const [screenshotPreview, setScreenshotPreview] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isRazorpayLoading, setIsRazorpayLoading] = useState(false);
  const [isPhonePeLoading, setIsPhonePeLoading] = useState(false);
  const [isPaytmLoading, setIsPaytmLoading] = useState(false);
  const [qrAutoData, setQrAutoData] = useState<{ payment_url?: string; client_txn_id?: string } | null>(null);
  const [isQrAutoLoading, setIsQrAutoLoading] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<"auto" | "manual" | null>(null);
  const [paymentSettings, setPaymentSettings] = useState<{
    upiId: string;
    merchantName: string;
    paymentQrUrl: string;
    whatsappLink?: string;
    guideVideoUrl?: string;
    razorpayEnabled?: boolean;
    razorpayKeyId?: string;
    phonepeEnabled?: boolean;
    paytmEnabled?: boolean;
    qrAutoEnabled?: boolean;
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

  const handlePhonePePayment = async () => {
    if (!amount || Number(amount) < 1) {
      toast.error("Minimum amount is ₹1");
      return;
    }

    setIsPhonePeLoading(true);
    try {
      const response = await axios.post("/api/phonepe/create-order", {
        amount: Number(amount),
        userId: user?.uid,
        userEmail: user?.email,
      });

      if (response.data.success && response.data.redirectUrl) {
        toast.loading("Redirecting to PhonePe Gateway...");
        window.location.href = response.data.redirectUrl;
      } else {
        throw new Error(response.data.error || "Failed to initiate payment");
      }
    } catch (error: any) {
      console.error("[PHONEPE-CLIENT-ERROR]", error);
      toast.error(error.response?.data?.error || error.message || "Failed to initiate PhonePe payment");
    } finally {
      setIsPhonePeLoading(false);
    }
  };

  const handlePaytmPayment = async () => {
    if (!amount || Number(amount) < 1) {
      toast.error("Minimum amount is ₹1");
      return;
    }

    setIsPaytmLoading(true);
    try {
      const response = await axios.post("/api/paytm/create-order", {
        amount: Number(amount),
        userId: user?.uid,
        userEmail: user?.email,
      });

      if (response.data.success && response.data.txnToken) {
        toast.loading("Redirecting to Paytm Gateway...");
        const form = document.createElement("form");
        form.method = "POST";
        form.action = response.data.checkoutPageUrl;
        form.name = "paytmForm";

        const midInput = document.createElement("input");
        midInput.type = "hidden";
        midInput.name = "mid";
        midInput.value = response.data.mid;
        form.appendChild(midInput);

        const orderIdInput = document.createElement("input");
        orderIdInput.type = "hidden";
        orderIdInput.name = "orderId";
        orderIdInput.value = response.data.orderId;
        form.appendChild(orderIdInput);

        const txnTokenInput = document.createElement("input");
        txnTokenInput.type = "hidden";
        txnTokenInput.name = "txnToken";
        txnTokenInput.value = response.data.txnToken;
        form.appendChild(txnTokenInput);

        document.body.appendChild(form);
        form.submit();
      } else {
        throw new Error(response.data.error || "Failed to initiate payment");
      }
    } catch (error: any) {
      console.error("[PAYTM-CLIENT-ERROR]", error);
      toast.error(error.response?.data?.error || error.message || "Failed to initiate Paytm payment");
    } finally {
      setIsPaytmLoading(false);
    }
  };

  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const { getCachedSettings } = await import("@/lib/cache");
        const settingsData = await getCachedSettings();
        if (settingsData) {
          setPaymentSettings(settingsData);
          const hasAuto = !!(settingsData.razorpayEnabled || settingsData.phonepeEnabled || settingsData.paytmEnabled || settingsData.qrAutoEnabled);
          setPaymentMethod(hasAuto ? "auto" : "manual");
        }
      } catch (error) {
        console.error("Error fetching settings:", error);
      }
    };
    fetchSettings();
  }, []);

  useEffect(() => {
    if (isAddFundsOpen) {
      import("@/lib/cache").then(mod => mod.getCachedSettings(true)).then(settings => {
        if (settings) {
          setPaymentSettings(settings);
          const hasAuto = !!(settings.razorpayEnabled || settings.phonepeEnabled || settings.paytmEnabled || settings.qrAutoEnabled);
          setPaymentMethod(hasAuto ? "auto" : "manual");
        }
      }).catch(console.error);
    }
  }, [isAddFundsOpen]);

  const handleLogout = async () => {
    try {
      console.log("[LOGOUT] Attempting sign out...");
      await signOut();
      toast.success("Logged out successfully");
      navigate("/login", { replace: true });
    } catch (error: any) {
      console.error("[LOGOUT] Error during sign out:", error);
      toast.error(`Failed to logout: ${error.message || 'Unknown error'}`);
      // Hard fallback if soft navigate fails
      if (error.message?.includes("navigate")) {
        window.location.href = "/login";
      }
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
    setPaymentStep("amount");
    setAmount("");
    setUtr("");
    setScreenshot(null);
    setScreenshotPreview(null);
    setQrAutoData(null);
  };

  const handleAmountSubmit = async () => {
    if (!amount || Number(amount) < 1) {
      toast.error("Minimum amount is ₹1");
      return;
    }

    if (paymentMethod === "manual" && paymentSettings?.qrAutoEnabled) {
      setIsQrAutoLoading(true);
      try {
        const res = await axios.post("/api/deposits/create-qr-auto-order", {
          userId: user.uid,
          amount: Number(amount),
          userEmail: user.email
        });
        if (res.data.success && res.data.payment_url) {
          setQrAutoData({ 
            payment_url: res.data.payment_url, 
            client_txn_id: res.data.client_txn_id 
          });
          toast.success("Payment Gateway Initialized!");
        }
        setPaymentStep("payment");
      } catch (err: any) {
        console.error("Auto pre-order failed:", err);
        const errMsg = err.response?.data?.error || err.message || "Connection failed";
        toast.error(`Payment Initialization Error: ${errMsg}`);
        // If it fails, we still let them proceed to payment step with fallback to manual
        setPaymentStep("payment");
      } finally {
        setIsQrAutoLoading(false);
      }
    } else {
      setPaymentStep("payment");
    }
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

    // Screenshot is optional for Auto verification but mandatory for manual fallback
    const isAutoMode = !!paymentSettings?.qrAutoEnabled;
    
    if (!isAutoMode && !screenshotPreview) {
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

      if (isAutoMode) {
        // 1. Try Automatic Verification first if enabled
        try {
          const response = await axios.post("/api/deposits/verify-qr-auto", {
            amount: numAmount,
            utr: cleanUtr,
            userId: user?.uid
          });

          if (response.data.success) {
            toast.success("🎉 Payment verified automatically! ₹" + numAmount + " added to wallet.");
            resetAddFunds();
            // Refresh profile balance locally if possible
            if (updateUserProfileLocal) {
              updateUserProfileLocal({ balance: response.data.newBalance });
            }
            return;
          }
        } catch (autoError: any) {
          console.warn("[AUTO-VERIFY-FAILED] Falling back to manual submission", autoError);
          const errorMsg = autoError.response?.data?.error || "";
          
          if (errorMsg.includes("already been used")) {
            toast.error(errorMsg);
            setIsUploading(false);
            return;
          }

          // If auto verify failed because it's not found, we can proceed to manual submission
          // to let admin handle it, but only if they uploaded a screenshot.
          if (!screenshotPreview) {
            toast.error("Auto-verification failed: " + (errorMsg || "Payment not found.") + " Please upload a screenshot for manual review.");
            setIsUploading(false);
            return;
          }
          toast.info("Auto-verification failed. Submitting for manual review...");
        }
      }

      // 2. Standard Manual Submission (or fallback from failed auto)
      const response = await axios.post("/api/deposits/submit-manual", {
        amount: numAmount,
        utr: cleanUtr,
        screenshotUrl: screenshotPreview,
        userId: user?.uid,
        userEmail: user?.email
      });

      if (response.data.success) {
        toast.success("Fund request submitted! Admin will verify it soon.");
        resetAddFunds();
      } else {
        toast.error(response.data.error || "Submission failed.");
      }

    } catch (error: any) {
      console.error("Server payment submission failed, trying client-side fallback...", error);
      
      // OPTION 2: Client-side Direct Write Fallback
      try {
        const cleanUtr = utr.replace(/\D/g, "");
        const depositId = "dep_" + Date.now() + "_" + Math.random().toString(36).substring(2, 7);
        await dbClient.submitManualDeposit(depositId, {
          userId: user.uid,
          userEmail: user.email,
          amount: Number(amount),
          utr: cleanUtr,
          screenshotUrl: screenshotPreview || ""
        });

        toast.success("Request submitted successfully!");
        resetAddFunds();
      } catch (clientError: any) {
        toast.error(clientError.message || "An unexpected error occurred.");
      }
    } finally {
      setIsUploading(false);
    }
  };

  const upiLink = qrAutoData?.payment_url || (paymentSettings?.upiId 
    ? `upi://pay?pa=${paymentSettings.upiId}&pn=${encodeURIComponent(paymentSettings.merchantName || "SMM Panel")}&am=${amount}&cu=INR&tr=TXN_${user?.uid}_${Date.now()}`
    : "");

  const isQrAuto = !!paymentSettings?.qrAutoEnabled;

  const menuItems = [
    { 
      icon: Wallet, 
      label: "Add Funds", 
      color: "text-blue-600", 
      onClick: async () => {
        setIsAddFundsOpen(true);
        try {
          const { getCachedSettings } = await import("@/lib/cache");
          const settingsData = await getCachedSettings(true); // Force-refresh settings on open
          if (settingsData) {
            setPaymentSettings(settingsData);
            const hasAuto = !!(settingsData.razorpayEnabled || settingsData.phonepeEnabled || settingsData.paytmEnabled || settingsData.qrAutoEnabled);
            setPaymentMethod(hasAuto ? "auto" : "manual");
          }
        } catch (error) {
          console.error("Error force refreshing settings on open:", error);
        }
      },
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

  if (authLoading) {
    return (
      <div className="w-full max-w-xl mx-auto py-20 flex flex-col items-center justify-center space-y-4">
        <RefreshCw className="w-10 h-10 text-primary animate-spin" />
        <p className="text-gray-500 font-medium">Loading profile...</p>
      </div>
    );
  }

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

  const displayName = profile?.displayName || user.displayName || user.email?.split("@")[0] || "User";
  const photoURL = user.photoURL || "";

  return (
    <div className="w-full max-w-xl mx-auto space-y-3">
      <div className="flex items-center gap-4 bg-white p-4 rounded-3xl shadow-sm border border-gray-50">
        <div className="relative shrink-0">
          <Avatar className="w-16 h-16 border-2 border-white shadow-md">
            <AvatarImage src={photoURL} />
            <AvatarFallback>{displayName.charAt(0)}</AvatarFallback>
          </Avatar>
          <Button size="icon" variant="secondary" className="absolute -bottom-1 -right-1 rounded-full w-6 h-6 shadow-sm">
            <PlusCircle className="w-3 h-3" />
          </Button>
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold truncate">{displayName}</h1>
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
        <Dialog open={isAddFundsOpen} onOpenChange={(open) => {
          setIsAddFundsOpen(open);
          if (!open) resetAddFunds();
        }}>
        <DialogContent className="max-w-[90vw] sm:max-w-md rounded-3xl p-4 sm:p-6 overflow-y-auto max-h-[90vh]">
          <DialogHeader className="pb-2">
            <DialogTitle className="text-lg sm:text-xl font-bold">
              {paymentStep === "amount" ? "Add Funds to Wallet" : (paymentSettings?.qrAutoEnabled && paymentMethod === "manual" ? "Instant QR Verification" : "Complete Payment")}
            </DialogTitle>
            <DialogDescription className="text-xs font-medium text-gray-500">
              {paymentStep === "amount" 
                ? "Enter the amount you want to add to your wallet." 
                : (paymentSettings?.qrAutoEnabled && paymentMethod === "manual" 
                    ? "Scan, Pay & Enter 12-digit UTR for instant credit."
                    : "Scan the QR code to pay ₹" + amount + " and submit details.")}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {paymentStep === "amount" ? (
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-gray-700 uppercase tracking-wider">Enter Amount (₹)</label>
                  <div className="relative">
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 font-bold text-gray-400">₹</span>
                    <Input 
                      type="number" 
                      placeholder="e.g. 500" 
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      className="rounded-2xl h-14 pl-8 text-xl font-bold border-gray-100 focus:border-primary transition-all"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-4 gap-2">
                  {[100, 200, 500, 1000].map((val) => (
                    <button
                      key={val}
                      onClick={() => setAmount(val.toString())}
                      className="py-2.5 rounded-xl border border-gray-100 text-xs font-bold hover:bg-primary/5 hover:border-primary/20 transition-all"
                    >
                      +₹{val}
                    </button>
                  ))}
                </div>

                <Button 
                  className="w-full h-14 rounded-2xl text-lg font-bold shadow-lg shadow-primary/20"
                  disabled={!amount || Number(amount) < 1 || isQrAutoLoading}
                  onClick={handleAmountSubmit}
                >
                  {isQrAutoLoading ? <RefreshCw className="w-5 h-5 animate-spin mr-2" /> : null}
                  {isQrAutoLoading ? "Initializing..." : "Pay Now"}
                  {!isQrAutoLoading && <ChevronRight className="w-5 h-5 ml-2" />}
                </Button>
              </div>
            ) : (
              <div className="space-y-4 animate-in fade-in slide-in-from-right-4 duration-300">
                {(() => {
                  const hasAutoGateways = !!(paymentSettings?.razorpayEnabled || paymentSettings?.phonepeEnabled || paymentSettings?.paytmEnabled);
                  const qrAutoEnabled = !!paymentSettings?.qrAutoEnabled;
                  
                  return (
                    <div className="space-y-4">
                      {(hasAutoGateways || qrAutoEnabled) && (
                        <div className="space-y-3">
                          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest text-center">Payment Methods</p>
                          <div className="flex flex-col gap-2">
                            {qrAutoEnabled && (
                              <Button 
                                onClick={() => setPaymentMethod("manual")}
                                className="w-full h-16 rounded-2xl bg-green-600 hover:bg-green-700 text-white font-bold flex items-center justify-between px-6 shadow-lg shadow-green-100 group transition-all"
                              >
                                <div className="flex items-center gap-4">
                                  <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center">
                                    <QrCode className="w-6 h-6" />
                                  </div>
                                  <div className="text-left">
                                    <p className="text-sm">Pay via QR</p>
                                    <p className="text-[10px] opacity-80 font-medium">Instant Auto-Verify</p>
                                  </div>
                                </div>
                                <Zap className="w-5 h-5 fill-white animate-pulse" />
                              </Button>
                            )}
                            {paymentSettings?.razorpayEnabled && (
                              <Button 
                                onClick={handleRazorpayPayment}
                                disabled={isRazorpayLoading}
                                className="w-full h-12 rounded-xl bg-[#3395FF] hover:bg-[#2085ee] text-white font-bold flex items-center justify-center gap-2"
                              >
                                {isRazorpayLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : "Pay with Razorpay"}
                              </Button>
                            )}
                            {paymentSettings?.phonepeEnabled && (
                              <Button 
                                onClick={handlePhonePePayment}
                                disabled={isPhonePeLoading}
                                className="w-full h-12 rounded-xl bg-[#5f259f] hover:bg-[#4d1d82] text-white font-bold flex items-center justify-center gap-2"
                              >
                                {isPhonePeLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : "Pay with PhonePe"}
                              </Button>
                            )}
                          </div>
                          
                          <div className="relative flex items-center py-2">
                            <div className="flex-grow border-t border-gray-100"></div>
                            <span className="flex-shrink mx-4 text-[10px] font-bold text-gray-300 uppercase">OR PAY VIA UPI QR</span>
                            <div className="flex-grow border-t border-gray-100"></div>
                          </div>
                        </div>
                      )}

                      {paymentSettings?.upiId && (
                        <div className="space-y-4">
                          {paymentSettings?.qrAutoEnabled && (
                            <div className="flex flex-col items-center gap-2 p-3 bg-green-50 rounded-2xl border-2 border-green-100 mb-0 animate-in zoom-in duration-300">
                              <div className="flex items-center gap-2 text-green-700">
                                <Zap className="w-4 h-4 fill-green-500 text-green-500 animate-pulse" />
                                <span className="text-xs font-bold uppercase tracking-tight">Automatic Verification Active</span>
                              </div>
                              <p className="text-[9px] text-green-600 font-medium text-center">Our system will verify your UTR instantly!</p>
                            </div>
                          )}
                          
                          <div className="flex flex-col items-center gap-2 p-4 bg-primary/5 rounded-3xl border-2 border-primary/10 relative overflow-hidden">
                            <div className="absolute top-0 right-0 p-2 opacity-5">
                              <QrCode className="w-20 h-20" />
                            </div>
                            
                            <div className="bg-white p-2 rounded-2xl shadow-sm relative z-10 min-h-[140px] flex items-center justify-center">
                              {isQrAutoLoading ? (
                                <div className="flex flex-col items-center justify-center w-[120px] h-[120px]">
                                  <RefreshCw className="w-8 h-8 animate-spin text-primary mb-2" />
                                  <p className="text-[10px] font-bold text-gray-400">Securing...</p>
                                </div>
                              ) : (
                                <QRCodeSVG 
                                  value={upiLink} 
                                  size={150}
                                  level="H"
                                  includeMargin={true}
                                />
                              )}
                            </div>
                            
                            <div className="text-center relative z-10">
                              <p className="text-sm font-bold text-primary">
                                {isQrAuto && qrAutoData?.payment_url ? "Auto-Verify QR" : paymentSettings.merchantName}
                              </p>
                              <div className="flex items-center justify-center gap-2 mt-1">
                                <code className="text-[10px] bg-white px-2 py-0.5 rounded-full border border-gray-100 font-mono text-gray-500">
                                  {isQrAuto && qrAutoData?.payment_url ? "Dynamic Gateway" : paymentSettings.upiId}
                                </code>
                                {!isQrAuto && (
                                  <button 
                                    onClick={() => {
                                      navigator.clipboard.writeText(paymentSettings.upiId);
                                      toast.success("UPI ID copied!");
                                    }}
                                    className="text-primary hover:scale-110 transition-transform"
                                  >
                                    <Copy className="w-3 h-3" />
                                  </button>
                                )}
                              </div>
                            </div>
                          </div>

                          <div className="space-y-3">
                            <div className="space-y-1.5">
                              <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider ml-1">Step 1: Enter 12-Digit UTR</label>
                              <Input 
                                placeholder="e.g. 418293021922" 
                                value={utr}
                                onChange={(e) => setUtr(e.target.value.replace(/\D/g, '').slice(0, 12))}
                                className="rounded-xl h-11 text-base font-mono font-bold tracking-widest text-center"
                                inputMode="numeric"
                              />
                            </div>

                            {!paymentSettings?.qrAutoEnabled ? (
                              <div className="space-y-1.5">
                                <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider ml-1">Step 2: Upload Screenshot</label>
                                <input
                                  type="file"
                                  accept="image/*"
                                  onChange={handleImageChange}
                                  className="hidden"
                                  id="screenshot-upload"
                                />
                                <label
                                  htmlFor="screenshot-upload"
                                  className="flex items-center justify-between p-3 border-2 border-dashed border-gray-100 bg-gray-50/50 rounded-xl cursor-pointer hover:bg-gray-100 transition-colors"
                                >
                                  {screenshotPreview ? (
                                    <div className="flex items-center gap-3 w-full">
                                      <img src={screenshotPreview} alt="Preview" className="w-10 h-10 object-cover rounded-lg border border-white shadow-sm" />
                                      <span className="text-xs font-bold text-green-600 flex items-center">
                                        <Check className="w-3 h-3 mr-1" /> Image Uploaded
                                      </span>
                                    </div>
                                  ) : (
                                    <>
                                      <div className="flex items-center gap-2">
                                        <Upload className="w-4 h-4 text-gray-400" />
                                        <span className="text-xs font-bold text-gray-500">Select payment proof</span>
                                      </div>
                                      <span className="text-[10px] bg-white px-2 py-1 rounded-md border border-gray-100 font-bold text-gray-400">SELECT</span>
                                    </>
                                  )}
                                </label>
                              </div>
                            ) : (
                              <div className="p-3 bg-blue-50 rounded-xl border border-blue-100">
                                <p className="text-[9px] text-blue-600 font-bold text-center leading-tight">
                                  <AlertCircle className="w-3 h-3 inline mr-1" />
                                  Screenshot is optional for Auto-Verification. Just enter UTR!
                                </p>
                              </div>
                            )}

                            <div className="pt-2">
                              <Button 
                                className={`w-full h-12 rounded-xl text-base font-bold shadow-lg ${paymentSettings?.qrAutoEnabled ? 'bg-green-600 hover:bg-green-700' : ''}`} 
                                onClick={handleAddFunds}
                                disabled={isUploading || !utr || utr.length < 12 || (!paymentSettings?.qrAutoEnabled && !screenshotPreview)}
                              >
                                {isUploading ? (
                                  <>
                                    <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                                    Verifying...
                                  </>
                                ) : (
                                  paymentSettings?.qrAutoEnabled ? "Verify & Add Funds" : "Confirm & Add Balance"
                                )}
                              </Button>
                              <button 
                                onClick={() => setPaymentStep("amount")}
                                className="w-full mt-2 text-[10px] font-bold text-gray-400 uppercase hover:text-primary transition-colors"
                              >
                                ← Go back and change amount
                              </button>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>
            )}
          </div>
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


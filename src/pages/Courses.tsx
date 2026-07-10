import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { Search, Filter, Star, Users, BookOpen, QrCode, Upload, Share2, CheckCircle2, Image as ImageIcon, Wallet, AlertCircle, Copy, Check, Instagram, Youtube, Facebook, Music2, Send, Zap, RefreshCw } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { dbClient } from "@/lib/dbClient";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/context/AuthContext";
import { useSearchParams, useNavigate } from "react-router-dom";
import axios from "axios";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import CategoryIcon from "@/components/CategoryIcon";
import { cn } from "@/lib/utils";
import imageCompression from "browser-image-compression";
import { QRCodeSVG } from "qrcode.react";

const CATEGORIES = ["All", "Instagram", "YouTube", "Facebook", "TikTok", "Telegram", "Other"];

export default function Courses() {
  const { user, userProfile: profile, updateUserProfileLocal } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [courses, setCourses] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  
  // New Order Form State
  const [selectedCategory, setSelectedCategory] = useState("");
  const [selectedCourseId, setSelectedCourseId] = useState("");
  const [targetLink, setTargetLink] = useState("");
  const [quantity, setQuantity] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);

  // Add Funds State
  const [isAddFundsOpen, setIsAddFundsOpen] = useState(false);
  const [depositAmount, setDepositAmount] = useState("");
  const [utr, setUtr] = useState("");
  const [screenshot, setScreenshot] = useState<File | null>(null);
  const [screenshotPreview, setScreenshotPreview] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isOrderSuccessOpen, setIsOrderSuccessOpen] = useState(false);
  const [lastOrder, setLastOrder] = useState<any>(null);
  const [paymentSettings, setPaymentSettings] = useState<any>(null);
  const [paymentMethod, setPaymentMethod] = useState<"auto" | "manual" | null>(null);
  const [isRazorpayLoading, setIsRazorpayLoading] = useState(false);
  const [isPhonePeLoading, setIsPhonePeLoading] = useState(false);
  const [isPaytmLoading, setIsPaytmLoading] = useState(false);
  const [qrAutoData, setQrAutoData] = useState<{ payment_url?: string; client_txn_id?: string } | null>(null);
  const [isQrAutoLoading, setIsQrAutoLoading] = useState(false);

  const [isCategoryOpen, setIsCategoryOpen] = useState(false);
  const [isServiceOpen, setIsServiceOpen] = useState(false);

  const categories = Array.from(new Set(courses.map(c => c.category || "Other")));
  const filteredServices = courses.filter(c => c.category === selectedCategory);
  const selectedCourse = courses.find(c => c.id === selectedCourseId);

  useEffect(() => {
    const fetchCourses = async () => {
      try {
        const { getCachedCourses } = await import("@/lib/cache");
        const coursesData = await getCachedCourses();
        setCourses(coursesData);
        setLoading(false);
        
        if (coursesData.length > 0) {
          // Priority to previous selection, then query param, then first available
          const queryCategory = searchParams.get("category");
          if (queryCategory) {
            const match = coursesData.find(c => c.category && c.category.toLowerCase() === queryCategory.toLowerCase());
            if (match) {
              setSelectedCategory(match.category);
              return;
            }
          }
          
          if (!selectedCategory) {
            setSelectedCategory(coursesData[0].category || "Other");
          }
        }
      } catch (error) {
        console.error(error);
        setLoading(false);
      }
    };
    fetchCourses();
  }, [searchParams]);

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
        console.error(error);
      }
    };
    fetchSettings();

    // Dynamically load Razorpay SDK
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

  useEffect(() => {
    const services = courses.filter(c => c.category === selectedCategory);
    if (services.length > 0) {
      if (!selectedCourseId || !services.find(s => s.id === selectedCourseId)) {
        setSelectedCourseId(services[0].id);
      }
    } else {
      setSelectedCourseId("");
    }
  }, [selectedCategory, courses, selectedCourseId]);

  useEffect(() => {
    if (selectedCourse) {
      const isPkg = selectedCourse.isPackage || selectedCourse.is_package;
      if (isPkg) {
        setQuantity(String(selectedCourse.packageQuantity || selectedCourse.package_quantity || 1000));
      } else {
        setQuantity(String(selectedCourse.minLimit || selectedCourse.min_limit || 1000));
      }
    }
  }, [selectedCourseId]);

  const totalPrice = selectedCourse 
    ? ((selectedCourse.isPackage || selectedCourse.is_package)
        ? Number(selectedCourse.packagePrice || selectedCourse.package_price || 0) 
        : (Number(quantity) * (selectedCourse.price || 0)) / 1000) 
    : 0;

  const formatErrorMessage = (err: any): string => {
    if (!err) return "Unknown error";
    if (typeof err === "string") return err;
    if (typeof err === "object") {
      if (err.message && typeof err.message === "string") return err.message;
      if (err.error && typeof err.error === "string") return err.error;
      if (err.msg && typeof err.msg === "string") return err.msg;
      
      if (err.error && typeof err.error === "object") return formatErrorMessage(err.error);
      if (err.message && typeof err.message === "object") return formatErrorMessage(err.message);
      
      const keys = ["message", "error", "msg", "errors", "detail", "err"];
      for (const k of keys) {
        if (err[k]) {
          if (typeof err[k] === "string") return err[k];
          if (typeof err[k] === "object") return formatErrorMessage(err[k]);
        }
      }
      
      if (Array.isArray(err) && err.length > 0) {
        return formatErrorMessage(err[0]);
      }
      
      try {
        return JSON.stringify(err);
      } catch {
        return "[Object]";
      }
    }
    return String(err);
  };

  const handleSubmitOrder = async () => {
    if (!selectedCourse || !user) {
      toast.error("Please login to place an order");
      return;
    }
    if (!targetLink || targetLink.trim().length < 2) {
      toast.error("Please provide a valid target link, profile, or username");
      return;
    }
    const providerServiceId = selectedCourse.providerServiceId || selectedCourse.provider_service_id;
    if (!providerServiceId || providerServiceId === "0") {
      toast.error("This service is not currently available (missing configuration).");
      return;
    }
    const qtyNum = Number(quantity);
    const minLimit = Number(selectedCourse.minLimit || selectedCourse.min_limit || 0);
    if (!quantity || qtyNum < minLimit) {
      toast.error(`Minimum quantity is ${minLimit}`);
      return;
    }
    if ((profile?.balance || 0) < totalPrice) {
      toast.error("Insufficient balance! Please add funds to your wallet.");
      return;
    }

    setSubmitting(true);
    try {
      // Check for duplicate link if required
      if (selectedCourse.prevent_duplicate_link || selectedCourse.preventDuplicateLink) {
        const isDuplicate = await dbClient.checkDuplicateOrder(user.uid, selectedCourse.id, targetLink);
        if (isDuplicate) {
          toast.error("This link already working");
          setSubmitting(false);
          return;
        }
      }

      // 1. Calculate and update balance
      const currentBal = Number(profile?.balance || 0);
      const newBal = Math.max(0, currentBal - totalPrice);

      // 2. Prepare random order ID on demand
      setLastOrder(null);
      const orderId = "ord_" + Date.now() + "_" + Math.random().toString(36).substring(2, 7);

      // 3. Update Firestore profile balance instantly!
      await dbClient.updateUserProfile(user.uid, { 
        balance: newBal,
        last_ordered_at: new Date().toISOString()
      });

      // 4. Update local UI state balance instantly!
      if (updateUserProfileLocal) {
        updateUserProfileLocal({ balance: newBal });
      }

      // 5. Create the order data object with status "Completed"
      const orderData = {
        userId: user.uid,
        userEmail: user.email || "",
        serviceId: selectedCourse.id,
        courseId: selectedCourse.id, // For duplicate checker backwards compatibility
        title: selectedCourse.title,
        category: selectedCourse.category || "Other",
        quantity: Number(quantity),
        targetLink: targetLink.trim(),
        totalPrice: Number(totalPrice),
        status: "Completed",
        providerOrderId: "PROCESSING", // Will be updated by background API task
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      // 6. Save the order to Firestore instantly!
      await dbClient.setDoc("orders", orderId, orderData);

      // 7. Cache in localStorage so it shows up instantly in Dashboard and clear session cache
      try {
        const localOrdersKey = `local_orders_${user.uid}`;
        const existingLocal = JSON.parse(localStorage.getItem(localOrdersKey) || "[]");
        existingLocal.unshift({ ...orderData, id: orderId });
        localStorage.setItem(localOrdersKey, JSON.stringify(existingLocal.slice(0, 50)));
        
        // Clear session cache to force fresh fetch on dashboard
        sessionStorage.removeItem(`orders_${user.uid}`);
        sessionStorage.removeItem(`orders_${user.uid}_time`);
      } catch (localErr) {
        console.warn("[LOCAL-CACHE-ERR] Failed to cache order:", localErr);
      }

      // 8. Open the success popup instantly!
      setLastOrder(orderData);
      setIsOrderSuccessOpen(true);
      toast.success("Order Placed Successfully!");
      
      // Reset input fields instantly
      const savedTargetLink = targetLink.trim();
      const savedQuantity = String(quantity);
      setTargetLink("");
      setQuantity(String(selectedCourse.minLimit || 1000));
      setSubmitting(false);

      // 9. Fire background task to transmit the order to the SMM provider (Completely Non-Blocking)
      const isNativeHost = window.location.origin.includes("localhost") || 
                           window.location.origin.includes("127.0.0.1") || 
                           window.location.origin.includes("-523409699457");

      (async () => {
        try {
          let pId = "SENT";

          if (!isNativeHost) {
            console.log(`[Custom Domain Mode] Direct Background transmit for order ${orderId}`);
            
            // Fetch settings and provider details
            const settingsSnap = await dbClient.getDoc("settings", "payment");
            let pUrl = (settingsSnap?.providerApiUrl || "").trim();
            let pKey = (settingsSnap?.providerApiKey || "").trim();

            if (selectedCourse.providerId && selectedCourse.providerId !== "global") {
              const providerSnap = await dbClient.getDoc("providers", selectedCourse.providerId);
              if (providerSnap) {
                const resolvedUrl = (providerSnap.api_url || "").trim() || (providerSnap.apiUrl || "").trim();
                const resolvedKey = (providerSnap.api_key || "").trim() || (providerSnap.apiKey || "").trim();
                if (resolvedUrl) pUrl = resolvedUrl;
                if (resolvedKey) pKey = resolvedKey;
              }
            }

            if (!pUrl) pUrl = "https://smmbin.com/api/v2";
            if (!pUrl.startsWith("http")) pUrl = "https://" + pUrl;

            if (pKey) {
              // Normalize Link/Username
              let finalLink = savedTargetLink;
              if (finalLink.startsWith("@")) {
                const username = finalLink.substring(1);
                if (selectedCourse.category?.toLowerCase().includes("instagram")) finalLink = `https://www.instagram.com/${username}/`;
                else if (selectedCourse.category?.toLowerCase().includes("twitter") || selectedCourse.category?.toLowerCase().includes("x")) finalLink = `https://x.com/${username}/`;
                else if (selectedCourse.category?.toLowerCase().includes("tiktok")) finalLink = `https://www.tiktok.com/@${username}`;
              }

              // Params for SMM api
              const params = new URLSearchParams();
              params.append("key", pKey);
              params.append("action", "add");
              params.append("service", String(selectedCourse.providerServiceId || selectedCourse.provider_service_id || "0").trim());
              params.append("link", finalLink);
              params.append("quantity", savedQuantity);

              let providerRes;
              const proxies = [
                (url: string) => `https://corsproxy.io/?${encodeURIComponent(url)}`,
                (url: string) => `https://thingproxy.freeboard.io/fetch/${url}`,
                (url: string) => url
              ];

              for (const proxyFn of proxies) {
                try {
                  const targetUrl = proxyFn(pUrl);
                  providerRes = await axios.post(targetUrl, params, {
                    headers: { "Content-Type": "application/x-www-form-urlencoded" }
                  });
                  if (providerRes?.data) break;
                } catch (e) {
                  console.warn("[Background Custom Proxy failed]:", e);
                }
              }

              let resData = providerRes?.data;
              if (typeof resData === "string") {
                try {
                  const trimmed = resData.trim();
                  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
                    resData = JSON.parse(trimmed);
                  } else if (trimmed.match(/^\d+$/)) {
                    resData = { order: trimmed };
                  }
                } catch (e) {}
              }

              if (Array.isArray(resData) && resData.length > 0) {
                resData = resData[0];
              }

              const resolvedProviderOrderId = resData?.order || resData?.order_id || resData?.orderid || resData?.orderId || resData?.id || resData?.ID || resData?.data?.order || resData?.data?.order_id || resData?.data?.id;
              if (resolvedProviderOrderId) {
                pId = String(resolvedProviderOrderId);
              }
            }
          } else {
            // Standard native host path: call server proxy in background
            const response = await axios.post("/api/proxy-provider", {
              orderId: orderId,
              userId: user?.uid,
              userEmail: user?.email || "",
              serviceId: selectedCourse.id,
              title: selectedCourse.title,
              category: selectedCourse.category || "Other",
              quantity: Number(savedQuantity),
              targetLink: savedTargetLink,
              totalPrice: totalPrice,
              isAsync: false,
              skipStoreCompleted: true // Skip duplication in api endpoint as we saved it
            });
            pId = response.data?.providerOrderId || "SENT";
          }

          // Quietly update the order document in Firestore with the actual provider order ID
          await dbClient.updateDoc("orders", orderId, {
            providerOrderId: pId,
            updatedAt: new Date().toISOString()
          });

          console.log(`[Background Order Transmit] Success! Provider Order ID: ${pId}`);

        } catch (bgError) {
          console.error("[Background Order Transmit] Failed to transmit in background:", bgError);
          // Update order document with Pending status and log the error details
          try {
            await dbClient.updateDoc("orders", orderId, {
              status: "Pending", // Mark as Pending so admin can review
              error: bgError instanceof Error ? bgError.message : String(bgError),
              updatedAt: new Date().toISOString()
            });
          } catch (e) {
            console.error("[Background Order Transmit] Failed to mark order as Pending:", e);
          }
        }
      })();

    } catch (outerError: any) {
      toast.error(outerError?.message || "Failed to place order");
      setSubmitting(false);
    }
  };

  const handleImageChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      try {
        const options = {
          maxSizeMB: 0.5,
          maxWidthOrHeight: 1024,
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

  const handleAddFunds = async () => {
    if (!depositAmount || !user) {
      toast.error("Please enter an amount");
      return;
    }

    const cleanUtr = utr.replace(/\D/g, "");
    if (cleanUtr.length !== 12) {
      toast.error("Please provide a valid 12-digit UTR number");
      return;
    }

    const isQrAuto = !!paymentSettings?.qrAutoEnabled;

    if (isQrAuto) {
      setIsUploading(true);
      try {
        const response = await axios.post("/api/deposits/verify-qr-auto", {
          amount: Number(depositAmount),
          utr: cleanUtr,
          userId: user.uid,
          userEmail: user.email,
          client_txn_id: qrAutoData?.client_txn_id
        });

        if (response.data.success) {
          toast.success("🎉 Payment verified! ₹" + response.data.amount + " added to wallet.");
          setIsAddFundsOpen(false);
          setDepositAmount("");
          setUtr("");
          setScreenshot(null);
          setScreenshotPreview(null);
          // Refresh user profile to show new balance
          if (updateUserProfileLocal) {
            updateUserProfileLocal({ balance: (profile?.balance || 0) + Number(response.data.amount) });
          }
          return;
        } else {
          toast.error(response.data.error || "Verification failed. Please check UTR/Amount.");
          setIsUploading(false);
          return;
        }
      } catch (error: any) {
        console.error("Auto verify failed:", error);
        toast.error(error.response?.data?.error || "Automatic verification failed. You can try manual upload.");
        setIsUploading(false);
        // Fallback to manual if auto fails? No, let user decide.
        return;
      }
    }

    if (!screenshot && !isQrAuto) {
      toast.error("Please provide a valid 12-digit UTR number");
      return;
    }

    if (!screenshotPreview && !isQrAuto) {
      toast.error("Please upload a payment screenshot");
      return;
    }

    setIsUploading(true);
    
    try {
      // Use the secure API for manual deposit submission
      const response = await axios.post("/api/deposits/submit-manual", {
        amount: Number(depositAmount),
        utr: cleanUtr,
        screenshotUrl: screenshotPreview,
        userId: user.uid,
        userEmail: user.email
      });

      if (response.data.success) {
        if (response.data.isAutoApproved) {
          toast.success("🎉 Payment verified automatically! ₹" + Number(depositAmount) + " has been added to your wallet.");
        } else {
          toast.success("Fund request submitted! Admin will verify and add balance soon.");
        }
        setIsAddFundsOpen(false);
        setDepositAmount("");
        setUtr("");
        setScreenshot(null);
        setScreenshotPreview(null);
      } else {
        toast.error(response.data.error || "Failed to submit request");
      }
    } catch (error: any) {
      console.error("Server payment submission failed, trying client-side fallback...", error);
      
      // OPTION 2: Client-side Direct Write Fallback
      try {
        const cleanUtr = utr.replace(/\D/g, "");
        if (cleanUtr.length !== 12) throw new Error("Invalid UTR format");

        const depositId = "dep_" + Date.now() + "_" + Math.random().toString(36).substring(2, 7);
        await dbClient.submitManualDeposit(depositId, {
          userId: user.uid,
          userEmail: user.email || "not-provided",
          amount: Number(depositAmount),
          utr: cleanUtr,
          screenshotUrl: screenshotPreview || ""
        });

        toast.success("Request submitted successfully!");
        setIsAddFundsOpen(false);
        setDepositAmount("");
        setUtr("");
        setScreenshot(null);
        setScreenshotPreview(null);
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

  const handleRazorpayPayment = async () => {
    if (!depositAmount || Number(depositAmount) < 1) {
      toast.error("Minimum amount is ₹1");
      return;
    }

    setIsRazorpayLoading(true);
    try {
      const response = await axios.post("/api/razorpay/create-order", {
        amount: Number(depositAmount),
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
            amount: Number(depositAmount),
            userId: user?.uid,
            userEmail: user?.email,
          });

          if (verifyRes.data.success) {
            toast.success("Payment Received! Balance updated.");
            setIsAddFundsOpen(false);
            setDepositAmount("");
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
    if (!depositAmount || Number(depositAmount) < 1) {
      toast.error("Minimum amount is ₹1");
      return;
    }

    setIsPhonePeLoading(true);
    try {
      const response = await axios.post("/api/phonepe/create-order", {
        amount: Number(depositAmount),
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
    if (!depositAmount || Number(depositAmount) < 1) {
      toast.error("Minimum amount is ₹1");
      return;
    }

    setIsPaytmLoading(true);
    try {
      const response = await axios.post("/api/paytm/create-order", {
        amount: Number(depositAmount),
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

  const upiLink = qrAutoData?.payment_url || (paymentSettings?.upiId 
    ? `upi://pay?pa=${paymentSettings.upiId}&pn=${encodeURIComponent(paymentSettings.merchantName || "SMM Panel")}&am=${depositAmount}&cu=INR`
    : "");

  const isQrAuto = !!paymentSettings?.qrAutoEnabled;

  const renderLights = () => {
    const dots = [];
    const totalDots = 40;
    const colors = ['text-red-500 bg-red-500', 'text-blue-500 bg-blue-500', 'text-yellow-500 bg-yellow-500', 'text-green-500 bg-green-500', 'text-pink-500 bg-pink-500', 'text-purple-500 bg-purple-500', 'text-cyan-500 bg-cyan-500', 'text-orange-500 bg-orange-500'];
    
    for (let i = 0; i < totalDots; i++) {
      let style = {};
      const delay = `${(i / totalDots) * 2}s`;
      const color = colors[i % colors.length];
      
      if (i < 10) { // Top
        style = { top: 0, left: `${i * 10}%` };
      } else if (i < 20) { // Right
        style = { top: `${(i - 10) * 10}%`, right: 0 };
      } else if (i < 30) { // Bottom
        style = { bottom: 0, right: `${(i - 20) * 10}%` };
      } else { // Left
        style = { bottom: `${(i - 30) * 10}%`, left: 0 };
      }
      
      dots.push(
        <div 
          key={i} 
          className={`light-dot ${color} animate-chase`} 
          style={{ ...style, animationDelay: delay }} 
        />
      );
    }
    return dots;
  };

  return (
    <div className="w-full max-w-xl mx-auto space-y-4 pb-12">
      {/* Balance Card */}
      <Card className="border-none shadow-sm bg-gray-900 text-white overflow-hidden relative group">
        {/* Animated Lights Border */}
        <div className="absolute inset-0 pointer-events-none">
          {renderLights()}
        </div>

        <div className="absolute top-0 right-0 p-6 opacity-10">
          <Wallet className="w-16 h-16" />
        </div>
        <CardContent className="p-4 relative z-10">
          <p className="text-[10px] font-bold uppercase tracking-wider opacity-80">Available Balance</p>
          <div className="flex items-end gap-2 mt-0.5">
            <h2 className="text-2xl font-bold">₹{Number(profile?.balance || 0).toFixed(2)}</h2>
            <Button 
              size="sm" 
              className="mb-0.5 rounded-full h-9 text-xs font-bold uppercase bg-blue-600 hover:bg-blue-700 text-white border-none shadow-sm px-5"
              onClick={async () => {
                setIsAddFundsOpen(true);
                try {
                  const { getCachedSettings } = await import("@/lib/cache");
                  const settingsData = await getCachedSettings(true); // Force clear/refresh on open
                  if (settingsData) {
                    setPaymentSettings(settingsData);
                    const hasAuto = !!(settingsData.razorpayEnabled || settingsData.phonepeEnabled || settingsData.paytmEnabled);
                    setPaymentMethod(hasAuto ? "auto" : "manual");
                  }
                } catch (e) {
                  console.error("Failed to load settings on modal open:", e);
                }
              }}
            >
              Add Funds
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="border-none shadow-sm rounded-[1.5rem] overflow-hidden">
        <CardContent className="p-4 space-y-4">
          <div className="space-y-1.5">
            <Label className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Category</Label>
            <div className="relative">
              <button
                onClick={() => setIsCategoryOpen(!isCategoryOpen)}
                className="w-full h-12 pl-11 pr-10 rounded-xl border bg-gray-50 flex items-center text-sm transition-all hover:bg-gray-100 text-left"
              >
                <div className="absolute left-3.5 top-1/2 -translate-y-1/2">
                  <CategoryIcon 
                    category={selectedCategory} 
                    iconUrl={courses.find(c => c.category === selectedCategory)?.iconUrl || courses.find(c => c.category === selectedCategory)?.icon_url}
                    className="w-5 h-5" 
                  />
                </div>
                <span className="font-medium flex-1 leading-tight break-words py-1">{selectedCategory || "Select Category"}</span>
                <div className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-400">
                  <Filter className={cn("w-4 h-4 transition-transform", isCategoryOpen && "rotate-180")} />
                </div>
              </button>

              {isCategoryOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setIsCategoryOpen(false)} />
                  <motion.div 
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="absolute z-50 w-full mt-2 bg-white border rounded-2xl shadow-xl max-h-60 overflow-y-auto p-1.5"
                  >
                    {categories.map((cat) => (
                      <button
                        key={cat}
                        onClick={() => {
                          setSelectedCategory(cat);
                          setIsCategoryOpen(false);
                        }}
                        className={cn(
                          "w-full flex items-center gap-3 p-3 rounded-xl text-sm transition-all hover:bg-gray-50",
                          selectedCategory === cat ? "bg-primary/5 text-primary font-bold" : "text-gray-600"
                        )}
                      >
                        <CategoryIcon 
                        category={cat} 
                        iconUrl={courses.find(c => c.category === cat)?.iconUrl || courses.find(c => c.category === cat)?.icon_url}
                        className="w-4 h-4" 
                      />
                        {cat}
                      </button>
                    ))}
                  </motion.div>
                </>
              )}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Service</Label>
            <div className="relative">
              <button
                onClick={() => setIsServiceOpen(!isServiceOpen)}
                className="w-full min-h-12 py-2 pl-11 pr-10 rounded-xl border bg-gray-50 flex items-center text-sm transition-all hover:bg-gray-100 text-left"
                disabled={!selectedCategory}
              >
                <div className="absolute left-3.5 top-1/2 -translate-y-1/2">
                  <CategoryIcon 
                    category={selectedCategory} 
                    iconUrl={selectedCourse?.iconUrl || selectedCourse?.icon_url || courses.find(c => c.category === selectedCategory)?.iconUrl || courses.find(c => c.category === selectedCategory)?.icon_url}
                    className="w-5 h-5" 
                  />
                </div>
                <span className="font-semibold flex-1 leading-tight whitespace-normal break-words py-1 pr-1 flex items-center gap-1.5 flex-wrap">
                  {selectedCourse ? (
                    <>
                      {(selectedCourse.isPackage || selectedCourse.is_package) && (
                        <Badge className="bg-primary/20 text-primary border-none text-[8px] h-3.5 px-1.5 font-bold uppercase shrink-0">
                          Package
                        </Badge>
                      )}
                      {(selectedCourse.isPackage || selectedCourse.is_package)
                        ? selectedCourse.title 
                        : `${selectedCourse.title} - ₹${selectedCourse.price}/1k`
                      }
                    </>
                  ) : (
                    "Select Service"
                  )}
                </span>
                <div className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-400">
                  <Share2 className={cn("w-4 h-4 transition-transform", isServiceOpen && "rotate-180")} />
                </div>
              </button>

              {isServiceOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setIsServiceOpen(false)} />
                  <motion.div 
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="absolute z-50 w-full mt-2 bg-white border rounded-2xl shadow-xl max-h-60 overflow-y-auto p-1.5"
                  >
                    {filteredServices.map((service) => (
                      <button
                        key={service.id}
                        onClick={() => {
                          setSelectedCourseId(service.id);
                          setIsServiceOpen(false);
                        }}
                        className={cn(
                          "w-full flex items-center gap-3 p-3 rounded-xl text-sm transition-all hover:bg-gray-50 text-left",
                          selectedCourseId === service.id ? "bg-primary/5 text-primary font-bold" : "text-gray-600"
                        )}
                      >
                        <CategoryIcon 
                        category={selectedCategory} 
                        iconUrl={service.iconUrl || service.icon_url}
                        className="w-4 h-4 shrink-0" 
                      />
                        <div className="min-w-0 pr-2 flex-1">
                          <p className="whitespace-normal leading-tight break-words flex items-center gap-1.5 flex-wrap">
                            {service.title}
                            {(service.isPackage || service.is_package) && (
                              <Badge className="bg-primary/15 text-primary border-none text-[8px] h-3.5 px-1 font-bold shrink-0">
                                PKG
                              </Badge>
                            )}
                          </p>
                          {!(service.isPackage || service.is_package) && (
                            <p className="text-[10px] text-gray-400 font-bold mt-0.5">
                              ₹{service.price} per 1000
                            </p>
                          )}
                        </div>
                      </button>
                    ))}
                  </motion.div>
                </>
              )}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Link</Label>
            <Input 
              placeholder="https://instagram.com/p/..." 
              className="rounded-xl h-10 bg-gray-50 text-sm"
              value={targetLink}
              onChange={(e) => setTargetLink(e.target.value)}
            />
            <p className="text-[9px] text-gray-500 font-medium px-1">
              Ensure profile/post is <strong className="text-primary">PUBLIC</strong>. Private links will be rejected.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label className="text-[10px] font-bold uppercase tracking-wider text-gray-400">
              {selectedCourse?.isPackage ? "Package Quantity (Fixed)" : `Quantity (Min: ${selectedCourse?.minLimit || 0})`}
            </Label>
            <Input 
              type="number"
              placeholder={selectedCourse?.isPackage ? "Fixed quantity" : "Enter quantity"} 
              className="rounded-xl h-10 bg-gray-50 text-sm"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              disabled={selectedCourse?.isPackage}
            />
          </div>

          {selectedCourse && (
            <div className="p-3 bg-primary/5 rounded-xl border border-primary/10 space-y-0.5">
              <div className="flex justify-between items-center">
                <span className="text-xs font-medium text-gray-600">Total Charge</span>
                <span className="text-lg font-bold text-primary">₹{totalPrice}</span>
              </div>
              {(profile?.balance || 0) < totalPrice && (
                <p className="text-[9px] text-red-500 flex items-center gap-1 font-bold">
                  <AlertCircle className="w-2.5 h-2.5" /> Insufficient balance!
                </p>
              )}
            </div>
          )}

          <Button 
            className="w-full rounded-xl h-11 font-bold text-base shadow-lg shadow-primary/20" 
            onClick={handleSubmitOrder}
            disabled={submitting || !selectedCourse || (profile?.balance || 0) < totalPrice}
          >
            {submitting ? "Placing Order..." : "Place Order"}
          </Button>
        </CardContent>
      </Card>

      <div className="space-y-3 pt-2">
        <h2 className="text-base font-bold">Service Details</h2>
        {selectedCourse ? (
          <Card className="border-none shadow-sm rounded-2xl overflow-hidden bg-white">
            <div className="bg-primary/5 p-4 flex items-center gap-4 border-b">
              <div className="w-12 h-12 bg-white rounded-2xl shadow-sm flex items-center justify-center overflow-hidden">
                <CategoryIcon 
                  category={selectedCourse.category} 
                  iconUrl={selectedCourse.iconUrl}
                  className="w-6 h-6" 
                />
              </div>
              <div>
                <h3 className="font-bold text-sm leading-tight">{selectedCourse.title}</h3>
                <Badge variant="outline" className="mt-1 text-[10px] font-bold uppercase bg-white border-primary/20 text-primary">
                  {selectedCourse.category}
                </Badge>
              </div>
            </div>
            <CardContent className="p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-500">Service ID</span>
                <span className="text-xs font-bold">#{selectedCourse.id.slice(0, 8)}</span>
              </div>
              {(selectedCourse.isPackage || selectedCourse.is_package) ? (
                <>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-gray-500">Package Quantity</span>
                    <span className="text-xs font-bold text-primary">{selectedCourse.packageQuantity || selectedCourse.package_quantity}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-gray-500">Package Offer Price</span>
                    <span className="text-xs font-bold text-primary">₹{selectedCourse.packagePrice || selectedCourse.package_price}</span>
                  </div>
                </>
              ) : (
                <>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-gray-500">Rate per 1000</span>
                    <span className="text-xs font-bold text-primary">₹{selectedCourse.price}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-gray-500">Minimum Order</span>
                    <span className="text-xs font-bold">{selectedCourse.minLimit || selectedCourse.min_limit}</span>
                  </div>
                </>
              )}
              <div className="border-t pt-2 mt-2">
                <p className="text-[10px] text-gray-400 font-bold uppercase mb-0.5">Description</p>
                <p className="text-xs text-gray-600 leading-relaxed">
                  {selectedCourse.description || "High quality social media service with instant start and fast delivery."}
                </p>
              </div>
            </CardContent>
          </Card>
        ) : (
          <p className="text-center text-gray-400 italic py-8">Select a service to see details</p>
        )}
      </div>

      <Dialog open={isAddFundsOpen} onOpenChange={(open) => {
        setIsAddFundsOpen(open);
        if (!open) {
          setDepositAmount("");
          setUtr("");
          setScreenshot(null);
          setScreenshotPreview(null);
          setQrAutoData(null);
        }
      }}>
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
                value={depositAmount}
                onChange={(e) => setDepositAmount(e.target.value)}
                className="rounded-xl h-9 text-base font-bold"
              />
            </div>

            {(() => {
              const hasTraditionalAuto = !!(paymentSettings?.razorpayEnabled || paymentSettings?.phonepeEnabled || paymentSettings?.paytmEnabled);
              const qrAutoEnabled = !!paymentSettings?.qrAutoEnabled;
              const hasAnyAuto = hasTraditionalAuto || qrAutoEnabled;
              
              return (
                <>
                  {hasAnyAuto && depositAmount && Number(depositAmount) > 0 && (
                    <div className="grid grid-cols-2 gap-3 mb-4 mt-1">
                      <button
                        type="button"
                        onClick={() => setPaymentMethod("auto")}
                        className={`flex flex-col items-center justify-center p-3 rounded-2xl border-2 text-center transition-all ${
                          paymentMethod === "auto" 
                            ? "border-primary bg-primary/5 text-primary" 
                            : "border-gray-100 hover:border-gray-200 text-gray-600"
                        }`}
                      >
                        <Zap className="w-5 h-5 mb-1 text-yellow-500 fill-yellow-500 animate-pulse" />
                        <span className="text-xs font-bold">Auto Gateways</span>
                        <span className="text-[9px] opacity-80">Razorpay/PhonePe</span>
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          setPaymentMethod("manual");
                          if (paymentSettings?.qrAutoEnabled && depositAmount && Number(depositAmount) >= 1) {
                            setIsQrAutoLoading(true);
                            try {
                              const res = await axios.post("/api/deposits/create-qr-auto-order", {
                                userId: user.uid,
                                amount: Number(depositAmount),
                                userEmail: user.email
                              });
                              if (res.data.success && res.data.payment_url) {
                                setQrAutoData({ 
                                  payment_url: res.data.payment_url, 
                                  client_txn_id: res.data.client_txn_id 
                                });
                              }
                            } catch (err) {
                              console.error("Auto pre-order failed:", err);
                            } finally {
                              setIsQrAutoLoading(false);
                            }
                          }
                        }}
                        className={`flex flex-col items-center justify-center p-3 rounded-2xl border-2 text-center transition-all ${
                          paymentMethod === "manual" 
                            ? "border-primary bg-primary/5 text-primary" 
                            : "border-gray-100 hover:border-gray-200 text-gray-600"
                        }`}
                      >
                        <QrCode className="w-5 h-5 mb-1 text-blue-500" />
                        <span className="text-xs font-bold">UPI QR {qrAutoEnabled && "(Auto)"}</span>
                        <span className="text-[9px] opacity-80">{qrAutoEnabled ? "Instant Verify" : "Manual Verify"}</span>
                      </button>
                    </div>
                  )}

                  {paymentMethod === "auto" && hasTraditionalAuto && depositAmount && Number(depositAmount) > 0 && (
                    <div className="space-y-2 pt-2 animate-in fade-in slide-in-from-top-2">
                      <div className="relative flex items-center py-2">
                        <div className="flex-grow border-t border-gray-100"></div>
                        <span className="flex-shrink mx-4 text-[10px] font-bold text-gray-400 uppercase tracking-widest">Choose Gateway</span>
                        <div className="flex-grow border-t border-gray-100"></div>
                      </div>

                      {paymentSettings?.razorpayEnabled && (
                        <Button 
                          onClick={handleRazorpayPayment}
                          disabled={isRazorpayLoading}
                          className="w-full h-12 rounded-2xl bg-[#3395FF] hover:bg-[#2085ee] text-white font-bold flex items-center justify-center gap-2 mb-2"
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
                      )}

                      {paymentSettings?.phonepeEnabled && (
                        <Button 
                          onClick={handlePhonePePayment}
                          disabled={isPhonePeLoading}
                          className="w-full h-12 rounded-2xl bg-[#5f259f] hover:bg-[#4d1d82] text-white font-bold flex items-center justify-center gap-2 mb-2"
                        >
                          {isPhonePeLoading ? (
                            <RefreshCw className="w-5 h-5 animate-spin" />
                          ) : (
                            <>
                              <Wallet className="w-5 h-5" />
                              Pay with PhonePe (Instant)
                            </>
                          )}
                        </Button>
                      )}

                      {paymentSettings?.paytmEnabled && (
                        <Button 
                          onClick={handlePaytmPayment}
                          disabled={isPaytmLoading}
                          className="w-full h-12 rounded-2xl bg-[#00b9f5] hover:bg-[#009cd0] text-white font-bold flex items-center justify-center gap-2 mb-2"
                        >
                          {isPaytmLoading ? (
                            <RefreshCw className="w-5 h-5 animate-spin" />
                          ) : (
                            <>
                              <Wallet className="w-5 h-5" />
                              Pay with Paytm (Instant)
                            </>
                          )}
                        </Button>
                      )}
                    </div>
                  )}

                  {paymentMethod === "manual" && depositAmount && Number(depositAmount) > 0 && paymentSettings?.upiId && (
                    <div className="space-y-2 animate-in fade-in slide-in-from-top-2">
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
                              size={120}
                              level="H"
                              includeMargin={true}
                            />
                          )}
                        </div>
                        
                        <div className="text-center relative z-10">
                          <p className="text-xs font-bold text-primary">
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

                        {paymentSettings?.qrAutoEnabled ? (
                          <div className="flex flex-col items-center gap-2 p-3 bg-green-50 rounded-2xl border-2 border-green-100 mb-2 relative">
                            {isQrAutoLoading && (
                              <div className="absolute inset-0 bg-white/60 rounded-2xl flex items-center justify-center z-20">
                                <RefreshCw className="w-5 h-5 animate-spin text-primary" />
                              </div>
                            )}
                            <div className="flex items-center gap-2 text-green-700">
                              <Zap className="w-4 h-4 fill-green-500 text-green-500 animate-pulse" />
                              <span className="text-xs font-bold uppercase">QR Auto-Verify Active</span>
                            </div>
                            <p className="text-[9px] text-green-600 font-medium text-center">Pay & enter UTR for instant credit!</p>
                          </div>
                        ) : (
                          <div className="relative">
                            <div className="absolute inset-0 flex items-center">
                              <span className="w-full border-t" />
                            </div>
                            <div className="relative flex justify-center text-[10px] uppercase">
                              <span className="bg-white px-2 text-gray-500 font-bold">AND MANDATORY SCREENSHOT</span>
                            </div>
                          </div>
                        )}

                        <div className="space-y-1">
                          <input
                            type="file"
                            accept="image/*"
                            onChange={handleImageChange}
                            className="hidden"
                            id="screenshot-upload-courses"
                          />
                          <label
                            htmlFor="screenshot-upload-courses"
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
                </>
              );
            })()}
          </div>

          {paymentMethod === "manual" && (
            <DialogFooter>
              <Button 
                className={`w-full h-12 rounded-xl text-lg font-bold shadow-lg ${paymentSettings?.qrAutoEnabled ? 'bg-green-600 hover:bg-green-700' : 'bg-primary'}`} 
                onClick={handleAddFunds}
                disabled={isUploading || !depositAmount || Number(depositAmount) <= 0 || (paymentMethod === "manual" && (!utr || utr.length < 12)) || (paymentMethod === "manual" && !paymentSettings?.qrAutoEnabled && !screenshotPreview)}
              >
                {isUploading ? (
                  <>
                    <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                    Verifying...
                  </>
                ) : (
                  paymentSettings?.qrAutoEnabled ? "Verify & Add Balance" : "Confirm Payment"
                )}
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>

      {/* Order Success Dialog */}
      <Dialog open={isOrderSuccessOpen} onOpenChange={setIsOrderSuccessOpen}>
        <DialogContent className="max-w-[90vw] sm:max-w-md rounded-3xl p-6 text-center">
          <div className="flex flex-col items-center space-y-4">
            <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center">
              <CheckCircle2 className="w-10 h-10 text-green-600" />
            </div>
            <DialogHeader>
              <DialogTitle className="text-2xl font-bold text-gray-900">Order Placed!</DialogTitle>
              <DialogDescription className="text-gray-500">
                Your order has been successfully completed and sent to the provider.
              </DialogDescription>
            </DialogHeader>

            {lastOrder && (
              <div className="w-full bg-gray-50 rounded-2xl p-4 space-y-2 text-left border border-gray-100">
                <div className="flex flex-col gap-1 text-xs">
                  <span className="text-gray-400 font-bold uppercase">Service</span>
                  <span className="font-bold text-gray-700 line-clamp-2 leading-tight">{lastOrder.title}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-gray-400 font-bold uppercase">Quantity</span>
                  <span className="font-bold text-gray-700">{lastOrder.quantity}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-gray-400 font-bold uppercase">Amount</span>
                  <span className="font-bold text-primary">₹{lastOrder.totalPrice ?? lastOrder.total_price}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-gray-400 font-bold uppercase">Status</span>
                  <Badge className={cn(
                    "border-none text-[10px] h-5",
                    lastOrder.status?.toLowerCase() === 'completed' ? "bg-green-100 text-green-700" : "bg-blue-100 text-blue-700"
                  )}>
                    {lastOrder.status}
                  </Badge>
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3 w-full pt-2">
              <Button 
                variant="outline" 
                className="rounded-xl h-12 font-bold"
                onClick={() => setIsOrderSuccessOpen(false)}
              >
                Close
              </Button>
              <Button 
                className="rounded-xl h-12 font-bold shadow-lg shadow-primary/20"
                onClick={() => navigate('/dashboard')}
              >
                View Orders
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}


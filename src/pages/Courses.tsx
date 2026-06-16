import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { Search, Filter, Star, Users, BookOpen, QrCode, Upload, Share2, CheckCircle2, Image as ImageIcon, Wallet, AlertCircle, Copy, Check, Instagram, Youtube, Facebook, Music2, Send } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { collection, query, where, addDoc, serverTimestamp, getDoc, doc, updateDoc, writeBatch, increment, runTransaction, onSnapshot, setDoc } from "firebase/firestore";
import { db, handleFirestoreError, OperationType } from "@/lib/firebase";
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
  const { user, profile } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [courses, setCourses] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  
  // New Order Form State
  const [selectedCategory, setSelectedCategory] = useState("Instagram");
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
  const [paymentSettings, setPaymentSettings] = useState<{
    upiId: string;
    merchantName: string;
    paymentQrUrl: string;
  } | null>(null);

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
        
        if (coursesData.length > 0 && !selectedCategory) {
          setSelectedCategory(coursesData[0].category || "Other");
        }
      } catch (error) {
        console.error(error);
      }
    };
    fetchCourses();
  }, []);

  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const { getCachedSettings } = await import("@/lib/cache");
        const settingsData = await getCachedSettings();
        setPaymentSettings(settingsData);
      } catch (error) {
        console.error(error);
      }
    };
    fetchSettings();
  }, []);

  // Sync category state dynamically from SEO dynamic URL queries
  useEffect(() => {
    const queryCategory = searchParams.get("category");
    if (queryCategory) {
      const match = CATEGORIES.find(c => c.toLowerCase() === queryCategory.toLowerCase());
      if (match) {
        setSelectedCategory(match);
      } else {
        const foundData = courses.find(c => c.category && c.category.toLowerCase() === queryCategory.toLowerCase());
        if (foundData) {
          setSelectedCategory(foundData.category);
        }
      }
    }
  }, [searchParams, courses]);

  useEffect(() => {
    const services = courses.filter(c => c.category === selectedCategory);
    if (services.length > 0) {
      setSelectedCourseId(services[0].id);
    } else {
      setSelectedCourseId("");
    }
  }, [selectedCategory, courses]);

  useEffect(() => {
    if (selectedCourse) {
      if (selectedCourse.isPackage) {
        setQuantity(String(selectedCourse.packageQuantity || 1000));
      } else {
        setQuantity(String(selectedCourse.minLimit || 1000));
      }
    }
  }, [selectedCourseId]);

  const totalPrice = selectedCourse 
    ? (selectedCourse.isPackage 
        ? Number(selectedCourse.packagePrice || 0) 
        : (Number(quantity) * selectedCourse.pricePerThousand) / 1000) 
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
      toast.error("Please select a service and login");
      return;
    }
    if (!targetLink || targetLink.trim().length < 2) {
      toast.error("Please provide a valid target link, profile, or username");
      return;
    }
    if (!selectedCourse.providerServiceId || selectedCourse.providerServiceId === "0") {
      toast.error("This service is not currently available (missing configuration).");
      return;
    }
    const qtyNum = Number(quantity);
    if (!quantity || qtyNum < selectedCourse.minLimit) {
      toast.error(`Minimum quantity is ${selectedCourse.minLimit}`);
      return;
    }
    if ((profile?.balance || 0) < totalPrice) {
      toast.error("Insufficient balance! Please add funds to your wallet.");
      return;
    }

    setSubmitting(true);
    try {
      // Check for duplicate link if required
      if (selectedCourse.preventDuplicateLink) {
        const { getDocs, query, collection, where, limit, orderBy } = await import("firebase/firestore");
        const duplicateCheckQuery = query(
          collection(db, "orders"),
          where("userId", "==", user.uid),
          where("courseId", "==", selectedCourse.id),
          where("targetLink", "==", targetLink),
          orderBy("createdAt", "desc"),
          limit(1)
        );
        const dupSnap = await getDocs(duplicateCheckQuery);
        
        if (!dupSnap.empty) {
          const data = dupSnap.docs[0].data();
          if (data.createdAt) {
            const orderTime = data.createdAt.toMillis ? data.createdAt.toMillis() : data.createdAt.toDate().getTime();
            if ((Date.now() - orderTime) < 10 * 60 * 1000) { // 10 minutes
              toast.error("Please wait 10 minutes before placing another order with the same link for this service.");
              setSubmitting(false);
              return;
            }
          }
        }
      }

      // 1. Show the loading toast immediately
      const sendingToastId = toast.loading("Processing order with provider panel...");

      // Helper function to process order through the real-time database pipeline
      const handleFirestoreFallbackOrder = async (fallbackToastId: string | number) => {
        try {
          const orderId = "ord_" + Date.now() + "_" + Math.random().toString(36).substring(2, 7);
          console.log(`[CORS Fallback] Creating order ${orderId} directly in Firestore...`);

          const orderDocRef = doc(db, "orders", orderId);
          await setDoc(orderDocRef, {
            userId: user.uid,
            userEmail: user.email || "",
            courseId: selectedCourse.id,
            courseTitle: selectedCourse.title,
            category: selectedCourse.category || "Other",
            quantity: Number(quantity),
            targetLink: targetLink.trim(),
            totalPrice: Number(totalPrice),
            status: "Pending",
            createdAt: new Date(),
            needsProviderTransmission: true,
            providerTransmissionStatus: "pending"
          });

          // Update toast status to waiting
          toast.loading("Google Sandbox CORS proxy active. Routing order securely via direct DB pipeline (15s)...", {
            id: fallbackToastId
          });

          // Listen for updates from real-time database observer
          let solved = false;
          const unsubscribe = onSnapshot(orderDocRef, async (snapshot) => {
            if (!snapshot.exists()) return;
            const data = snapshot.data();
            
            if (data.status === "Completed") {
              solved = true;
              unsubscribe();
              toast.dismiss(fallbackToastId);

              const pId = data.providerOrderId || "SENT";
              
              // Increment counters and timestamps
              try {
                const statsRef = doc(db, "stats", "counters");
                await setDoc(statsRef, { totalOrders: increment(1) }, { merge: true });
                
                const userRef = doc(db, "users", user.uid);
                await setDoc(userRef, { lastOrderedAt: serverTimestamp() }, { merge: true });
              } catch (se) {
                console.warn("[FALLBACK] Secondary stats update failed:", se);
              }

              setLastOrder({
                userId: user.uid,
                userEmail: user.email,
                courseId: selectedCourse.id,
                courseTitle: selectedCourse.title,
                category: selectedCourse.category || "Other",
                quantity: Number(quantity),
                targetLink: targetLink.trim(),
                totalPrice: totalPrice,
                status: "Completed",
                providerOrderId: pId,
                createdAt: new Date()
              });

              setIsOrderSuccessOpen(true);
              toast.success(`Success! Order ID: ${pId}`);
              setTargetLink("");
              setQuantity(String(selectedCourse.minLimit));
              setSubmitting(false);

            } else if (data.status === "Failed") {
              solved = true;
              unsubscribe();
              toast.dismiss(fallbackToastId);

              const dbErrorMsg = data.error || "Order dispatch rejected by provider";
              toast.error(`Order Failed: ${dbErrorMsg}`, { duration: 10000 });

              setLastOrder({
                userId: user.uid,
                userEmail: user.email,
                courseId: selectedCourse.id,
                courseTitle: selectedCourse.title,
                category: selectedCourse.category || "Other",
                quantity: Number(quantity),
                targetLink: targetLink.trim(),
                totalPrice: totalPrice,
                status: "Failed",
                error: dbErrorMsg,
                createdAt: new Date()
              });
              setSubmitting(false);
            }
          });

          // Fallback timeout after 30 seconds
          setTimeout(() => {
            if (!solved) {
              unsubscribe();
              toast.dismiss(fallbackToastId);
              toast.error("The background network queue is processing your request. Please check the Dashboard page in a moment for final outcome status.", { duration: 8000 });
              setSubmitting(false);
            }
          }, 30000);

        } catch (dbErr: any) {
          toast.dismiss(fallbackToastId);
          toast.error(`Database transit failed: ${dbErr.message || dbErr}`);
          setSubmitting(false);
        }
      };

      try {
        // 2. Clear pre-existing order state
        setLastOrder(null);

        // 3. Make direct synchronous HTTP POST to backend to place and record order
        const response = await axios.post("/api/proxy-provider", {
          userId: user.uid,
          userEmail: user.email || "",
          courseId: selectedCourse.id,
          courseTitle: selectedCourse.title,
          category: selectedCourse.category || "Other",
          quantity: Number(quantity),
          targetLink: targetLink.trim(),
          totalPrice: totalPrice
        });

        toast.dismiss(sendingToastId);

        if (response.data && response.data.success === true) {
          const pId = response.data.providerOrderId || "SENT";
          
          // Increment total orders counters and last ordered timestamp
          try {
            const statsRef = doc(db, "stats", "counters");
            await setDoc(statsRef, { totalOrders: increment(1) }, { merge: true });
            
            const userRef = doc(db, "users", user.uid);
            await setDoc(userRef, { lastOrderedAt: serverTimestamp() }, { merge: true });
          } catch (statError) {
            console.warn("[SYNC-ORDER] Secondary stats failed to update:", statError);
          }

          // Populate local state for display modal
          setLastOrder({
            userId: user.uid,
            userEmail: user.email,
            courseId: selectedCourse.id,
            courseTitle: selectedCourse.title,
            category: selectedCourse.category || "Other",
            quantity: Number(quantity),
            targetLink: targetLink.trim(),
            totalPrice: totalPrice,
            status: "Completed",
            providerOrderId: pId,
            createdAt: new Date()
          });

          // Open Success Dialog and reset forms
          setIsOrderSuccessOpen(true);
          toast.success(`Success! Order ID: ${pId}`);

          setTargetLink("");
          setQuantity(String(selectedCourse.minLimit));
          setSubmitting(false);
        } else {
          throw new Error(formatErrorMessage(response.data) || "Provider rejected the order");
        }
      } catch (proxyError: any) {
        const failErrorMsg = (proxyError.response?.data ? formatErrorMessage(proxyError.response.data) : null) || formatErrorMessage(proxyError) || "Order transmission failed";
        
        // CORS proxy pre-flight or routing block triggers. Fallback automatically.
        const isNetworkOrHtml = failErrorMsg.toLowerCase().includes("network error") || 
                                failErrorMsg.toLowerCase().includes("<!doctype html") ||
                                failErrorMsg.toLowerCase().includes("<html") ||
                                failErrorMsg.toLowerCase().includes("failed to fetch") ||
                                proxyError.message?.toLowerCase().includes("network error") ||
                                !proxyError.response;

        if (isNetworkOrHtml) {
          console.warn("[API Network Error] Standard HTTP route CORS-blocked by Google Sandbox. Switching to secure fallback direct Firestore queue mechanism...");
          await handleFirestoreFallbackOrder(sendingToastId);
        } else {
          toast.dismiss(sendingToastId);
          toast.error(`Order Failed: ${failErrorMsg}`, { duration: 8000 });

          setLastOrder({
            userId: user.uid,
            userEmail: user.email,
            courseId: selectedCourse.id,
            courseTitle: selectedCourse.title,
            category: selectedCourse.category || "Other",
            quantity: Number(quantity),
            targetLink: targetLink.trim(),
            totalPrice: totalPrice,
            status: "Failed",
            error: failErrorMsg,
            createdAt: new Date()
          });
          setSubmitting(false);
        }
      }
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
    if (!screenshot && cleanUtr.length !== 12) {
      toast.error("Please provide a valid 12-digit UTR number");
      return;
    }

    if (!screenshotPreview) {
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

        await runTransaction(db, async (transaction) => {
          const lockRef = doc(db, "utr_locks", cleanUtr);
          const lockSnap = await transaction.get(lockRef);
          
          if (lockSnap.exists()) {
            throw new Error("This UTR has already been submitted.");
          }

          transaction.set(lockRef, {
            userId: user.uid,
            createdAt: serverTimestamp(),
            amount: Number(depositAmount)
          });

          const depositRef = doc(collection(db, "deposits"));
          transaction.set(depositRef, {
            userId: user.uid,
            userEmail: user.email || "not-provided",
            amount: Number(depositAmount),
            utr: cleanUtr,
            screenshotUrl: screenshotPreview,
            status: "pending",
            createdAt: serverTimestamp(),
            source: "client-transaction-fallback"
          });
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

  const upiLink = paymentSettings?.upiId 
    ? `upi://pay?pa=${paymentSettings.upiId}&pn=${encodeURIComponent(paymentSettings.merchantName || "SMM Panel")}&am=${depositAmount}&cu=INR`
    : "";

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
              onClick={() => setIsAddFundsOpen(true)}
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
                    iconUrl={courses.find(c => c.category === selectedCategory)?.iconUrl}
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
                        iconUrl={courses.find(c => c.category === cat)?.iconUrl}
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
                    iconUrl={selectedCourse?.iconUrl || courses.find(c => c.category === selectedCategory)?.iconUrl}
                    className="w-5 h-5" 
                  />
                </div>
                <span className="font-semibold flex-1 leading-tight whitespace-normal break-words py-1 pr-1 flex items-center gap-1.5 flex-wrap">
                  {selectedCourse ? (
                    <>
                      {selectedCourse.isPackage && (
                        <Badge className="bg-primary/20 text-primary border-none text-[8px] h-3.5 px-1.5 font-bold uppercase shrink-0">
                          Package
                        </Badge>
                      )}
                      {selectedCourse.isPackage 
                        ? selectedCourse.title 
                        : `${selectedCourse.title} - ₹${selectedCourse.pricePerThousand}/1k`
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
                        iconUrl={service.iconUrl}
                        className="w-4 h-4 shrink-0" 
                      />
                        <div className="min-w-0 pr-2 flex-1">
                          <p className="whitespace-normal leading-tight break-words flex items-center gap-1.5 flex-wrap">
                            {service.title}
                            {service.isPackage && (
                              <Badge className="bg-primary/15 text-primary border-none text-[8px] h-3.5 px-1 font-bold shrink-0">
                                PKG
                              </Badge>
                            )}
                          </p>
                          {!service.isPackage && (
                            <p className="text-[10px] text-gray-400 font-bold mt-0.5">
                              ₹{service.pricePerThousand} per 1000
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
              {selectedCourse.isPackage ? (
                <>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-gray-500">Package Quantity</span>
                    <span className="text-xs font-bold text-primary">{selectedCourse.packageQuantity}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-gray-500">Package Offer Price</span>
                    <span className="text-xs font-bold text-primary">₹{selectedCourse.packagePrice}</span>
                  </div>
                </>
              ) : (
                <>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-gray-500">Rate per 1000</span>
                    <span className="text-xs font-bold text-primary">₹{selectedCourse.pricePerThousand}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-gray-500">Minimum Order</span>
                    <span className="text-xs font-bold">{selectedCourse.minLimit}</span>
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

      <Dialog open={isAddFundsOpen} onOpenChange={setIsAddFundsOpen}>
        <DialogContent className="max-w-[90vw] sm:max-w-md rounded-3xl p-4 sm:p-6 overflow-y-auto max-h-[90vh]">
          <DialogHeader className="pb-2">
            <DialogTitle className="text-lg sm:text-xl font-bold">Add Funds to Wallet</DialogTitle>
            <DialogDescription className="text-xs">
              Enter amount, scan QR, and provide UTR or screenshot.
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

            {depositAmount && Number(depositAmount) > 0 && paymentSettings?.upiId && (
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
                    <label className="text-xs font-bold text-gray-700">2. Transaction ID / UTR (Optional)</label>
                    <Input 
                      placeholder="Optional if screenshot uploaded" 
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
                      <span className="bg-white px-2 text-gray-500">Or Upload Screenshot</span>
                    </div>
                  </div>

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
                      className="flex flex-col items-center justify-center gap-1 p-3 border-2 border-dashed border-gray-200 rounded-2xl cursor-pointer hover:bg-gray-50 transition-colors"
                    >
                      {screenshotPreview ? (
                        <div className="relative w-full">
                          <img src={screenshotPreview} alt="Preview" className="w-full h-24 object-contain rounded-lg" />
                          <div className="absolute top-0 right-0 bg-green-500 text-white p-1 rounded-full">
                            <Check className="w-2 h-2" />
                          </div>
                        </div>
                      ) : (
                        <>
                          <Upload className="w-5 h-5 text-gray-400" />
                          <span className="text-[10px] text-gray-500">Upload payment proof</span>
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
              disabled={isUploading || !depositAmount || Number(depositAmount) <= 0}
            >
              {isUploading ? "Uploading..." : "Confirm Payment"}
            </Button>
          </DialogFooter>
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
                  <span className="font-bold text-gray-700 line-clamp-2 leading-tight">{lastOrder.courseTitle}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-gray-400 font-bold uppercase">Quantity</span>
                  <span className="font-bold text-gray-700">{lastOrder.quantity}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-gray-400 font-bold uppercase">Amount</span>
                  <span className="font-bold text-primary">₹{lastOrder.totalPrice}</span>
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


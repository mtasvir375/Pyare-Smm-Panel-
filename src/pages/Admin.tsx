import { useNavigate } from "react-router-dom";
import { useState, useEffect, useRef } from "react";
import { motion } from "motion/react";
import { 
  Plus, 
  Video, 
  FileText, 
  DollarSign, 
  Users, 
  BarChart3,
  Trash2,
  Edit2,
  PlusCircle,
  QrCode,
  CheckCircle2,
  XCircle,
  ExternalLink,
  Youtube,
  Upload,
  Image as ImageIcon,
  Share2,
  Wallet,
  Search,
  RefreshCw,
  Instagram,
  Facebook,
  Twitter,
  Music2,
  AlertCircle,
  Database,
  ShieldCheck
} from "lucide-react";
import CategoryIcon from "@/components/CategoryIcon";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { dbClient } from "@/lib/dbClient";
import { where, limit, orderBy } from "firebase/firestore";
import { useAuth } from "@/context/AuthContext";
import { toast } from "sonner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import imageCompression from "browser-image-compression";
import axios from "axios";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

export default function Admin() {
  const { user, userProfile: profile, isAdmin, isPaymentAdmin, loading: authLoading } = useAuth() as any;
  const navigate = useNavigate();
  const [courses, setCourses] = useState<any[]>([]);
  const [orders, setOrders] = useState<any[]>([]);
  const [deposits, setDeposits] = useState<any[]>([]);
  const [allUsers, setAllUsers] = useState<any[]>([]);
  const [totalUserCount, setTotalUserCount] = useState<number>(0);
  const [totalOrdersCount, setTotalOrdersCount] = useState<number>(0);
  const [withdrawals, setWithdrawals] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [activeTab, setActiveTab] = useState(isPaymentAdmin && !isAdmin ? "deposits" : "courses");
  const [fetchedTabs, setFetchedTabs] = useState<Set<string>>(new Set());
  const [courseSearch, setCourseSearch] = useState("");
  const [courseCategoryFilter, setCourseCategoryFilter] = useState("All");
  const [totalActiveServices, setTotalActiveServices] = useState<number>(0);

  const handleSyncStats = async () => {
    if (!user?.uid || isSyncing) return;

    // QUOTA GUARD: Cooldown to prevent spamming server counts
    const lastSync = localStorage.getItem('last_admin_sync');
    const now = Date.now();
    if (lastSync && (now - parseInt(lastSync) < 5 * 60 * 1000)) {
      toast.error("कृपया 5 मिनट रुकें (कोटा बचाने के लिए लिमिट लगी है)");
      return;
    }

    setIsSyncing(true);
    const syncToast = toast.loading("Syncing counts... (कोटा सुरक्षित कर रहे हैं)");
    try {
      const [uCount, oCount] = await Promise.all([
        dbClient.getTableCount("users"),
        dbClient.getTableCount("orders")
      ]);
      
      // SYNC READ-WRITE OPTIMIZATION
      await dbClient.saveDoc("stats", "counters", { 
        totalUsers: uCount, 
        totalOrders: oCount,
        updatedAt: new Date().toISOString()
      });

      setTotalUserCount(uCount);
      setTotalOrdersCount(oCount);
      localStorage.setItem('last_admin_sync', now.toString());
      toast.success(`Synced! ${uCount} Users, ${oCount} Orders`, { id: syncToast });
    } catch (err: any) {
      console.error("Sync error:", err);
      toast.error("Failed to sync counts", { id: syncToast });
    } finally {
      setIsSyncing(false);
    }
  };
  const [newCourseTitle, setNewCourseTitle] = useState("");
  const [newCoursePrice, setNewCoursePrice] = useState("");
  const [newCourseMinLimit, setNewCourseMinLimit] = useState("1000");
  const [newCourseType, setNewCourseType] = useState("likes");
  const [newCourseCategory, setNewCourseCategory] = useState("Instagram");
  const [newCourseProviderServiceId, setNewCourseProviderServiceId] = useState("");
  const [preventDuplicateLink, setPreventDuplicateLink] = useState(false);
  const [newCourseIsPackage, setNewCourseIsPackage] = useState(false);
  const [newCoursePackagePrice, setNewCoursePackagePrice] = useState("");
  const [newCoursePackageQuantity, setNewCoursePackageQuantity] = useState("1000");
  const [qrUrl, setQrUrl] = useState("");
  const [upiId, setUpiId] = useState("");
  const [merchantName, setMerchantName] = useState("");
  const [providerApiUrl, setProviderApiUrl] = useState("");
  const [providerApiKey, setProviderApiKey] = useState("");
  const [backendApiUrl, setBackendApiUrl] = useState("");
  const [whatsappLink, setWhatsappLink] = useState("");
  const [whatsappChatNumber, setWhatsappChatNumber] = useState("");
  const [guideVideoUrl, setGuideVideoUrl] = useState("");
  const [razorpayEnabled, setRazorpayEnabled] = useState(false);
  const [razorpayKeyId, setRazorpayKeyId] = useState("");
  const [razorpayKeySecret, setRazorpayKeySecret] = useState("");
  const [phonepeEnabled, setPhonepeEnabled] = useState(false);
  const [phonepeMerchantId, setPhonepeMerchantId] = useState("");
  const [phonepeSaltKey, setPhonepeSaltKey] = useState("");
  const [phonepeSaltIndex, setPhonepeSaltIndex] = useState("1");
  const [phonepeEnv, setPhonepeEnv] = useState("sandbox");
  const [paytmEnabled, setPaytmEnabled] = useState(false);
  const [paytmMid, setPaytmMid] = useState("");
  const [paytmMerchantKey, setPaytmMerchantKey] = useState("");
  const [paytmEnv, setPaytmEnv] = useState("sandbox");

  const [customGateway1Enabled, setCustomGateway1Enabled] = useState(false);
  const [customGateway1Name, setCustomGateway1Name] = useState("");
  const [customGateway1Key, setCustomGateway1Key] = useState("");
  const [customGateway1Secret, setCustomGateway1Secret] = useState("");
  const [customGateway1Url, setCustomGateway1Url] = useState("");

  const [customGateway2Enabled, setCustomGateway2Enabled] = useState(false);
  const [customGateway2Name, setCustomGateway2Name] = useState("");
  const [customGateway2Key, setCustomGateway2Key] = useState("");
  const [customGateway2Secret, setCustomGateway2Secret] = useState("");
  const [customGateway2Url, setCustomGateway2Url] = useState("");
  const [qrAutoEnabled, setQrAutoEnabled] = useState(false);
  const [qrAutoProvider, setQrAutoProvider] = useState("smmqr");
  const [qrAutoApiKey, setQrAutoApiKey] = useState("");
  const [qrAutoToken, setQrAutoToken] = useState("");
  const [qrAutoUrl, setQrAutoUrl] = useState("");
  const [providers, setProviders] = useState<any[]>([]);
  const [newProviderName, setNewProviderName] = useState("");
  const [newProviderApiUrl, setNewProviderApiUrl] = useState("");
  const [newProviderApiKey, setNewProviderApiKey] = useState("");
  const [newCourseProviderId, setNewCourseProviderId] = useState("");
  const [savingQr, setSavingQr] = useState(false);
  const [qrFile, setQrFile] = useState<File | null>(null);
  const [userSearch, setUserSearch] = useState("");
  const [editingUser, setEditingUser] = useState<any>(null);
  const [newBalance, setNewBalance] = useState("");
  const [selectedScreenshot, setSelectedScreenshot] = useState<string | null>(null);
  const [checkingStatus, setCheckingStatus] = useState(false);
  const statusIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const lastCheckedRef = useRef<number>(0);
  const [newCourseIcon, setNewCourseIcon] = useState<string | null>(null);
  const [uploadingIcon, setUploadingIcon] = useState(false);

  const [providerToDelete, setProviderToDelete] = useState<any>(null);
  const [processingActions, setProcessingActions] = useState<Set<string>>(new Set());

  const checkOrdersStatus = async (force = false) => {
    if (checkingStatus || !isAdmin) return;
    
    // Use local throttle instead of distributed lock write to save money
    // Increased throttle to 30 minutes to save quota as per user request
    const now = Date.now();
    if (!force && lastCheckedRef.current && (now - lastCheckedRef.current < 30 * 60 * 1000)) { 
      return;
    }
    
    setCheckingStatus(true);
    lastCheckedRef.current = now;
    try {
      let updatedCount = 0;
      // Filter strictly for tasks that need check
      const ordersToProcess = await dbClient.getDocs("orders", [
        where("status", "in", ["processing", "pending", "in progress"]),
        limit(5)
      ]);

      for (const order of ordersToProcess || []) {
        if (order.providerOrderId || order.provider_order_id) {
          try {
            // Use the optimized sync endpoint
            const response = await axios.post("/api/sync-order-status", {
              orderId: order.id
            });

            // If updated correctly by server, increment count for UI feedback
            if (response.data.success && response.data.updated) {
              updatedCount++;
            }
          } catch (err) {
            console.error("Error checking status for order:", order.id);
          }
        }
      }
      if (updatedCount > 0) toast.success(`${updatedCount} orders updated`);
    } catch (error) {
      console.error("Error in checkOrdersStatus:", error);
    } finally {
      setCheckingStatus(false);
    }
  };

  const [lastFetchTime, setLastFetchTime] = useState(0);
  const [lastSearchTime, setLastSearchTime] = useState(0);

  const [lastStatsFetchTime, setLastStatsFetchTime] = useState(0);

  const fetchDashboardStats = async (force = false) => {
    // We only fetch stats if they are useful. Since totalEarnings is removed, 
    // we just use the sync button to get counts from server instead of constant reads.
    return;
  };

  const fetchTabData = async (tab: string, force = false) => {
    if (!user || isRefreshing) return;
    // Strictly prevent re-fetching if already fetched within this session, including users tab
    if (!force && fetchedTabs.has(tab)) return;

    setIsRefreshing(true);
    setLoading(true);
    try {
      if (tab === "courses") {
        try {
          const count = await dbClient.getTableCount("courses");
          setTotalActiveServices(count);
        } catch (cErr) {
          console.error("Error getting courses count:", cErr);
        }

        const constraints: any[] = [];
        if (courseCategoryFilter && courseCategoryFilter !== "All") {
          constraints.push(where("category", "==", courseCategoryFilter));
        }
        constraints.push(orderBy("createdAt", "desc"));
        constraints.push(limit(40)); // Strict limit to prevent reading 7,000+ courses

        let coursesList = await dbClient.getDocs("courses", constraints);

        if (courseSearch.trim()) {
          const sTerm = courseSearch.toLowerCase();
          coursesList = coursesList.filter((c: any) => 
            (c.title || "").toLowerCase().includes(sTerm) || 
            (c.category || "").toLowerCase().includes(sTerm) ||
            (c.id || "").toLowerCase().includes(sTerm)
          );
        }

        // Sort by updatedAt descending (preferred), fallback to createdAt descending
        const getTimestamp = (item: any) => {
          const val = item.updatedAt || item.updated_at || item.createdAt || item.created_at;
          if (!val) return 0;
          if (typeof val.toDate === "function") return val.toDate().getTime();
          if (typeof val.seconds === "number") return val.seconds * 1000;
          if (val._seconds !== undefined) return val._seconds * 1000;
          const t = new Date(val).getTime();
          return isNaN(t) ? 0 : t;
        };
        coursesList.sort((a: any, b: any) => getTimestamp(b) - getTimestamp(a));

        setCourses(coursesList);
        const providersList = await dbClient.getProviders();
        setProviders(providersList);
      } else if (tab === "orders" && isAdmin) {
        const ordersList = await dbClient.getOrdersAdmin(50);
        setOrders(ordersList);
      } else if (tab === "deposits") {
        const depositsList = await dbClient.getDepositsAdmin(50);
        setDeposits(depositsList);
      } else if (tab === "users" && isAdmin) {
        await handleSearchUser(force);
      } else if (tab === "providers" && isAdmin) {
        const providersList = await dbClient.getProviders();
        setProviders(providersList);
      } else if (tab === "settings" && isAdmin) {
        const settingsData = await dbClient.getDoc("settings", "payment");
        if (settingsData) {
          setQrUrl(settingsData.paymentQrUrl || "");
          setUpiId(settingsData.upiId || "");
          setMerchantName(settingsData.merchantName || "");
          setProviderApiUrl(settingsData.providerApiUrl || "");
          setProviderApiKey(settingsData.providerApiKey || "");
          setWhatsappLink(settingsData.whatsappLink || "");
          setWhatsappChatNumber(settingsData.whatsappChatNumber || "");
          setGuideVideoUrl(settingsData.guideVideoUrl || "");
          setRazorpayEnabled(settingsData.razorpayEnabled || false);
          setRazorpayKeyId(settingsData.razorpayKeyId || "");
          setRazorpayKeySecret(settingsData.razorpayKeySecret || "");
          setPhonepeEnabled(settingsData.phonepeEnabled || false);
          setPhonepeMerchantId(settingsData.phonepeMerchantId || "");
          setPhonepeSaltKey(settingsData.phonepeSaltKey || "");
          setPhonepeSaltIndex(settingsData.phonepeSaltIndex || "1");
          setPhonepeEnv(settingsData.phonepeEnv || "sandbox");
          setPaytmEnabled(settingsData.paytmEnabled || false);
          setPaytmMid(settingsData.paytmMid || "");
          setPaytmMerchantKey(settingsData.paytmMerchantKey || "");
          setPaytmEnv(settingsData.paytmEnv || "sandbox");

          setCustomGateway1Enabled(settingsData.customGateway1Enabled || false);
          setCustomGateway1Name(settingsData.customGateway1Name || "");
          setCustomGateway1Key(settingsData.customGateway1Key || "");
          setCustomGateway1Secret(settingsData.customGateway1Secret || "");
          setCustomGateway1Url(settingsData.customGateway1Url || "");

          setCustomGateway2Enabled(settingsData.customGateway2Enabled || false);
          setCustomGateway2Name(settingsData.customGateway2Name || "");
          setCustomGateway2Key(settingsData.customGateway2Key || "");
          setCustomGateway2Secret(settingsData.customGateway2Secret || "");
          setCustomGateway2Url(settingsData.customGateway2Url || "");
          
          setQrAutoEnabled(settingsData.qrAutoEnabled || false);
          setQrAutoProvider(settingsData.qrAutoProvider || "smmqr");
          setQrAutoApiKey(settingsData.qrAutoApiKey || "");
          setQrAutoToken(settingsData.qrAutoToken || "");
          setQrAutoUrl(settingsData.qrAutoUrl || "");
          
          const savedBackendUrl = settingsData.backendApiUrl || "";
          const activeBackendUrl = window.location.origin;
          if (!savedBackendUrl || savedBackendUrl.includes("ais-dev-") || savedBackendUrl.includes("ais-pre-")) {
            setBackendApiUrl(activeBackendUrl);
          } else {
            setBackendApiUrl(savedBackendUrl);
          }
        }
      }
      setFetchedTabs(prev => {
        const next = new Set(prev);
        next.add(tab);
        return next;
      });
      setIsRefreshing(false);
      return;
    } catch (error) {
      console.error(`Error fetching tab ${tab}:`, error);
    } finally {
      setIsRefreshing(false);
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!authLoading && !user) {
      toast.error("Please login to access admin panel");
      navigate("/login");
    } else if (!authLoading && user && !isAdmin && !isPaymentAdmin) {
      toast.error("Unauthorized access");
      navigate("/");
    }
  }, [user, isAdmin, isPaymentAdmin, authLoading]);

  // Automatic data fetching has been disabled to protect Firebase Read limits.
  // The admin must manually click 'Load Data' on each tab to fetch data on-demand.
  const renderTabPlaceholder = (tabName: string, label: string) => {
    return (
      <div className="flex justify-center items-center py-12 px-4">
        <Card className="border border-dashed border-gray-200 bg-gray-50/50 rounded-2xl p-8 text-center max-w-md w-full shadow-sm">
          <CardContent className="space-y-4 pt-6">
            <div className="mx-auto w-12 h-12 bg-amber-50 rounded-full flex items-center justify-center text-amber-500 mb-2">
              <AlertCircle className="w-6 h-6" />
            </div>
            <h3 className="text-base font-bold text-gray-800">डेटा सुरक्षित मोड (Data Safe Mode)</h3>
            <p className="text-xs text-gray-500 leading-relaxed">
              आपका Firebase रीड्स (Reads) कोटा बचाने के लिए {label} डेटा ऑटोमैटिक लोड नहीं किया गया है। 
              जब आपको ज़रूरत हो, तभी नीचे दिए बटन पर क्लिक करके लोड करें।
            </p>
            <Button 
              onClick={() => fetchTabData(tabName, true)}
              disabled={isRefreshing}
              className="w-full bg-primary hover:bg-primary/90 text-white rounded-xl py-2 font-medium text-xs flex items-center justify-center gap-2 mt-4"
            >
              <RefreshCw className={cn("w-4 h-4", isRefreshing && "animate-spin")} />
              डेटा लोड करें (Load {label})
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  };

  useEffect(() => {
    // We removed auto-sync on mount to save significant Read/Write quota.
    // Sync will only happen when admin clicks the manual "Refresh" button.
    return () => {
      if (statusIntervalRef.current) {
        clearInterval(statusIntervalRef.current);
        statusIntervalRef.current = null;
      }
    };
  }, [authLoading, user, isAdmin]);

  const [testingApi, setTestingApi] = useState(false);

  const [testingProviders, setTestingProviders] = useState<Set<string>>(new Set());

  const handleTestProviderApi = async (providerId?: string) => {
    if (providerId) {
      setTestingProviders(prev => new Set(prev).add(providerId));
    } else {
      setTestingApi(true);
    }
    
    try {
      const response = await axios.post('/api/test-provider', { providerId });
      if (response.data.success) {
        toast.success(`Connected! Balance: ${response.data.balance} ${response.data.currency || 'INR'}`);
      } else {
        toast.error(response.data.error || "Connection failed");
      }
    } catch (error: any) {
      const hostname = window.location.hostname;
      const isCustomDomain = !hostname.includes("run.app") && !hostname.includes("localhost") && !hostname.includes("127.0.0.1");
      let errorMessage = error.response?.data?.error || error.message || "Connection failed";
      
      if (isCustomDomain && errorMessage.toLowerCase().includes("network error")) {
        errorMessage = "Network Error: Google's Sandbox blocks API calls from custom domains on Vercel. Please open the site through the Google AI Studio preview window to configure and test provider APIs!";
      }
      toast.error(`Error: ${errorMessage}`, { duration: 6000 });
    } finally {
      if (providerId) {
        setTestingProviders(prev => {
          const next = new Set(prev);
          next.delete(providerId);
          return next;
        });
      } else {
        setTestingApi(false);
      }
    }
  };

  const handleSaveQr = async () => {
    setSavingQr(true);
    try {
      let base64 = qrUrl;
      if (qrFile) {
        const options = {
          maxSizeMB: 0.1,
          maxWidthOrHeight: 800,
          useWebWorker: true,
        };
        const compressedFile = await imageCompression(qrFile, options);
        base64 = await imageCompression.getDataUrlFromFile(compressedFile);
      }

      const cleanUrl = providerApiUrl.trim();
      const cleanKey = providerApiKey.trim();
      const cleanBackend = backendApiUrl.trim();

      if (cleanBackend.toLowerCase().includes("ais-dev-")) {
        toast.error("You cannot save a development environment URL ('ais-dev-') as the backend! Please use the stable preview URL ('ais-pre-') instead.", {
          description: "This prevents orders from failing when your browser AI Studio tab is closed."
        });
        return;
      }

      await dbClient.saveDoc("settings", "payment", {
        paymentQrUrl: base64,
        upiId: upiId.trim(),
        merchantName: merchantName.trim(),
        providerApiUrl: cleanUrl,
        providerApiKey: cleanKey,
        backendApiUrl: cleanBackend,
        whatsappLink: whatsappLink.trim(),
        whatsappChatNumber: whatsappChatNumber.trim(),
        guideVideoUrl: guideVideoUrl.trim(),
        razorpayEnabled: razorpayEnabled,
        razorpayKeyId: razorpayKeyId.trim(),
        razorpayKeySecret: razorpayKeySecret.trim(),
        phonepeEnabled: phonepeEnabled,
        phonepeMerchantId: phonepeMerchantId.trim(),
        phonepeSaltKey: phonepeSaltKey.trim(),
        phonepeSaltIndex: phonepeSaltIndex.trim(),
        phonepeEnv: phonepeEnv,
        paytmEnabled: paytmEnabled,
        paytmMid: paytmMid.trim(),
        paytmMerchantKey: paytmMerchantKey.trim(),
        paytmEnv: paytmEnv,
        customGateway1Enabled: customGateway1Enabled,
        customGateway1Name: customGateway1Name.trim(),
        customGateway1Key: customGateway1Key.trim(),
        customGateway1Secret: customGateway1Secret.trim(),
        customGateway1Url: customGateway1Url.trim(),
        customGateway2Enabled: customGateway2Enabled,
        customGateway2Name: customGateway2Name.trim(),
        customGateway2Key: customGateway2Key.trim(),
        customGateway2Secret: customGateway2Secret.trim(),
        customGateway2Url: customGateway2Url.trim(),
        qrAutoEnabled: qrAutoEnabled,
        qrAutoProvider: qrAutoProvider,
        qrAutoApiKey: qrAutoApiKey.trim(),
        qrAutoToken: qrAutoToken.trim(),
        qrAutoUrl: qrAutoUrl.trim(),
        updatedAt: new Date().toISOString()
      });
      setQrUrl(base64);
      setProviderApiUrl(cleanUrl);
      setProviderApiKey(cleanKey);
      setBackendApiUrl(cleanBackend);
      setQrFile(null);
      import("@/lib/cache").then(mod => mod.clearCache());
      toast.success("Global Settings updated!");
    } catch (error: any) {
      toast.error(`Error saving settings: ${error.message}`);
    } finally {
      setSavingQr(false);
    }
  };

  const [isSearchingUser, setIsSearchingUser] = useState(false);

  const handleSearchUser = async (force = false) => {
    if (isSearchingUser) return;
    
    const now = Date.now();
    // Throttle ALL searches (including with text) to once every 1 minute to prevent re-fetch loops
    // Throttle empty searches to once every 10 minutes
    const throttleTime = userSearch ? 60000 : 600000;
    if (!force && (now - lastSearchTime < throttleTime) && lastSearchTime !== 0) return;

    setIsSearchingUser(true);
    setLastSearchTime(now);
    try {
      if (!userSearch) {
        // Simple query for latest users
        const recentUsers = await dbClient.getDocs("users", [
          orderBy("createdAt", "desc"),
          limit(15)
        ]);
        setAllUsers(recentUsers || []);
      } else {
        const searchTerm = userSearch.toLowerCase().trim();
        const searchResults = await dbClient.getDocs("users", [
          where("email", ">=", searchTerm),
          where("email", "<=", searchTerm + "\uf8ff"),
          limit(20)
        ]);
        if (searchResults && searchResults.length === 0) {
          toast.error("No users found matching that term");
        } else if (searchResults) {
          toast.success(`Found ${searchResults.length} users`);
        }
        setAllUsers(searchResults || []);
      }
    } catch (err) {
      console.error("Search error:", err);
      toast.error("Failed to search users");
    } finally {
      setIsSearchingUser(false);
    }
  };

  const handleOrderAction = async (order: any, status: 'approved' | 'cancelled') => {
    if (processingActions.has(order.id)) return;
    setProcessingActions(prev => new Set(prev).add(order.id));

    try {
      if (status === 'cancelled') {
        const uId = order.userId || order.user_id;
        const userProfile = await dbClient.getUserProfile(uId);
        if (userProfile) {
          const currentBalance = Number(userProfile.balance) || 0;
          await dbClient.updateUserProfile(uId, {
            balance: currentBalance + Number(order.totalPrice || order.total_price)
          });
        }
      }

      await dbClient.updateDoc("orders", order.id, { 
        status, 
        updatedAt: new Date().toISOString() 
      });
      setOrders(prev => prev.filter(o => o.id !== order.id));
      toast.success(`Order ${status}!`);
    } catch (error: any) {
      toast.error(`Error updating order: ${error.message}`);
    } finally {
      setProcessingActions(prev => {
        const next = new Set(prev);
        next.delete(order.id);
        return next;
      });
    }
  };

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

  const handleRetryProvider = async (order: any) => {
    try {
      toast.info("Retrying provider API...");
      
      let pId = "";
      let orderProcessed = false;
      let responseBody: any = null;

      try {
        const response = await axios.post("/api/proxy-provider", {
          orderId: order.id,
          courseId: order.serviceId || order.service_id,
          targetLink: order.targetLink || order.target_link,
          quantity: order.quantity
        });

        responseBody = response.data;
        const isHtmlResponse = typeof responseBody === "string" && (
          responseBody.trim().startsWith("<") || 
          responseBody.includes("<!DOCTYPE") || 
          responseBody.includes("<html")
        );

        if (isHtmlResponse || !responseBody || responseBody.success === false) {
          throw new Error("PROX_REJECT");
        } else {
          pId = responseBody.providerOrderId;
          orderProcessed = true;
        }
      } catch (proxyError) {
        console.log("[ADMIN-RETRY] Proxy request blocked. Attempting direct CORS-friendly admin retry...");
        
        // 1. Fetch Course details
        const sId = order.serviceId || order.service_id;
        const c = await dbClient.getDoc("courses", sId);
        if (!c) {
          throw new Error(`Service configuration with ID "${sId}" does not exist in the database.`);
        }

        // 2. Fetch Settings
        const s = await dbClient.getDoc("settings", "payment") || {};

        // 3. Resolve API credentials
        let pUrl = (s.providerApiUrl || "").trim() || "https://smmbin.com/api/v2";
        let pKey = (s.providerApiKey || "").trim();

        if (c.providerId && c.providerId !== "global") {
          const pData = await dbClient.getDoc("providers", c.providerId);
          if (pData) {
            pUrl = (pData.apiUrl || "").trim();
            pKey = (pData.apiKey || "").trim();
          }
        }

        if (!pKey) {
          throw new Error("SMM Provider key not found or not configured.");
        }

        const params = new URLSearchParams();
        params.append("key", pKey);
        params.append("action", "add");
        params.append("service", String(c.providerServiceId).trim());
        params.append("link", String(order.targetLink || order.target_link).trim());
        params.append("quantity", String(order.quantity).trim());

        let directRes;
        try {
          console.log("[ADMIN-RETRY-FALLBACK] Connecting directly to provider API...");
          directRes = await axios.post(pUrl, params, {
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            timeout: 10000
          });
        } catch (corsErr) {
          console.warn("[ADMIN-RETRY-FALLBACK] Direct link failed (CORS). Trying CORS-Proxy wrapper...");
          const proxiedUrl = `https://corsproxy.io/?${encodeURIComponent(pUrl)}`;
          try {
            directRes = await axios.post(proxiedUrl, params, {
              headers: { "Content-Type": "application/x-www-form-urlencoded" },
              timeout: 10000
            });
          } catch (proxyErr) {
            console.warn("[ADMIN-RETRY-FALLBACK] CORS proxy failed. Falling back to background queue...");
          }
        }

        const resData = directRes?.data;
        let providerOrderId = resData?.order || resData?.order_id || resData?.orderid || resData?.orderId || resData?.id || resData?.ID;
        const isStatusSuccess = resData?.status === "success" || 
                                resData?.status === "Success" || 
                                resData?.success === true || 
                                resData?.success === "true" ||
                                resData?.msg?.toLowerCase().includes("success") ||
                                resData?.message?.toLowerCase().includes("success");

        if (!providerOrderId && typeof resData === 'number') {
          providerOrderId = String(resData);
        }

        if (providerOrderId || isStatusSuccess) {
          pId = providerOrderId ? String(providerOrderId) : "SENT_NO_ID";
          orderProcessed = true;
          
      await dbClient.updateDoc("orders", order.id, {
        providerOrderId: pId,
        status: "Completed",
        error: null,
        providerRawResponse: JSON.stringify(resData).substring(0, 800),
        updatedAt: new Date().toISOString()
      });
        } else {
          // Put the order into wait-queue for background listener to re-process securely
          console.log("[ADMIN-RETRY] Local direct retry failed. Queueing order for Cloud Run background worker...");
          await dbClient.updateDoc("orders", order.id, {
            needsProviderTransmission: true,
            providerTransmissionStatus: "pending",
            providerOrderId: null,
            error: null,
            updatedAt: new Date().toISOString()
          });
          
          // Show successful fallback retry queue toast
          toast.success("Order queued successfully in the background queue!");
          return;
        }
      }

      if (orderProcessed) {
        await dbClient.updateDoc("orders", order.id, {
          providerOrderId: pId,
          status: "Completed",
          error: null,
          updated_at: new Date().toISOString()
        });
        toast.dismiss();
        toast.success(`Order successfully sent to provider! ID: ${pId}`);
      }
    } catch (error: any) {
      let errorMessage = "Failed to retry provider API";
      let rawRes = null;
      if (error.response?.data) {
        errorMessage = formatErrorMessage(error.response.data);
        rawRes = JSON.stringify(error.response.data);
      } else {
        errorMessage = error.message;
      }
      
      try {
        await dbClient.updateDoc("orders", order.id, {
          error: errorMessage,
          providerRawResponse: rawRes,
          updatedAt: new Date().toISOString()
        });
      } catch (err) {}
      
      toast.error(errorMessage);
    }
  };

  const handleDepositAction = async (deposit: any, status: 'approved' | 'cancelled') => {
    if (processingActions.has(deposit.id)) return;
    setProcessingActions(prev => new Set(prev).add(deposit.id));

    try {
      if (status === 'approved') {
        const uId = deposit.userId || deposit.user_id;
        const depositAmount = Number(deposit.amount);

        // Fetch current user profile first
        const userProfile = await dbClient.getUserProfile(uId);
        if (!userProfile) throw new Error("User not found");

        const newBalance = Number(userProfile.balance || 0) + depositAmount;

        // Perform updates (sequentially is okay here for simplicity in admin panel)
        await dbClient.updateUserProfile(uId, { balance: newBalance });
        await dbClient.updateDoc("deposits", deposit.id, {
          status: 'approved',
          updatedAt: new Date().toISOString(),
          processedBy: user?.email
        });
      } else {
        await dbClient.updateDoc("deposits", deposit.id, { 
          status: 'cancelled',
          updatedAt: new Date().toISOString(),
          processedBy: user?.email
        });
      }

      setDeposits(prev => prev.filter(d => d.id !== deposit.id));
      toast.success(`Deposit ${status}!`);
    } catch (error: any) {
      console.error("Deposit Error:", error);
      toast.error(`Error: ${error.message}`);
    } finally {
      setProcessingActions(prev => {
        const next = new Set(prev);
        next.delete(deposit.id);
        return next;
      });
    }
  };

  // handleWithdrawalAction removed

  const handleUpdateUserBalance = async () => {
    if (!editingUser || newBalance === "") return;
    try {
      await dbClient.updateDoc("users", editingUser.id, {
        balance: Number(newBalance)
      });
      toast.success("User finances updated!");
      setEditingUser(null);
      setNewBalance("");
    } catch (error: any) {
      toast.error(`Error updating user: ${error.message}`);
    }
  };

  const handleCreateProvider = async () => {
    if (!newProviderName || !newProviderApiUrl || !newProviderApiKey) {
      toast.error("Please fill all provider fields");
      return;
    }
    try {
      const cleanUrl = newProviderApiUrl.trim();
      const cleanKey = newProviderApiKey.trim();
      
      await dbClient.addDoc("providers", {
        name: newProviderName.trim(),
        apiUrl: cleanUrl,
        apiKey: cleanKey,
        createdAt: new Date().toISOString()
      });
      toast.success("Provider added successfully!");
      setNewProviderName("");
      setNewProviderApiUrl("");
      setNewProviderApiKey("");
      fetchTabData(activeTab, true);
    } catch (error: any) {
      toast.error(`Error adding provider: ${error.message}`);
    }
  };

  const confirmDeleteProvider = async () => {
    if (!providerToDelete) return;
    try {
      await dbClient.deleteDoc("providers", providerToDelete.id);
      toast.success("Provider deleted!");
      fetchTabData(activeTab, true);
    } catch (error: any) {
      toast.error(`Error deleting provider: ${error.message}`);
    } finally {
      setProviderToDelete(null);
    }
  };

  const handleIconUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setUploadingIcon(true);
      try {
        const options = {
          maxSizeMB: 0.1,
          maxWidthOrHeight: 200,
          useWebWorker: true
        };
        const compressedFile = await imageCompression(file, options);
        const reader = new FileReader();
        reader.onloadend = () => {
          setNewCourseIcon(reader.result as string);
          setUploadingIcon(false);
        };
        reader.readAsDataURL(compressedFile);
      } catch (error) {
        toast.error("Failed to compress icon");
        setUploadingIcon(false);
      }
    }
  };

  const handleCreateCourse = async () => {
    if (newCourseIsPackage) {
      if (!newCourseTitle || !newCoursePackagePrice || !newCoursePackageQuantity || !newCourseProviderServiceId || !newCourseProviderId) {
        toast.error("Please fill in all package fields (including Price, Quantity, Provider and Service ID)");
        return;
      }
    } else {
      if (!newCourseTitle || !newCoursePrice || !newCourseMinLimit || !newCourseProviderServiceId || !newCourseProviderId) {
        toast.error("Please fill in all fields (including Price, Min Limit, Provider and Service ID)");
        return;
      }
    }

    try {
      const pkgPrice = Number(newCoursePackagePrice);
      const pkgQty = Number(newCoursePackageQuantity);
      const computedPricePerThousand = newCourseIsPackage 
        ? Number(((pkgPrice / pkgQty) * 1000).toFixed(4)) 
        : Number(newCoursePrice);

      await dbClient.addDoc("courses", {
        title: newCourseTitle,
        category: newCourseCategory,
        pricePerThousand: computedPricePerThousand,
        minLimit: newCourseIsPackage ? pkgQty : Number(newCourseMinLimit),
        serviceType: newCourseType,
        providerId: newCourseProviderId,
        providerServiceId: newCourseProviderServiceId,
        preventDuplicateLink: preventDuplicateLink,
        iconUrl: newCourseIcon || null,
        status: "published",
        description: newCourseIsPackage 
          ? `Offer Price: ₹${newCoursePackagePrice} for ${newCoursePackageQuantity} fixed quantity` 
          : `High quality ${newCourseType} service`,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        isPackage: newCourseIsPackage,
        packagePrice: newCourseIsPackage ? pkgPrice : null,
        packageQuantity: newCourseIsPackage ? pkgQty : null,
      });
      import("@/lib/cache").then(mod => mod.clearCache());
      toast.success("Service added successfully!");
      setNewCourseTitle("");
      setNewCoursePrice("");
      setNewCourseMinLimit("1000");
      setNewCourseProviderServiceId("");
      setPreventDuplicateLink(false);
      setNewCourseIcon(null);
      setNewCourseIsPackage(false);
      setNewCoursePackagePrice("");
      setNewCoursePackageQuantity("1000");
    } catch (error: any) {
      toast.error(`Error adding course: ${error.message}`);
    }
  };

  const [editingCourse, setEditingCourse] = useState<any>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editPrice, setEditPrice] = useState("");
  const [editMinLimit, setEditMinLimit] = useState("");
  const [editProviderId, setEditProviderId] = useState("");
  const [editServiceId, setEditServiceId] = useState("");
  const [editCategory, setEditCategory] = useState("Other");
  const [editType, setEditType] = useState("likes");
  const [editPreventDuplicate, setEditPreventDuplicate] = useState(false);
  const [editIsPackage, setEditIsPackage] = useState(false);
  const [editPackagePrice, setEditPackagePrice] = useState("");
  const [editPackageQuantity, setEditPackageQuantity] = useState("");

  const startEditCourse = (course: any) => {
    setEditingCourse(course);
    setEditTitle(course.title);
    setEditPrice(String(course.pricePerThousand || course.price || ""));
    setEditMinLimit(String(course.minLimit || course.min_limit || ""));
    setEditProviderId(course.providerId || course.provider_id || "");
    setEditServiceId(course.providerServiceId || course.provider_service_id || "");
    setEditCategory(course.category || "Other");
    setEditType(course.serviceType || course.service_type || "likes");
    setEditPreventDuplicate(!!(course.preventDuplicateLink || course.prevent_duplicate_link));
    setEditIsPackage(!!(course.isPackage || course.is_package));
    setEditPackagePrice(course.packagePrice ? String(course.packagePrice) : (course.package_price ? String(course.package_price) : ""));
    setEditPackageQuantity(course.packageQuantity ? String(course.packageQuantity) : (course.package_quantity ? String(course.package_quantity) : ""));
  };

  const handleUpdateCourse = async () => {
    if (!editingCourse) return;
    try {
      const pkgPrice = Number(editPackagePrice);
      const pkgQty = Number(editPackageQuantity);
      const computedPricePerThousand = editIsPackage 
        ? Number(((pkgPrice / pkgQty) * 1000).toFixed(4)) 
        : Number(editPrice);

      await dbClient.updateDoc("courses", editingCourse.id, {
        title: editTitle,
        pricePerThousand: computedPricePerThousand,
        minLimit: editIsPackage ? pkgQty : Number(editMinLimit),
        providerId: editProviderId,
        providerServiceId: editServiceId,
        category: editCategory,
        serviceType: editType,
        preventDuplicateLink: editPreventDuplicate,
        isPackage: editIsPackage,
        packagePrice: editIsPackage ? pkgPrice : null,
        packageQuantity: editIsPackage ? pkgQty : null,
        updatedAt: new Date().toISOString()
      });
      import("@/lib/cache").then(mod => mod.clearCache());
      toast.success("Service updated successfully!");
      setEditingCourse(null);
      fetchTabData(activeTab, true);
    } catch (error: any) {
      toast.error(`Error updating course: ${error.message}`);
    }
  };

  const handleDeleteCourse = async (courseId: string) => {
    if (!window.confirm("Are you sure you want to delete this service?")) return;
    try {
      await dbClient.deleteDoc("courses", courseId);
      toast.success("Service deleted!");
      fetchTabData(activeTab, true);
      import("@/lib/cache").then(mod => mod.clearCache());
    } catch (error: any) {
      toast.error(`Error deleting course: ${error.message}`);
    }
  };

  if (authLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh] bg-gray-50/50 rounded-3xl">
        <div className="flex flex-col items-center gap-4">
          <RefreshCw className="w-10 h-10 text-primary animate-spin opacity-40" />
          <p className="text-gray-400 font-bold text-sm uppercase tracking-widest animate-pulse">Verifying Access</p>
        </div>
      </div>
    );
  }

  if (!user || (!isAdmin && !isPaymentAdmin)) {
    return null; // Will be handled by the redirect useEffect
  }

  return (
    <div className="space-y-8 pb-12">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">SMM Admin Panel</h1>
          <p className="text-sm text-gray-500">Manage your services and orders</p>
        </div>
        <div className="flex gap-2">
          <Button 
            onClick={() => fetchTabData(activeTab, true)} 
            disabled={isRefreshing}
            variant="outline"
            className="gap-2 shrink-0 bg-white"
          >
            <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </div>

      <Tabs 
        value={activeTab} 
        onValueChange={setActiveTab}
        className="space-y-6"
      >
        <TabsList className="bg-white border p-1 rounded-2xl h-12 shadow-sm flex overflow-x-auto whitespace-nowrap hide-scrollbar">
          {(!isPaymentAdmin || isAdmin) && (
            <TabsTrigger value="courses" className="rounded-xl px-6">Services</TabsTrigger>
          )}
          {(isAdmin || isPaymentAdmin) && (
            <>
              <TabsTrigger value="deposits" className="rounded-xl px-6">Deposits</TabsTrigger>
            </>
          )}
          {isAdmin && (
            <>
              <TabsTrigger value="users" className="rounded-xl px-6">Users</TabsTrigger>
              <TabsTrigger value="providers" className="rounded-xl px-6">Providers</TabsTrigger>
              <TabsTrigger value="settings" className="rounded-xl px-6">Settings</TabsTrigger>
            </>
          )}
        </TabsList>

        <TabsContent value="courses" className="space-y-8">
          {!fetchedTabs.has("courses") ? (
            renderTabPlaceholder("courses", "Services")
          ) : (
            <>
              <div className="grid gap-4 md:grid-cols-1">
            <Card className="border-none shadow-sm bg-purple-50">
              <CardContent className="p-6 flex items-center gap-4">
                <div className="p-3 bg-purple-500 rounded-2xl">
                  <BarChart3 className="w-6 h-6 text-white" />
                </div>
                <div>
                  <p className="text-sm text-purple-600 font-medium">Active Services (कुल सर्विसेज)</p>
                  <h3 className="text-2xl font-bold text-purple-900">{totalActiveServices || courses.length}</h3>
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="space-y-4">
            <div className="flex flex-col md:flex-row gap-3 items-start md:items-center justify-between pb-2 border-b border-gray-100">
              <div>
                <h2 className="text-lg font-bold">Manage Services</h2>
                <p className="text-xs text-gray-500 mt-0.5">कोटा बचाने के लिए शुरुआत में सिर्फ 30 सेवाएं लोड की गई हैं। अन्य ढूँढ़ने के लिए नीचे सर्च या फ़िल्टर करें।</p>
              </div>
              <div className="flex flex-col sm:flex-row gap-2 w-full md:w-auto items-center">
                <div className="relative w-full sm:w-64">
                  <Input 
                    type="text" 
                    placeholder="सर्च करें (जैसे: Instagram Likes, ID)..." 
                    className="pl-8 bg-white border-gray-200 text-xs h-9 rounded-xl focus-visible:ring-primary focus-visible:ring-offset-0"
                    value={courseSearch}
                    onChange={(e) => setCourseSearch(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && fetchTabData("courses", true)}
                  />
                  <Search className="w-3.5 h-3.5 text-gray-400 absolute left-3 top-3" />
                </div>
                <select 
                  className="w-full sm:w-40 h-9 rounded-xl border border-gray-200 bg-white text-xs px-2.5 focus:outline-none focus:ring-1 focus:ring-primary"
                  value={courseCategoryFilter}
                  onChange={(e) => setCourseCategoryFilter(e.target.value)}
                >
                  <option value="All">All Categories</option>
                  <option value="Instagram">Instagram</option>
                  <option value="Facebook">Facebook</option>
                  <option value="YouTube">YouTube</option>
                  <option value="Telegram">Telegram</option>
                  <option value="Twitter">Twitter</option>
                  <option value="TikTok">TikTok</option>
                  <option value="Other">Other</option>
                </select>
                <Button 
                  className="w-full sm:w-auto h-9 px-4 rounded-xl text-xs flex items-center gap-1 bg-gray-900 text-white hover:bg-gray-800 border-none shadow-sm"
                  onClick={() => fetchTabData("courses", true)}
                  disabled={isRefreshing}
                >
                  <RefreshCw className={cn("w-3 h-3", isRefreshing && "animate-spin")} />
                  Search
                </Button>
              </div>
            </div>
            <div className="space-y-3">
              {loading ? (
                <p className="text-gray-500 italic">Loading services...</p>
              ) : courses.length > 0 ? (
                courses.map((course) => (
                  <Card key={course.id} className="border-none shadow-sm overflow-hidden">
                    <CardContent className="p-4 flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <div className="w-10 h-10 bg-gray-50 rounded-xl flex items-center justify-center">
                          <CategoryIcon 
                            category={course.category} 
                            iconUrl={course.iconUrl || course.icon_url}
                            className="w-5 h-5" 
                          />
                        </div>
                        <div>
                          <h3 className="font-bold text-sm leading-tight whitespace-normal flex items-center gap-1.5 flex-wrap">
                            {course.title}
                            {(course.isPackage || course.is_package) && (
                              <Badge className="bg-primary/15 text-primary hover:bg-primary/20 border-none text-[9px] h-4 px-1.5 font-bold">
                                Package
                              </Badge>
                            )}
                          </h3>
                          <div className="flex items-center gap-3 mt-0.5">
                            <span className="text-xs text-gray-500 font-medium">{course.category || 'Other'}</span>
                            <span className="text-xs text-gray-500 font-medium">•</span>
                            {(course.isPackage || course.is_package) ? (
                              <span className="text-xs text-gray-500 font-medium">₹{course.packagePrice || course.package_price} / {course.packageQuantity || course.package_quantity} qty</span>
                            ) : (
                              <>
                                <span className="text-xs text-gray-500 font-medium">₹{course.price}/1k</span>
                                <span className="text-xs text-gray-500 font-medium">•</span>
                                <span className="text-xs text-gray-500 font-medium">Min: {course.minLimit || course.min_limit}</span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          className="text-gray-400 hover:text-blue-500"
                          onClick={() => startEditCourse(course)}
                        >
                          <Edit2 className="w-4 h-4" />
                        </Button>
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          className="text-gray-400 hover:text-red-500"
                          onClick={() => handleDeleteCourse(course.id)}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))
              ) : (
                <p className="text-gray-500 italic">No services added yet.</p>
              )}
            </div>
          </div>

          <Card className="border-none shadow-sm bg-gray-900 text-white">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <PlusCircle className="w-5 h-5 text-primary" />
                Add New Service
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase tracking-wider text-gray-400">Service Icon (Optional)</label>
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 bg-white/10 rounded-xl border border-white/20 flex items-center justify-center overflow-hidden">
                      {newCourseIcon ? (
                        <img src={newCourseIcon} alt="Icon Preview" className="w-full h-full object-cover" />
                      ) : (
                        <ImageIcon className="w-6 h-6 text-gray-500" />
                      )}
                    </div>
                    <div className="flex-1">
                      <Input 
                        type="file" 
                        accept="image/*" 
                        className="bg-white/10 border-white/20 text-white text-xs h-9"
                        onChange={handleIconUpload}
                        disabled={uploadingIcon}
                      />
                      <p className="text-[10px] text-gray-500 mt-1">Recommended: 1:1 ratio, small size</p>
                    </div>
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase tracking-wider text-gray-400">Service Category</label>
                  <select 
                    className="w-full h-10 rounded-md bg-white/10 border border-white/20 text-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                    value={newCourseCategory}
                    onChange={(e) => setNewCourseCategory(e.target.value)}
                  >
                    <option value="Instagram" className="bg-gray-900">Instagram</option>
                    <option value="Facebook" className="bg-gray-900">Facebook</option>
                    <option value="YouTube" className="bg-gray-900">YouTube</option>
                    <option value="Telegram" className="bg-gray-900">Telegram</option>
                    <option value="Twitter" className="bg-gray-900">Twitter</option>
                    <option value="TikTok" className="bg-gray-900">TikTok</option>
                    <option value="Other" className="bg-gray-900">Other</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase tracking-wider text-gray-400">Service Title</label>
                  <Input 
                    placeholder="e.g. Instagram Real Likes" 
                    className="bg-white/10 border-white/20 text-white"
                    value={newCourseTitle}
                    onChange={(e) => setNewCourseTitle(e.target.value)}
                  />
                </div>
                <div className="md:col-span-2 pt-1 pb-1 flex items-center gap-3">
                  <input
                    type="checkbox"
                    id="newCourseIsPackage"
                    checked={newCourseIsPackage}
                    onChange={(e) => setNewCourseIsPackage(e.target.checked)}
                    className="w-5 h-5 rounded border-white/20 bg-white/10 text-primary focus:ring-primary focus:ring-offset-gray-900 cursor-pointer"
                  />
                  <label htmlFor="newCourseIsPackage" className="text-sm font-medium text-gray-300 cursor-pointer select-none">
                    Is this a Fixed Quantity SMM Package? (e.g. 100k views for ₹45)
                    <span className="block text-xs text-gray-500 font-normal mt-0.5">Check this to offer a fixed quantity at a set offer price instead of calculation per 1000.</span>
                  </label>
                </div>

                {newCourseIsPackage ? (
                  <>
                    <div className="space-y-2">
                      <label className="text-xs font-bold uppercase tracking-wider text-gray-400">Package Special Price (INR)</label>
                      <Input 
                        placeholder="e.g. 45" 
                        className="bg-white/10 border-white/20 text-white"
                        type="number"
                        value={newCoursePackagePrice}
                        onChange={(e) => setNewCoursePackagePrice(e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-bold uppercase tracking-wider text-gray-400">Package Quantity (Fixed)</label>
                      <Input 
                        placeholder="e.g. 100000" 
                        className="bg-white/10 border-white/20 text-white"
                        type="number"
                        value={newCoursePackageQuantity}
                        onChange={(e) => setNewCoursePackageQuantity(e.target.value)}
                      />
                    </div>
                  </>
                ) : (
                  <>
                    <div className="space-y-2">
                      <label className="text-xs font-bold uppercase tracking-wider text-gray-400">Price per 1000 (INR)</label>
                      <Input 
                        placeholder="e.g. 50" 
                        className="bg-white/10 border-white/20 text-white"
                        type="number"
                        value={newCoursePrice}
                        onChange={(e) => setNewCoursePrice(e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-bold uppercase tracking-wider text-gray-400">Minimum Limit</label>
                      <Input 
                        placeholder="e.g. 1000" 
                        className="bg-white/10 border-white/20 text-white"
                        type="number"
                        value={newCourseMinLimit}
                        onChange={(e) => setNewCourseMinLimit(e.target.value)}
                      />
                    </div>
                  </>
                )}
                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase tracking-wider text-gray-400">Service Type</label>
                  <select 
                    className="w-full h-10 rounded-md bg-white/10 border border-white/20 text-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                    value={newCourseType}
                    onChange={(e) => {
                      setNewCourseType(e.target.value);
                      if (e.target.value === 'followers') setNewCourseMinLimit("100");
                      else setNewCourseMinLimit("1000");
                    }}
                  >
                    <option value="likes" className="bg-gray-900">Likes</option>
                    <option value="followers" className="bg-gray-900">Followers</option>
                    <option value="views" className="bg-gray-900">Views</option>
                    <option value="other" className="bg-gray-900">Other</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase tracking-wider text-gray-400">Select Provider</label>
                  <select 
                    className="w-full h-10 rounded-md bg-white/10 border border-white/20 text-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                    value={newCourseProviderId}
                    onChange={(e) => setNewCourseProviderId(e.target.value)}
                  >
                    <option value="" className="bg-gray-900">Select a provider</option>
                    <option value="global" className="bg-gray-900">Global Settings</option>
                    {providers.map(p => (
                      <option key={p.id} value={p.id} className="bg-gray-900">{p.name}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase tracking-wider text-gray-400">Provider Service ID</label>
                  <Input 
                    placeholder="e.g. 1234" 
                    className="bg-white/10 border-white/20 text-white"
                    value={newCourseProviderServiceId}
                    onChange={(e) => setNewCourseProviderServiceId(e.target.value)}
                  />
                </div>
                
                <div className="pt-2 flex items-center gap-3">
                  <input
                    type="checkbox"
                    id="preventDuplicateLink"
                    checked={preventDuplicateLink}
                    onChange={(e) => setPreventDuplicateLink(e.target.checked)}
                    className="w-5 h-5 rounded border-white/20 bg-white/10 text-primary focus:ring-primary focus:ring-offset-gray-900"
                  />
                  <label htmlFor="preventDuplicateLink" className="text-sm font-medium text-gray-300">
                    Prevent Duplicate Target Link
                    <span className="block text-xs text-gray-500 font-normal mt-0.5">If checked, a target link cannot be used again for this service within 25 minutes.</span>
                  </label>
                </div>
              </div>
              <Button className="w-full rounded-xl h-12 font-bold" onClick={handleCreateCourse}>
                <Plus className="w-4 h-4 mr-2" />
                Add Service
              </Button>
            </CardContent>
          </Card>
            </>
          )}
        </TabsContent>

        <TabsContent value="providers" className="space-y-8">
          {!fetchedTabs.has("providers") ? (
            renderTabPlaceholder("providers", "Providers")
          ) : (
            <>
              <div className="space-y-4">
            <h2 className="text-lg font-bold">Manage Providers</h2>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {providers.map((p) => (
                <Card key={p.id} className="border-none shadow-sm bg-white overflow-hidden">
                  <CardContent className="p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <h3 className="font-bold text-lg">{p.name}</h3>
                      <div className="flex items-center gap-1">
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          className="text-blue-500 hover:text-blue-600 h-8 w-8"
                          onClick={() => handleTestProviderApi(p.id)}
                          disabled={testingProviders.has(p.id)}
                        >
                          <RefreshCw className={cn("w-4 h-4", testingProviders.has(p.id) && "animate-spin")} />
                        </Button>
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          className="text-gray-400 hover:text-red-500 h-8 w-8"
                          onClick={() => setProviderToDelete(p)}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                    <div className="space-y-1">
                      <p className="text-[10px] text-gray-400 font-bold uppercase">API URL</p>
                      <p className="text-xs truncate text-gray-600">{p.apiUrl}</p>
                    </div>
                    <div className="space-y-1">
                      <p className="text-[10px] text-gray-400 font-bold uppercase">API Key</p>
                      <p className="text-xs truncate text-gray-600">••••••••••••••••</p>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>

          <Card className="border-none shadow-sm bg-gray-900 text-white">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <PlusCircle className="w-5 h-5 text-primary" />
                Add New Provider
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase tracking-wider text-gray-400">Provider Name</label>
                  <Input 
                    placeholder="e.g. SMM Panel 1" 
                    className="bg-white/10 border-white/20 text-white"
                    value={newProviderName}
                    onChange={(e) => setNewProviderName(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase tracking-wider text-gray-400">API URL</label>
                  <Input 
                    placeholder="https://provider.com/api/v2" 
                    className="bg-white/10 border-white/20 text-white"
                    value={newProviderApiUrl}
                    onChange={(e) => setNewProviderApiUrl(e.target.value)}
                  />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <label className="text-xs font-bold uppercase tracking-wider text-gray-400">API Key</label>
                  <Input 
                    placeholder="Your API Key" 
                    className="bg-white/10 border-white/20 text-white"
                    value={newProviderApiKey}
                    onChange={(e) => setNewProviderApiKey(e.target.value)}
                  />
                </div>
              </div>
              <Button 
                className="w-full rounded-xl py-6 font-bold text-lg shadow-lg shadow-primary/20"
                onClick={handleCreateProvider}
              >
                Add Provider
              </Button>
            </CardContent>
          </Card>
            </>
          )}
        </TabsContent>

        {(isAdmin || isPaymentAdmin) && (
          <>
          <TabsContent value="deposits" className="space-y-4">
            {!fetchedTabs.has("deposits") ? (
              renderTabPlaceholder("deposits", "Deposits")
            ) : (
              <>
                <div className="bg-orange-50 border border-orange-100 p-3 rounded-xl flex items-center gap-3">
                <AlertCircle className="w-4 h-4 text-orange-600 shrink-0" />
                <p className="text-[11px] text-orange-800 leading-tight">
                  <b>कोटा सुरक्षा:</b> केवल 5 सबसे नए पेंडिंग डिपॉजिट्स दिखाए जा रहे हैं। पुराने डिपॉजिट्स ऑटो-हाइड कर दिए गए हैं।
                </p>
              </div>
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold">Pending Deposits</h2>
              </div>
              <div className="space-y-4">
                {deposits.filter(d => d.status === 'pending').length > 0 ? (
                  deposits.filter(d => d.status === 'pending').map((deposit) => (
                    <Card key={deposit.id} className="border-none shadow-sm overflow-hidden">
                      <CardContent className="p-4 space-y-4">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div className="p-2 bg-blue-100 rounded-full">
                              <Wallet className="w-5 h-5 text-blue-600" />
                            </div>
                            <div>
                              <p className="font-bold">{deposit.userEmail}</p>
                              <p className="text-[10px] text-gray-400">
                                {deposit.createdAt?.toDate ? deposit.createdAt.toDate().toLocaleString() : 
                                 deposit.createdAt ? new Date(deposit.createdAt).toLocaleString() : ""}
                              </p>
                              <p className="text-sm font-bold text-primary">Amount: ₹{Number(deposit.amount || 0).toFixed(2)}</p>
                            </div>
                          </div>
                          <Badge className="bg-orange-100 text-orange-700 border-none">
                            {deposit.status}
                          </Badge>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-1">
                            <p className="text-[10px] font-bold text-gray-400 uppercase">Transaction ID / UTR</p>
                            <p className="text-sm font-mono bg-gray-50 p-2 rounded-lg border border-gray-100">
                              {deposit.utr || "N/A"}
                            </p>
                          </div>

                          {deposit.screenshotUrl && (
                            <div className="space-y-1">
                              <p className="text-[10px] font-bold text-gray-400 uppercase">Payment Screenshot</p>
                              <Button 
                                variant="outline" 
                                size="sm"
                                className="flex items-center gap-2 text-xs text-indigo-600 border-indigo-100 hover:bg-indigo-50 w-full h-9"
                                onClick={() => setSelectedScreenshot(deposit.screenshotUrl)}
                              >
                                <ImageIcon className="w-4 h-4" />
                                View Screenshot
                              </Button>
                            </div>
                          )}
                        </div>

                        <div className="flex gap-2 pt-2">
                          <Button 
                            className="flex-1 bg-green-600 hover:bg-green-700"
                            onClick={() => handleDepositAction(deposit, 'approved')}
                            disabled={processingActions.has(deposit.id)}
                          >
                            <CheckCircle2 className={cn("w-4 h-4 mr-2", processingActions.has(deposit.id) && "animate-spin")} />
                            {processingActions.has(deposit.id) ? "Checking..." : "Approve"}
                          </Button>
                          <Button 
                            variant="outline"
                            className="flex-1 text-red-600 border-red-200 hover:bg-red-50"
                            onClick={() => handleDepositAction(deposit, 'cancelled')}
                            disabled={processingActions.has(deposit.id)}
                          >
                            <XCircle className="w-4 h-4 mr-2" />
                            Cancel
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  ))
                ) : (
                  <p className="text-gray-500 italic text-center py-12">No pending deposits found.</p>
                )}
              </div>
              </>
            )}
            </TabsContent>
          </>
        )}

        {isAdmin && (
          <>
            <TabsContent value="users" className="space-y-4">
              {!fetchedTabs.has("users") ? (
                renderTabPlaceholder("users", "Users")
              ) : (
                <>
                  <div className="bg-purple-50 border border-purple-100 p-3 rounded-xl flex items-center gap-3">
                <AlertCircle className="w-4 h-4 text-purple-600 shrink-0" />
                <p className="text-[11px] text-purple-800 leading-tight">
                  <b>कोटा सुरक्षा:</b> सभी यूजर्स को एक साथ लोड करने से आपका कोटा खत्म हो सकता है। कृपया किसी भी यूजर को खोजने के लिए [Search] का उपयोग करें।
                </p>
              </div>
              <div className="flex flex-col md:flex-row items-center justify-between gap-4">
                <h2 className="text-lg font-bold">Manage Users</h2>
                <div className="relative flex items-center w-full md:w-auto gap-2">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
                    <Input 
                      placeholder="Search email or prefix..." 
                      className="pl-10 rounded-xl bg-white w-full md:w-64"
                      value={userSearch}
                      onChange={(e) => setUserSearch(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleSearchUser()}
                    />
                  </div>
                  <Button 
                    onClick={() => handleSearchUser(true)} 
                    className="rounded-xl shrink-0"
                    disabled={isSearchingUser}
                  >
                    {isSearchingUser ? <RefreshCw className="w-4 h-4 animate-spin" /> : "Search"}
                  </Button>
                </div>
              </div>
              <div className="space-y-3">
                {allUsers
                  .map((u) => (
                    <Card key={u.id} className="border-none shadow-sm">
                      <CardContent className="p-4 flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 bg-gray-100 rounded-full flex items-center justify-center font-bold text-gray-500">
                            {u.email.charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <p className="font-bold text-sm leading-none">{u.email}</p>
                            {u.displayName && <p className="text-[10px] text-gray-500 mt-1 font-medium">{u.displayName}</p>}
                            <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                              <p className="text-xs text-primary font-bold">Bal: ₹{Number(u.balance || 0).toFixed(2)}</p>
                              <span className="text-[10px] text-gray-400">•</span>
                              <p className="text-[10px] text-gray-300">
                                Active: {u.lastActive?.toDate ? u.lastActive.toDate().toLocaleDateString() : "Just now"}
                              </p>
                            </div>
                          </div>
                        </div>
                        <Button 
                          variant="outline" 
                          size="sm" 
                          className="rounded-xl"
                          onClick={() => {
                            setEditingUser(u);
                            setNewBalance(String(u.balance || 0));
                          }}
                        >
                          Edit Wallet
                        </Button>
                      </CardContent>
                    </Card>
                  ))}
              </div>
              </>
            )}
            </TabsContent>

            <TabsContent value="settings" className="space-y-6">
              {!fetchedTabs.has("settings") ? (
                renderTabPlaceholder("settings", "Settings")
              ) : (
                <>
                  <Card className="border-none shadow-sm">
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <QrCode className="w-5 h-5 text-primary" />
                    Payment Settings
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="grid gap-4 md:grid-cols-3">
                    <div className="space-y-2">
                      <label className="text-xs font-bold uppercase tracking-wider text-gray-400">UPI ID</label>
                      <Input 
                        placeholder="e.g. yourname@upi" 
                        value={upiId}
                        onChange={(e) => setUpiId(e.target.value)}
                        className="rounded-xl h-12"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-bold uppercase tracking-wider text-gray-400">Merchant Name</label>
                      <Input 
                        placeholder="e.g. SMM Panel Pro" 
                        value={merchantName}
                        onChange={(e) => setMerchantName(e.target.value)}
                        className="rounded-xl h-12"
                      />
                    </div>
                    <div className="space-y-2">
                      <div className="flex justify-between items-center">
                        <label className="text-xs font-bold uppercase tracking-wider text-primary font-bold">Backend Server URL</label>
                        <button
                          type="button"
                          onClick={() => setBackendApiUrl("https://ais-pre-n2umeaxvo6qnc7chsbm27z-523409699457.asia-southeast1.run.app")}
                          className="text-[10px] text-primary hover:underline font-semibold"
                        >
                          Auto-fill Stable API URL
                        </button>
                      </div>
                      <Input 
                        placeholder="e.g. https://ais-pre-...run.app" 
                        value={backendApiUrl}
                        onChange={(e) => setBackendApiUrl(e.target.value)}
                        className="rounded-xl h-12 border-primary/50 focus:border-primary"
                      />
                    </div>
                  </div>
                  <p className="text-[10px] text-gray-500 mt-[-12px]">
                    Note: Your stable Cloud Run backend URL is: <strong className="text-primary">https://ais-pre-n2umeaxvo6qnc7chsbm27z-523409699457.asia-southeast1.run.app</strong>. 
                    Do not use your custom domain or the dev sandbox URL ('ais-dev-...') here. Click "Auto-fill Stable API URL" above to set it correctly.
                  </p>

                  {(() => {
                    const hostname = window.location.hostname;
                    const isCustomDomain = !hostname.includes("run.app") && !hostname.includes("localhost") && !hostname.includes("127.0.0.1");
                    if (isCustomDomain) {
                      return (
                        <div className="bg-amber-500/10 border border-amber-500/30 rounded-2xl p-4 space-y-2 mt-2">
                          <p className="text-amber-500 font-bold text-xs uppercase tracking-wider flex items-center gap-1.5">
                            ⚠️ Custom Domain Warning ({hostname})
                          </p>
                          <p className="text-xs text-gray-300 leading-relaxed">
                            आप अपनी वेबसाइट को एक कस्टम डोमेन से खोल रहे हैं। लेकिन आपका <strong>Backend API</strong> अभी भी Google AI Studio Sandbox (<code className="text-primary-light">ais-pre-...run.app</code>) से जुड़ा है।
                          </p>
                          <p className="text-xs text-gray-400 leading-relaxed">
                            Google Sandbox सुरक्षा कारणों से (strict cookie verification) बाहरी डोमेन से डायरेक्ट API कॉल्स ब्लॉक कर देता है, जिसकी वजह से custom domain पर <strong>Network Error</strong> आता है।
                          </p>
                          <p className="text-xs text-amber-500/90 font-medium">
                            <strong>इसे ठीक करने के उपाय (How to Fix):</strong>
                          </p>
                          <ul className="list-disc pl-4 text-[11px] text-gray-400 space-y-1">
                            <li>
                              <strong>AI Studio Preview का उपयोग करें (अनुशंसित):</strong> Admin Panels, Settings या Test API का उपयोग करने के लिए हमेशा Google AI Studio की विंडो या "Open in new window" बटन का ही उपयोग करें (वहाँ balance और connection बिल्कुल सही काम करेगा)।
                            </li>
                            <li>
                              <strong>कस्टम डोमेन को सीधे Cloud Run से जोड़ें:</strong> क्योंकि हमारा प्रोजेक्ट Full-Stack है (frontend और server दोनों एक साथ Cloud Run पर चलते हैं), आप अपने कस्टम डोमेन के DNS को सीधे अपने Google Cloud Run सर्विस से मैप कर सकते हैं (Vercel की आवश्यकता नहीं है)। ऐसा करने से same-origin होने के कारण कभी भी Network Error या API ब्लॉकेज नहीं होगा।
                            </li>
                          </ul>
                        </div>
                      );
                    }
                    return null;
                  })()}

                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <label className="text-xs font-bold uppercase tracking-wider text-gray-400">Provider API URL</label>
                      <Input 
                        placeholder="e.g. https://provider.com/api/v2" 
                        value={providerApiUrl}
                        onChange={(e) => setProviderApiUrl(e.target.value)}
                        className="rounded-xl h-12"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-bold uppercase tracking-wider text-gray-400">Provider API Key</label>
                      <div className="flex gap-2">
                        <Input 
                          placeholder="Your API Key" 
                          type="password"
                          value={providerApiKey}
                          onChange={(e) => setProviderApiKey(e.target.value)}
                          className="rounded-xl h-12 flex-1"
                        />
                        <Button 
                          variant="outline" 
                          className="h-12"
                          onClick={() => handleTestProviderApi()}
                          disabled={testingApi}
                        >
                          {testingApi ? "Testing..." : "Test API"}
                        </Button>
                      </div>
                    </div>
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-12">
                      {/* Spacing adjusted */}
                    </div>
                  </div>

                    <div className="space-y-4">
                      <div className="space-y-2">
                        <label className="text-xs font-bold uppercase tracking-wider text-gray-400">WhatsApp Channel Link (Follow For Offer)</label>
                        <Input 
                          placeholder="e.g. https://whatsapp.com/channel/..." 
                          value={whatsappLink}
                          onChange={(e) => setWhatsappLink(e.target.value)}
                          className="rounded-xl h-12"
                        />
                        <p className="text-[10px] text-gray-500">This link is used for the "Follow For Offer" button in Profile.</p>
                      </div>

                      <div className="space-y-2">
                        <label className="text-xs font-bold uppercase tracking-wider text-gray-400">Floating WhatsApp Chat Number</label>
                        <Input 
                          placeholder="e.g. 919876543210" 
                          value={whatsappChatNumber}
                          onChange={(e) => setWhatsappChatNumber(e.target.value)}
                          className="rounded-xl h-12"
                        />
                        <p className="text-[10px] text-gray-500">Enter a phone number with country code (e.g. 91 for India) for the professional floating button.</p>
                      </div>

                      <div className="space-y-2">
                        <label className="text-xs font-bold uppercase tracking-wider text-gray-400">Guide Video Link (YouTube)</label>
                        <Input 
                          placeholder="e.g. https://www.youtube.com/watch?v=..." 
                          value={guideVideoUrl}
                          onChange={(e) => setGuideVideoUrl(e.target.value)}
                          className="rounded-xl h-12"
                        />
                        <p className="text-[10px] text-gray-500">YouTube video to show on the Profile page as a guide.</p>
                      </div>
                    </div>
                    <div className="border-t pt-6 mt-6">
                      <div className="flex items-center justify-between mb-4">
                        <div>
                          <h3 className="font-bold text-sm">Razorpay Payment Gateway</h3>
                          <p className="text-[10px] text-gray-500">Enable automatic payments via Razorpay</p>
                        </div>
                        <div 
                          className={cn(
                            "w-12 h-6 rounded-full p-1 cursor-pointer transition-colors duration-200",
                            razorpayEnabled ? "bg-primary" : "bg-gray-200"
                          )}
                          onClick={() => setRazorpayEnabled(!razorpayEnabled)}
                        >
                          <div className={cn(
                            "w-4 h-4 bg-white rounded-full transition-transform duration-200",
                            razorpayEnabled ? "translate-x-6" : "translate-x-0"
                          )} />
                        </div>
                      </div>

                      <div className={cn("grid gap-4 md:grid-cols-2", !razorpayEnabled && "opacity-50 pointer-events-none")}>
                        <div className="space-y-2">
                          <label className="text-xs font-bold uppercase tracking-wider text-gray-400">Razorpay Key ID</label>
                          <Input 
                            placeholder="rzp_test_..." 
                            value={razorpayKeyId}
                            onChange={(e) => setRazorpayKeyId(e.target.value)}
                            className="rounded-xl h-12"
                          />
                        </div>
                        <div className="space-y-2">
                          <label className="text-xs font-bold uppercase tracking-wider text-gray-400">Razorpay Key Secret</label>
                          <Input 
                            placeholder="Secret Key" 
                            type="password"
                            value={razorpayKeySecret}
                            onChange={(e) => setRazorpayKeySecret(e.target.value)}
                            className="rounded-xl h-12"
                          />
                        </div>
                      </div>
                      {razorpayEnabled && (
                        <p className="text-[10px] text-primary font-bold mt-2 italic">
                          Note: Manual QR payment will still stay visible as backup on the Profile page.
                        </p>
                      )}
                    </div>

                    {/* PhonePe Section */}
                    <div className="border-t pt-6 mt-6">
                      <div className="flex items-center justify-between mb-4">
                        <div>
                          <h3 className="font-bold text-sm">PhonePe Payment Gateway</h3>
                          <p className="text-[10px] text-gray-500">Enable automatic payments via PhonePe Merchant PG</p>
                        </div>
                        <div 
                          className={cn(
                            "w-12 h-6 rounded-full p-1 cursor-pointer transition-colors duration-200",
                            phonepeEnabled ? "bg-primary" : "bg-gray-200"
                          )}
                          onClick={() => setPhonepeEnabled(!phonepeEnabled)}
                        >
                          <div className={cn(
                            "w-4 h-4 bg-white rounded-full transition-transform duration-200",
                            phonepeEnabled ? "translate-x-6" : "translate-x-0"
                          )} />
                        </div>
                      </div>

                      <div className={cn("grid gap-4 md:grid-cols-2", !phonepeEnabled && "opacity-50 pointer-events-none")}>
                        <div className="space-y-2">
                          <label className="text-xs font-bold uppercase tracking-wider text-gray-400">PhonePe Merchant ID</label>
                          <Input 
                            placeholder="M123456789" 
                            value={phonepeMerchantId}
                            onChange={(e) => setPhonepeMerchantId(e.target.value)}
                            className="rounded-xl h-12"
                          />
                        </div>
                        <div className="space-y-2">
                          <label className="text-xs font-bold uppercase tracking-wider text-gray-400">PhonePe Salt Key</label>
                          <Input 
                            placeholder="Salt Key (ApiKey)" 
                            type="password"
                            value={phonepeSaltKey}
                            onChange={(e) => setPhonepeSaltKey(e.target.value)}
                            className="rounded-xl h-12"
                          />
                        </div>
                        <div className="space-y-2">
                          <label className="text-xs font-bold uppercase tracking-wider text-gray-400">PhonePe Salt Key Index</label>
                          <Input 
                            placeholder="e.g. 1" 
                            value={phonepeSaltIndex}
                            onChange={(e) => setPhonepeSaltIndex(e.target.value)}
                            className="rounded-xl h-12"
                          />
                        </div>
                        <div className="space-y-2">
                          <label className="text-xs font-bold uppercase tracking-wider text-gray-400">Environment</label>
                          <select 
                            value={phonepeEnv}
                            onChange={(e) => setPhonepeEnv(e.target.value)}
                            className="w-full rounded-xl h-12 border border-gray-200 bg-white px-3 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                          >
                            <option value="sandbox">Sandbox (Test / UAT Mode)</option>
                            <option value="production">Production (Live Mode)</option>
                          </select>
                        </div>
                      </div>
                    </div>

                    {/* Paytm Section */}
                    <div className="border-t pt-6 mt-6">
                      <div className="flex items-center justify-between mb-4">
                        <div>
                          <h3 className="font-bold text-sm">Paytm Payment Gateway</h3>
                          <p className="text-[10px] text-gray-500">Enable automatic payments via Paytm Merchant Web Checkout</p>
                        </div>
                        <div 
                          className={cn(
                            "w-12 h-6 rounded-full p-1 cursor-pointer transition-colors duration-200",
                            paytmEnabled ? "bg-primary" : "bg-gray-200"
                          )}
                          onClick={() => setPaytmEnabled(!paytmEnabled)}
                        >
                          <div className={cn(
                            "w-4 h-4 bg-white rounded-full transition-transform duration-200",
                            paytmEnabled ? "translate-x-6" : "translate-x-0"
                          )} />
                        </div>
                      </div>

                      <div className={cn("grid gap-4 md:grid-cols-2", !paytmEnabled && "opacity-50 pointer-events-none")}>
                        <div className="space-y-2">
                          <label className="text-xs font-bold uppercase tracking-wider text-gray-400">Paytm Merchant ID (MID)</label>
                          <Input 
                            placeholder="Paytm MID" 
                            value={paytmMid}
                            onChange={(e) => setPaytmMid(e.target.value)}
                            className="rounded-xl h-12"
                          />
                        </div>
                        <div className="space-y-2">
                          <label className="text-xs font-bold uppercase tracking-wider text-gray-400">Paytm Merchant Key</label>
                          <Input 
                            placeholder="Paytm Merchant Key" 
                            type="password"
                            value={paytmMerchantKey}
                            onChange={(e) => setPaytmMerchantKey(e.target.value)}
                            className="rounded-xl h-12"
                          />
                        </div>
                        <div className="space-y-2">
                          <label className="text-xs font-bold uppercase tracking-wider text-gray-400">Environment</label>
                          <select 
                            value={paytmEnv}
                            onChange={(e) => setPaytmEnv(e.target.value)}
                            className="w-full rounded-xl h-12 border border-gray-200 bg-white px-3 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                          >
                            <option value="sandbox">Sandbox (Stage Mode)</option>
                            <option value="production">Production (Live Mode)</option>
                          </select>
                        </div>
                      </div>
                    </div>

                    {/* Custom Payment Gateway 1 */}
                    <div className="border-t pt-6 mt-6">
                      <div className="flex items-center justify-between mb-4">
                        <div>
                          <h3 className="font-bold text-sm">Custom Payment Gateway 1 (Other App)</h3>
                          <p className="text-[10px] text-gray-500">Enable and integrate any other payment app using custom keys</p>
                        </div>
                        <div 
                          className={cn(
                            "w-12 h-6 rounded-full p-1 cursor-pointer transition-colors duration-200",
                            customGateway1Enabled ? "bg-primary" : "bg-gray-200"
                          )}
                          onClick={() => setCustomGateway1Enabled(!customGateway1Enabled)}
                        >
                          <div className={cn(
                            "w-4 h-4 bg-white rounded-full transition-transform duration-200",
                            customGateway1Enabled ? "translate-x-6" : "translate-x-0"
                          )} />
                        </div>
                      </div>

                      <div className={cn("grid gap-4 md:grid-cols-2", !customGateway1Enabled && "opacity-50 pointer-events-none")}>
                        <div className="space-y-2">
                          <label className="text-xs font-bold uppercase tracking-wider text-gray-400">Gateway App Name</label>
                          <Input 
                            placeholder="e.g. Instamojo, Stripe, Cashfree" 
                            value={customGateway1Name}
                            onChange={(e) => setCustomGateway1Name(e.target.value)}
                            className="rounded-xl h-12"
                          />
                        </div>
                        <div className="space-y-2">
                          <label className="text-xs font-bold uppercase tracking-wider text-gray-400">API Key / Client ID</label>
                          <Input 
                            placeholder="Enter Gateway API Key" 
                            value={customGateway1Key}
                            onChange={(e) => setCustomGateway1Key(e.target.value)}
                            className="rounded-xl h-12"
                          />
                        </div>
                        <div className="space-y-2">
                          <label className="text-xs font-bold uppercase tracking-wider text-gray-400">Secret Key / Salt Secret</label>
                          <Input 
                            placeholder="Enter Secret Key" 
                            type="password"
                            value={customGateway1Secret}
                            onChange={(e) => setCustomGateway1Secret(e.target.value)}
                            className="rounded-xl h-12"
                          />
                        </div>
                        <div className="space-y-2">
                          <label className="text-xs font-bold uppercase tracking-wider text-gray-400">Gateway Base URL / API URL</label>
                          <Input 
                            placeholder="e.g. https://api.instamojo.com/v2" 
                            value={customGateway1Url}
                            onChange={(e) => setCustomGateway1Url(e.target.value)}
                            className="rounded-xl h-12"
                          />
                        </div>
                      </div>
                    </div>

                    {/* Custom Payment Gateway 2 */}
                    <div className="border-t pt-6 mt-6">
                      <div className="flex items-center justify-between mb-4">
                        <div>
                          <h3 className="font-bold text-sm">Custom Payment Gateway 2 (Other App)</h3>
                          <p className="text-[10px] text-gray-500">Enable an additional payment gateway for another app integration</p>
                        </div>
                        <div 
                          className={cn(
                            "w-12 h-6 rounded-full p-1 cursor-pointer transition-colors duration-200",
                            customGateway2Enabled ? "bg-primary" : "bg-gray-200"
                          )}
                          onClick={() => setCustomGateway2Enabled(!customGateway2Enabled)}
                        >
                          <div className={cn(
                            "w-4 h-4 bg-white rounded-full transition-transform duration-200",
                            customGateway2Enabled ? "translate-x-6" : "translate-x-0"
                          )} />
                        </div>
                      </div>

                      <div className={cn("grid gap-4 md:grid-cols-2", !customGateway2Enabled && "opacity-50 pointer-events-none")}>
                        <div className="space-y-2">
                          <label className="text-xs font-bold uppercase tracking-wider text-gray-400">Gateway App Name</label>
                          <Input 
                            placeholder="e.g. Stripe, Razorpay Sandbox, Custom PG" 
                            value={customGateway2Name}
                            onChange={(e) => setCustomGateway2Name(e.target.value)}
                            className="rounded-xl h-12"
                          />
                        </div>
                        <div className="space-y-2">
                          <label className="text-xs font-bold uppercase tracking-wider text-gray-400">API Key / Client ID</label>
                          <Input 
                            placeholder="Enter Gateway API Key" 
                            value={customGateway2Key}
                            onChange={(e) => setCustomGateway2Key(e.target.value)}
                            className="rounded-xl h-12"
                          />
                        </div>
                        <div className="space-y-2">
                          <label className="text-xs font-bold uppercase tracking-wider text-gray-400">Secret Key / Salt Secret</label>
                          <Input 
                            placeholder="Enter Secret Key" 
                            type="password"
                            value={customGateway2Secret}
                            onChange={(e) => setCustomGateway2Secret(e.target.value)}
                            className="rounded-xl h-12"
                          />
                        </div>
                        <div className="space-y-2">
                          <label className="text-xs font-bold uppercase tracking-wider text-gray-400">Gateway Base URL / API URL</label>
                          <Input 
                            placeholder="e.g. https://api.gateway.com/v1" 
                            value={customGateway2Url}
                            onChange={(e) => setCustomGateway2Url(e.target.value)}
                            className="rounded-xl h-12"
                          />
                        </div>
                      </div>
                    </div>

                    {/* QR Auto Verification Gateway */}
                    <div className="border-t pt-6 mt-6 bg-primary/5 p-6 rounded-3xl border-2 border-primary/10">
                      <div className="flex items-center justify-between mb-4">
                        <div>
                          <h3 className="font-bold text-base text-primary">QR Auto Verification Gateway (SMMQR / VPA API)</h3>
                          <p className="text-[10px] text-gray-500 font-medium">Allows users to pay via QR and get instant wallet credit after entering UTR.</p>
                        </div>
                        <div 
                          className={cn(
                            "w-12 h-6 rounded-full p-1 cursor-pointer transition-colors duration-200",
                            qrAutoEnabled ? "bg-primary" : "bg-gray-200"
                          )}
                          onClick={() => setQrAutoEnabled(!qrAutoEnabled)}
                        >
                          <div className={cn(
                            "w-4 h-4 bg-white rounded-full transition-transform duration-200",
                            qrAutoEnabled ? "translate-x-6" : "translate-x-0"
                          )} />
                        </div>
                      </div>

                      <div className={cn("grid gap-4 md:grid-cols-2", !qrAutoEnabled && "opacity-50 pointer-events-none")}>
                        <div className="space-y-2">
                          <label className="text-xs font-bold uppercase tracking-wider text-gray-400">Provider Type</label>
                          <select 
                            value={qrAutoProvider}
                            onChange={(e) => setQrAutoProvider(e.target.value)}
                            className="w-full rounded-xl h-12 border border-gray-200 bg-white px-3 text-sm focus:outline-none focus:ring-1 focus:ring-primary font-bold"
                          >
                            <option value="smmqr">SMMQR.COM (UPI Auto)</option>
                            <option value="vpaapi">VPAAPI.COM (Verify API)</option>
                            <option value="upigateway">UPIGATEWAY.COM (Verify API)</option>
                            <option value="custom">Other Custom API</option>
                          </select>
                        </div>
                        <div className="space-y-2">
                          <label className="text-xs font-bold uppercase tracking-wider text-gray-400">API Key / Token</label>
                          <Input 
                            placeholder="Enter API Key" 
                            value={qrAutoApiKey}
                            onChange={(e) => setQrAutoApiKey(e.target.value)}
                            className="rounded-xl h-12"
                          />
                        </div>
                        <div className="space-y-2">
                          <label className="text-xs font-bold uppercase tracking-wider text-gray-400">Secret Token (Optional)</label>
                          <Input 
                            placeholder="Enter Secret/Token if required" 
                            type="password"
                            value={qrAutoToken}
                            onChange={(e) => setQrAutoToken(e.target.value)}
                            className="rounded-xl h-12"
                          />
                        </div>
                        <div className="space-y-2">
                          <label className="text-xs font-bold uppercase tracking-wider text-gray-400">Custom Verify URL (Optional)</label>
                          <Input 
                            placeholder="e.g. https://smmqr.com/api/verify" 
                            value={qrAutoUrl}
                            onChange={(e) => setQrAutoUrl(e.target.value)}
                            className="rounded-xl h-12"
                          />
                        </div>
                      </div>
                      {qrAutoEnabled && (
                        <div className="mt-4 p-4 bg-white rounded-2xl border border-primary/20 space-y-3">
                          <p className="text-[10px] text-primary font-bold leading-relaxed">
                            How it works: When a user pays and enters their 12-digit UTR, our system will call {qrAutoProvider.toUpperCase()} API to verify the payment. 
                            If verified, the amount will be added to their wallet automatically.
                          </p>
                          
                          {qrAutoProvider === "upigateway" && (
                            <div className="pt-2 border-t border-gray-100">
                              <p className="text-[10px] font-bold text-gray-500 uppercase mb-2">Webhook Configuration (Required for UPIGateway)</p>
                              <div className="flex items-center gap-2 bg-gray-50 p-2 rounded-xl border border-gray-100">
                                <code className="text-[9px] font-mono text-primary break-all">
                                  {window.location.origin}/api/webhooks/upigateway
                                </code>
                                <Button 
                                  variant="ghost" 
                                  size="sm" 
                                  className="h-6 px-2 text-[9px] font-bold"
                                  onClick={() => {
                                    navigator.clipboard.writeText(`${window.location.origin}/api/webhooks/upigateway`);
                                    toast.success("Webhook URL copied!");
                                  }}
                                >
                                  Copy
                                </Button>
                              </div>
                              <p className="text-[9px] text-gray-400 mt-1 italic">Copy this URL and paste it into your UPIGateway.com dashboard Webhook setting.</p>
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-12">
                      {/* Spacing adjusted */}
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div className="space-y-2">
                      <label className="text-xs font-bold uppercase tracking-wider text-gray-400">Static QR Code Image (Optional)</label>
                      <div className="flex flex-col items-center justify-center border-2 border-dashed border-gray-200 rounded-2xl p-6 bg-gray-50 hover:bg-gray-100 transition-colors cursor-pointer relative">
                        <input 
                          type="file" 
                          accept="image/*" 
                          className="absolute inset-0 opacity-0 cursor-pointer"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) setQrFile(file);
                          }}
                        />
                        <Upload className="w-8 h-8 text-gray-400 mb-2" />
                        <p className="text-sm text-gray-500 font-medium">
                          {qrFile ? qrFile.name : "Click to upload QR Code"}
                        </p>
                        <p className="text-[10px] text-gray-400 mt-1">PNG, JPG up to 5MB</p>
                      </div>
                    </div>
                  </div>
                  
                  {(qrUrl || qrFile) && (
                    <div className="border rounded-2xl p-4 flex flex-col items-center gap-2 bg-gray-50">
                      <p className="text-xs font-bold text-gray-400 uppercase">Preview</p>
                      <img 
                        src={qrFile ? URL.createObjectURL(qrFile) : qrUrl} 
                        alt="QR Preview" 
                        className="max-w-[200px] rounded-lg shadow-sm" 
                      />
                    </div>
                  )}

                  <Button 
                    className="w-full" 
                    onClick={handleSaveQr}
                    disabled={savingQr}
                  >
                    {savingQr ? "Saving..." : "Save Settings"}
                  </Button>
                </CardContent>
              </Card>
                </>
              )}
            </TabsContent>
          </>
        )}
      </Tabs>
      {/* Edit Service Modal */}
      <Dialog open={!!editingCourse} onOpenChange={(open) => !open && setEditingCourse(null)}>
        <DialogContent className="max-w-2xl rounded-3xl p-6 overflow-y-auto max-h-[90vh]">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold">Edit Service</DialogTitle>
            <DialogDescription>
              Update service pricing or provider details
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4 md:grid-cols-2">
            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-wider text-gray-400">Service Category</label>
              <select 
                className="w-full h-10 rounded-md bg-gray-50 border border-gray-200 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                value={editCategory}
                onChange={(e) => setEditCategory(e.target.value)}
              >
                <option value="Instagram">Instagram</option>
                <option value="Facebook">Facebook</option>
                <option value="YouTube">YouTube</option>
                <option value="Telegram">Telegram</option>
                <option value="Twitter">Twitter</option>
                <option value="TikTok">TikTok</option>
                <option value="Other">Other</option>
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-wider text-gray-400">Service Title</label>
              <Input 
                placeholder="Service Title" 
                className="rounded-xl"
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
              />
            </div>
            <div className="md:col-span-2 pt-1 pb-1 flex items-center gap-3">
              <input
                type="checkbox"
                id="editIsPackage"
                checked={editIsPackage}
                onChange={(e) => setEditIsPackage(e.target.checked)}
                className="w-5 h-5 rounded border-gray-200 bg-gray-50 text-primary focus:ring-primary focus:ring-offset-white cursor-pointer"
              />
              <label htmlFor="editIsPackage" className="text-sm font-medium text-gray-600 cursor-pointer select-none">
                Is this a Fixed Quantity SMM Package? (e.g. 100k views for ₹45)
                <span className="block text-xs text-gray-400 font-normal mt-0.5">Check this to offer a fixed quantity at a set offer price instead of calculation per 1000.</span>
              </label>
            </div>

            {editIsPackage ? (
              <>
                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase tracking-wider text-gray-400">Package Special Price (INR)</label>
                  <Input 
                    className="rounded-xl"
                    placeholder="e.g. 45"
                    type="number"
                    value={editPackagePrice}
                    onChange={(e) => setEditPackagePrice(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase tracking-wider text-gray-400">Package Quantity (Fixed)</label>
                  <Input 
                    className="rounded-xl"
                    placeholder="e.g. 100000"
                    type="number"
                    value={editPackageQuantity}
                    onChange={(e) => setEditPackageQuantity(e.target.value)}
                  />
                </div>
              </>
            ) : (
              <>
                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase tracking-wider text-gray-400">Price per 1000 (INR)</label>
                  <Input 
                    className="rounded-xl"
                    type="number"
                    value={editPrice}
                    onChange={(e) => setEditPrice(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase tracking-wider text-gray-400">Minimum Limit</label>
                  <Input 
                    className="rounded-xl"
                    type="number"
                    value={editMinLimit}
                    onChange={(e) => setEditMinLimit(e.target.value)}
                  />
                </div>
              </>
            )}
            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-wider text-gray-400">Provider Service ID</label>
              <Input 
                placeholder="e.g. 1234" 
                className="rounded-xl"
                value={editServiceId}
                onChange={(e) => setEditServiceId(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-wider text-gray-400">Select Provider</label>
              <select 
                className="w-full h-10 rounded-md bg-gray-50 border border-gray-200 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                value={editProviderId}
                onChange={(e) => setEditProviderId(e.target.value)}
              >
                <option value="">Select a provider</option>
                <option value="global">Global Settings</option>
                {providers.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
            <div className="md:col-span-2 pt-2 flex items-center gap-3">
              <input
                type="checkbox"
                id="editPreventDuplicateLink"
                checked={editPreventDuplicate}
                onChange={(e) => setEditPreventDuplicate(e.target.checked)}
                className="w-5 h-5 rounded border-gray-200 bg-gray-50 text-blue-600 focus:ring-blue-500"
              />
              <label htmlFor="editPreventDuplicateLink" className="text-sm font-medium text-gray-600">
                Prevent Duplicate Target Link (25 min)
              </label>
            </div>
          </div>

          <DialogFooter className="flex-col gap-2">
            <Button 
              className="w-full rounded-xl h-12 font-bold" 
              onClick={handleUpdateCourse}
            >
              Update Service
            </Button>
            <Button 
              variant="ghost" 
              className="w-full rounded-xl" 
              onClick={() => setEditingCourse(null)}
            >
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit User Balance Modal */}
      <Dialog open={!!editingUser} onOpenChange={(open) => !open && setEditingUser(null)}>
        <DialogContent className="max-w-md rounded-3xl p-6">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold">Edit User Wallet</DialogTitle>
            <DialogDescription>
              Adjust balance and referral earnings for {editingUser?.email}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-wider text-gray-400">Order Balance (₹)</label>
              <Input 
                type="number"
                className="rounded-xl h-12"
                value={newBalance}
                onChange={(e) => setNewBalance(e.target.value)}
              />
            </div>
          </div>

          <DialogFooter className="flex-col gap-2">
            <Button 
              className="w-full rounded-xl h-12 font-bold" 
              onClick={handleUpdateUserBalance}
            >
              Update Wallet
            </Button>
            <Button 
              variant="ghost" 
              className="w-full rounded-xl" 
              onClick={() => setEditingUser(null)}
            >
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Screenshot Viewer Modal */}
      <Dialog open={!!selectedScreenshot} onOpenChange={(open) => !open && setSelectedScreenshot(null)}>
        <DialogContent className="max-w-3xl p-0 overflow-hidden bg-black/90 border-none rounded-3xl">
          <div className="relative w-full h-full flex items-center justify-center p-4 min-h-[300px]">
            {selectedScreenshot && (
              <img 
                src={selectedScreenshot} 
                alt="Payment Proof" 
                className="max-w-full max-h-[80vh] object-contain rounded-xl shadow-2xl"
                referrerPolicy="no-referrer"
              />
            )}
            <Button 
              variant="ghost" 
              className="absolute top-4 right-4 text-white hover:bg-white/20 rounded-full w-10 h-10 p-0"
              onClick={() => setSelectedScreenshot(null)}
            >
              <XCircle className="w-6 h-6" />
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      {/* Delete Provider Confirmation Modal */}
      <Dialog open={!!providerToDelete} onOpenChange={(open) => !open && setProviderToDelete(null)}>
        <DialogContent className="max-w-md rounded-3xl p-6">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold text-red-600">Delete Provider</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete <strong>{providerToDelete?.name}</strong>? Services linked to this provider will stop working and users won't be able to place orders.
            </DialogDescription>
          </DialogHeader>

          <DialogFooter className="flex-col gap-2 pt-4">
            <Button 
              className="w-full rounded-xl h-12 font-bold bg-red-600 hover:bg-red-700 text-white" 
              onClick={confirmDeleteProvider}
            >
              <Trash2 className="w-4 h-4 mr-2" />
              Yes, Delete Provider
            </Button>
            <Button 
              variant="ghost" 
              className="w-full rounded-xl" 
              onClick={() => setProviderToDelete(null)}
            >
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}


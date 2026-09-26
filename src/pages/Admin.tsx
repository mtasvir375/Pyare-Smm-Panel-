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
  ShieldCheck,
  Palette,
  Check,
  Smartphone,
  Key,
  Copy,
  Zap,
  Terminal,
  Send,
  Bot
} from "lucide-react";
import { TelegramBotTab } from "@/components/admin/TelegramBotTab";
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
import { STABLE_CLOUD_RUN_BACKEND } from "@/App";
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
  const [depositFilter, setDepositFilter] = useState<"pending" | "approved" | "cancelled" | "all">("pending");
  const [depositSearch, setDepositSearch] = useState("");
  const [isRefreshingDeposits, setIsRefreshingDeposits] = useState(false);

  const handleRefreshDeposits = async () => {
    setIsRefreshingDeposits(true);
    try {
      const depositsList = await dbClient.getDepositsAdmin(50, true);
      setDeposits(depositsList);
      toast.success("Deposits list refreshed!");
    } catch (e: any) {
      toast.error("Failed to refresh deposits");
    } finally {
      setIsRefreshingDeposits(false);
    }
  };

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
  const [newCourseServiceMode, setNewCourseServiceMode] = useState<"single" | "package" | "combo">("single");
  const [newCourseComboItems, setNewCourseComboItems] = useState<Array<{ name: string; providerId: string; providerServiceId: string; quantity: string }>>([
    { name: "100,000 Views", providerId: "", providerServiceId: "", quantity: "100000" },
    { name: "5,000 Likes", providerId: "", providerServiceId: "", quantity: "5000" }
  ]);
  const [qrUrl, setQrUrl] = useState("");
  const [upiId, setUpiId] = useState("");
  const [merchantName, setMerchantName] = useState("");
  const [providerApiUrl, setProviderApiUrl] = useState("");
  const [providerApiKey, setProviderApiKey] = useState("");
  const [backendApiUrl, setBackendApiUrl] = useState("");
  const [whatsappLink, setWhatsappLink] = useState("");
  const [whatsappChatNumber, setWhatsappChatNumber] = useState("");
  const [guideVideoUrl, setGuideVideoUrl] = useState("");
  const [selectedTheme, setSelectedTheme] = useState("charcoal");
  const [selectedFestivalTheme, setSelectedFestivalTheme] = useState("none");
  const [instantQrEnabled, setInstantQrEnabled] = useState(true);
  const [manualQrEnabled, setManualQrEnabled] = useState(true);
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
  const [smsForwarderEnabled, setSmsForwarderEnabled] = useState(true);
  const [smsForwarderSecret, setSmsForwarderSecret] = useState("");
  const [smsTestText, setSmsTestText] = useState("");
  const [smsTestSimulate, setSmsTestSimulate] = useState(false);
  const [smsTestResult, setSmsTestResult] = useState<any>(null);
  const [testingSms, setTestingSms] = useState(false);
  const [smsLogs, setSmsLogs] = useState<any[]>([]);
  const [smsAvailableList, setSmsAvailableList] = useState<any[]>([]);
  const [smsPendingUsers, setSmsPendingUsers] = useState<any[]>([]);
  const [loadingSmsLogs, setLoadingSmsLogs] = useState(false);
  const [manualUtr, setManualUtr] = useState("");
  const [manualAmount, setManualAmount] = useState("");
  const [manualUserEmail, setManualUserEmail] = useState("");
  const [isResolvingManual, setIsResolvingManual] = useState(false);
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
  const [isRestoringBalances, setIsRestoringBalances] = useState(false);

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
        const { getCachedCourses } = await import("@/lib/cache");
        let allCourses = await getCachedCourses(force);
        setTotalActiveServices(allCourses.length);

        let coursesList = [...allCourses];
        if (courseCategoryFilter && courseCategoryFilter !== "All") {
          coursesList = coursesList.filter((c: any) => c.category === courseCategoryFilter);
        }

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
        const depositsList = await dbClient.getDepositsAdmin(25);
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
          setProviderApiUrl(settingsData.providerApiUrl || settingsData.apiUrl || settingsData.api_url || settingsData.provider_api_url || "");
          setProviderApiKey(settingsData.providerApiKey || settingsData.apiKey || settingsData.api_key || settingsData.provider_api_key || "");
          setWhatsappLink(settingsData.whatsappLink || "");
          setWhatsappChatNumber(settingsData.whatsappChatNumber || "");
          setGuideVideoUrl(settingsData.guideVideoUrl || "");
          setSelectedTheme(settingsData.selectedTheme || "charcoal");
          setSelectedFestivalTheme(settingsData.selectedFestivalTheme || "none");
          setInstantQrEnabled(settingsData.instantQrEnabled !== false);
          setManualQrEnabled(settingsData.manualQrEnabled !== false);
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
          
          setSmsForwarderEnabled(settingsData.smsForwarderEnabled !== false);
          setSmsForwarderSecret(settingsData.smsForwarderSecret || "");
          
          const savedBackendUrl = settingsData.backendApiUrl || "";
          setBackendApiUrl(savedBackendUrl);
          fetchSmsLogs();
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

  const [transmittingOrders, setTransmittingOrders] = useState<Set<string>>(new Set());

  const handleResendOrderToProvider = async (order: any) => {
    if (!order || !order.id) return;
    setTransmittingOrders(prev => new Set(prev).add(order.id));
    toast.loading(`Transmitting order #${order.id} to provider...`, { id: `tx_${order.id}` });
    try {
      const payload = {
        orderId: order.id,
        userId: order.userId || order.user_id,
        userEmail: order.userEmail || "",
        serviceId: order.serviceId || order.service_id || order.courseId,
        title: order.title || order.courseTitle || "",
        category: order.category || "Other",
        quantity: Number(order.quantity),
        targetLink: order.targetLink || order.target_link,
        totalPrice: Number(order.totalPrice || order.total_price || 0),
        providerServiceId: order.providerServiceId || order.provider_service_id,
        providerId: order.providerId || order.provider_id,
        isAsync: false,
        skipStoreCompleted: false
      };

      const response = await axios.post("/api/proxy-provider", payload, { timeout: 35000 });
      if (response.data && (response.data.success || response.data.providerOrderId)) {
        const pOrderId = String(response.data.providerOrderId || "SENT");
        toast.success(`Successfully sent to provider! Provider Order ID: #${pOrderId}`, { id: `tx_${order.id}` });
        setOrders(prev => prev.map(o => o.id === order.id ? { ...o, status: "In progress", providerOrderId: pOrderId } : o));
      } else {
        toast.error(`Transmission failed: ${response.data.error || "Provider error"}`, { id: `tx_${order.id}` });
      }
    } catch (err: any) {
      toast.error(`Transmission error: ${err.response?.data?.error || err.message}`, { id: `tx_${order.id}` });
    } finally {
      setTransmittingOrders(prev => {
        const next = new Set(prev);
        next.delete(order.id);
        return next;
      });
    }
  };

  const handleTestProviderApi = async (providerId?: string) => {
    if (providerId) {
      setTestingProviders(prev => new Set(prev).add(providerId));
    } else {
      setTestingApi(true);
    }
    
    try {
      const endpoints = [
        '/api/test-provider'
      ];
      let resData: any = null;
      let lastErr = "";

      for (const ep of endpoints) {
        try {
          const payload: any = { providerId };
          if (!providerId) {
            payload.providerApiUrl = providerApiUrl;
            payload.providerApiKey = providerApiKey;
          }
          const response = await axios.post(ep, payload, { timeout: 15000 });
          if (response?.data) {
            resData = response.data;
            break;
          }
        } catch (e: any) {
          lastErr = e.response?.data?.error || e.message || "Connection failed";
        }
      }

      if (resData?.success) {
        toast.success(`Connected! Balance: ${resData.balance} ${resData.currency || 'INR'}`);
      } else {
        toast.error(resData?.error || lastErr || "Connection failed");
      }
    } catch (error: any) {
      const errorMessage = error.response?.data?.error || error.message || "Connection failed";
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
      let cleanBackend = backendApiUrl.trim();

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
        selectedTheme: selectedTheme,
        selectedFestivalTheme: selectedFestivalTheme,
        instantQrEnabled: instantQrEnabled,
        manualQrEnabled: manualQrEnabled,
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
        smsForwarderEnabled: smsForwarderEnabled,
        smsForwarderSecret: smsForwarderSecret.trim(),
        updatedAt: new Date().toISOString()
      });
      setQrUrl(base64);
      setProviderApiUrl(cleanUrl);
      setProviderApiKey(cleanKey);
      setBackendApiUrl(cleanBackend);
      setQrFile(null);

      // Sync UPI ID with backend UPI Gateway / Telegram Bot service
      if (upiId.trim()) {
        try {
          await axios.post("/api/admin/upi-gateway-config", {
            action: "save",
            upiId: upiId.trim(),
            payeeName: merchantName.trim(),
            instantQrEnabled,
            manualQrEnabled
          });
        } catch (e) {}
      }

      const cacheMod = await import("@/lib/cache");
      cacheMod.clearCache();
      await cacheMod.getCachedSettings(true);
      toast.success("Payment & Global Settings updated successfully!");
    } catch (error: any) {
      toast.error(`Error saving settings: ${error.message}`);
    } finally {
      setSavingQr(false);
    }
  };

  const fetchSmsLogs = async () => {
    setLoadingSmsLogs(true);
    try {
      let fetchedLogs: any[] = [];
      let fetchedAvailable: any[] = [];
      let fetchedPending: any[] = [];

      try {
        const res = await axios.get("/api/sms-forwarder/logs");
        if (res.data && res.data.success) {
          fetchedLogs = res.data.logs || [];
          fetchedAvailable = res.data.available || [];
          fetchedPending = res.data.pendingUsers || [];
        }
      } catch (apiErr) {
        console.warn("Backend /api/sms-forwarder/logs unavailable, checking Firestore directly");
      }

      // Merge with Firestore if needed
      try {
        const [firestoreLogs, firestorePool, firestorePending] = await Promise.allSettled([
          dbClient.getDocs("sms_forwarder_logs"),
          dbClient.getDocs("sms_forwarder_pool"),
          dbClient.getDocs("pending_user_utrs")
        ]);

        if (firestoreLogs.status === "fulfilled" && firestoreLogs.value && firestoreLogs.value.length > 0) {
          const logMap = new Map();
          fetchedLogs.forEach((l: any) => logMap.set(l.id || l.timestamp, l));
          firestoreLogs.value.forEach((l: any) => {
            const key = l.id || l.timestamp;
            if (!logMap.has(key)) {
              logMap.set(key, l);
            }
          });
          fetchedLogs = Array.from(logMap.values());
          fetchedLogs.sort((a, b) => new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime());
        }

        if (firestorePool.status === "fulfilled" && firestorePool.value && firestorePool.value.length > 0) {
          const poolMap = new Map();
          fetchedAvailable.forEach((p: any) => poolMap.set(p.utr, p));
          firestorePool.value.forEach((p: any) => {
            if (p.status === "available" && !poolMap.has(p.utr)) {
              poolMap.set(p.utr, p);
            }
          });
          fetchedAvailable = Array.from(poolMap.values());
        }

        if (firestorePending.status === "fulfilled" && firestorePending.value && firestorePending.value.length > 0) {
          const pendingMap = new Map();
          fetchedPending.forEach((p: any) => pendingMap.set(p.utr, p));
          firestorePending.value.forEach((doc: any) => {
            if (!pendingMap.has(doc.utr || doc.id)) {
              pendingMap.set(doc.utr || doc.id, {
                utr: doc.utr || doc.id,
                userId: doc.userId,
                userEmail: doc.userEmail,
                amount: doc.amount,
                timestamp: doc.timestamp
              });
            }
          });
          fetchedPending = Array.from(pendingMap.values());
        }
      } catch (fErr) {}

      setSmsLogs(fetchedLogs);
      setSmsAvailableList(fetchedAvailable);
      setSmsPendingUsers(fetchedPending);
    } catch (e: any) {
      console.error("Failed to load SMS logs:", e.message);
    } finally {
      setLoadingSmsLogs(false);
    }
  };

  const handleManualResolvePayment = async (targetUtr?: string, targetAmount?: number, targetEmail?: string) => {
    const utrToUse = (targetUtr || manualUtr || "").replace(/\D/g, "");
    if (utrToUse.length !== 12) {
      toast.error("Please provide a valid 12-digit UTR");
      return;
    }
    const amtToUse = targetAmount !== undefined ? targetAmount : Number(manualAmount);
    if (!amtToUse || amtToUse <= 0) {
      toast.error("Please enter an amount greater than ₹0");
      return;
    }
    const emailToUse = targetEmail || manualUserEmail || "";

    setIsResolvingManual(true);
    try {
      let resolved = false;

      try {
        const res = await axios.post("/api/sms-forwarder/manual-resolve", {
          utr: utrToUse,
          amount: amtToUse,
          userEmail: emailToUse
        });
        if (res.data?.success) {
          resolved = true;
          toast.success(res.data.message || `Successfully credited ₹${amtToUse} for UTR ${utrToUse}!`);
        }
      } catch (backendErr: any) {
        console.warn("Backend manual-resolve error, attempting direct Firestore credit:", backendErr.message);
      }

      // Direct Firestore credit if backend failed
      if (!resolved) {
        // Find user by email or pending claim
        let matchedUserId = "";
        if (emailToUse) {
          const allUsers = await dbClient.getDocs("users");
          const target = allUsers.find((u: any) => (u.email || "").toLowerCase() === emailToUse.toLowerCase());
          if (target) matchedUserId = target.id;
        }

        if (!matchedUserId) {
          const pendingItem = smsPendingUsers.find((p: any) => p.utr === utrToUse);
          if (pendingItem?.userId) matchedUserId = pendingItem.userId;
        }

        if (matchedUserId) {
          const userDoc = await dbClient.getDoc("users", matchedUserId);
          const currentBal = Number(userDoc?.balance || 0);
          const updatedBal = currentBal + amtToUse;
          await dbClient.updateDoc("users", matchedUserId, { balance: updatedBal });
          await dbClient.addDoc("deposits", {
            userId: matchedUserId,
            userEmail: emailToUse || userDoc?.email || "",
            amount: amtToUse,
            utr: utrToUse,
            status: "approved",
            paymentMethod: "admin_manual_resolve",
            createdAt: new Date().toISOString(),
            verifiedAt: new Date().toISOString()
          });
          try {
            await dbClient.deleteDoc("pending_user_utrs", utrToUse);
          } catch (delErr) {}
          resolved = true;
          toast.success(`🎉 Direct Firestore Credit: ₹${amtToUse} added to user's wallet! New balance: ₹${updatedBal}`);
        } else {
          toast.error("Could not find user. Please enter the user's registered email address.");
        }
      }

      if (resolved) {
        setManualUtr("");
        setManualAmount("");
        setManualUserEmail("");
        fetchSmsLogs();
      }
    } catch (e: any) {
      toast.error(e.response?.data?.error || e.message);
    } finally {
      setIsResolvingManual(false);
    }
  };

  const handleTestSmsParse = async (sampleText?: string) => {
    const textToTest = sampleText || smsTestText;
    if (!textToTest) {
      toast.error("Please enter bank SMS text to test");
      return;
    }
    setTestingSms(true);
    try {
      const res = await axios.post("/api/sms-forwarder/test-parse", {
        smsText: textToTest,
        simulate: smsTestSimulate
      });
      setSmsTestResult(res.data);
      if (res.data?.parsed?.valid) {
        toast.success(`Success! Amount: ₹${res.data.parsed.amount} | UTR: ${res.data.parsed.utr}`);
        if (res.data.simulated) {
          toast.success("Simulated payment added to available pool!");
          fetchSmsLogs();
        }
      } else {
        toast.error(res.data?.parsed?.reason || "Could not detect amount or 12-digit UTR");
      }
    } catch (err: any) {
      toast.error(`Test Error: ${err.message}`);
    } finally {
      setTestingSms(false);
    }
  };

  const handleClearSmsLogs = async () => {
    if (!window.confirm("Are you sure you want to clear SMS Forwarder logs?")) return;
    try {
      await axios.post("/api/sms-forwarder/clear-logs");
      setSmsLogs([]);
      toast.success("SMS Logs cleared");
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const [isSearchingUser, setIsSearchingUser] = useState(false);

  const handleSearchUser = async (force = false) => {
    if (isSearchingUser) return;

    setIsSearchingUser(true);
    try {
      const q = userSearch.trim();
      const res = await axios.post("/api/admin/search-user", { query: q });
      if (res.data && res.data.success) {
        let users = res.data.users || (res.data.user ? [res.data.user] : []);

        // Fallback: If query was entered and server list returned 0, search direct Firestore via client SDK
        if (users.length === 0 && q) {
          try {
            const { collection, getDocs, limit: fsLimit, query: fsQuery } = await import("firebase/firestore");
            const { db } = await import("@/lib/firebase");
            const snap = await getDocs(fsQuery(collection(db, "users"), fsLimit(100)));
            const directUsers = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            const qLower = q.toLowerCase();
            const matched = directUsers.filter((u: any) => {
              const uEmail = String(u.email || "").toLowerCase();
              const uName = String(u.displayName || "").toLowerCase();
              const uId = String(u.id || u.uid || "").toLowerCase();
              return uEmail.includes(qLower) || uName.includes(qLower) || uId.includes(qLower);
            });
            if (matched.length > 0) {
              users = matched;
            }
          } catch (clientErr) {
            console.warn("Client fallback search error:", clientErr);
          }
        }

        setAllUsers(users);
        if (q) {
          if (users.length === 0) {
            toast.error("No user found with this email or keyword");
          } else {
            toast.success(`Found ${users.length} user${users.length > 1 ? 's' : ''}`);
          }
        }
      } else {
        toast.error("Failed to search users");
      }
    } catch (err: any) {
      console.error("Search error:", err);
      toast.error(err.response?.data?.error || "Failed to search users");
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
        const response = await axios.post(`/api/proxy-provider`, {
          orderId: order.id,
          serviceId: order.serviceId || order.service_id,
          courseId: order.serviceId || order.service_id,
          targetLink: order.targetLink || order.target_link,
          quantity: order.quantity,
          providerServiceId: order.providerServiceId || order.provider_service_id,
          providerId: order.providerId || order.provider_id,
          title: order.title || order.serviceName || "",
          totalPrice: order.totalPrice || order.total_price || 0
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
      const res = await dbClient.processDepositAction(deposit.id, status, deposit, user?.email || undefined);
      
      // Update deposit status in local list
      setDeposits(prev => prev.map(d => d.id === deposit.id ? { 
        ...d, 
        status, 
        processedBy: user?.email || 'admin', 
        verifiedAt: status === 'approved' ? new Date().toISOString() : d.verifiedAt,
        updatedAt: new Date().toISOString() 
      } : d));
      toast.success(`Deposit ${status === 'approved' ? 'Approved & ₹' + (deposit.amount || 0) + ' Credited' : 'Cancelled'} successfully!`);
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

  const handleRestoreAllBalances = async () => {
    try {
      setIsRestoringBalances(true);
      const res = await axios.post("/api/admin/restore-all-balances");
      if (res.data && res.data.success) {
        if (res.data.count > 0) {
          toast.success(`बैलेंस सफलतापूर्वक रिकवर हो गया! ${res.data.count} यूजर्स के वॉलेट में बैलेंस रीस्टोर किया गया।`);
        } else {
          toast.info("सभी यूजर्स के वॉलेट बैलेंस पहले से ही सही और सुरक्षित हैं।");
        }
        // Refresh users list if open
        fetchTabData("users", true);
      } else {
        toast.error("रिकवरी प्रक्रिया में समस्या आई: " + (res.data?.error || "अज्ञात त्रुटि"));
      }
    } catch (err: any) {
      toast.error("बैलेंस रिकवरी में त्रुटि: " + err.message);
    } finally {
      setIsRestoringBalances(false);
    }
  };

  const handleUpdateUserBalance = async () => {
    if (!editingUser || newBalance === "") return;
    try {
      const updatedBal = Number(newBalance);
      await dbClient.updateDoc("users", editingUser.id, {
        balance: updatedBal
      });
      setAllUsers(prev => prev.map(u => u.id === editingUser.id ? { ...u, balance: updatedBal } : u));
      toast.success("User wallet balance updated!");
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
    const isCombo = newCourseServiceMode === "combo";
    const isPkg = newCourseServiceMode === "package" || isCombo;

    if (isCombo) {
      if (!newCourseTitle || !newCoursePackagePrice || newCourseComboItems.length === 0) {
        toast.error("Please fill in Combo Title, Package Price, and add components");
        return;
      }
      const validItems = newCourseComboItems.filter(i => i.providerServiceId && i.quantity);
      if (validItems.length === 0) {
        toast.error("Please add at least one valid component with Provider Service ID & Quantity");
        return;
      }
    } else if (isPkg) {
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
      const pkgQty = isCombo ? 1 : Number(newCoursePackageQuantity);
      const computedPricePerThousand = isPkg 
        ? Number(((pkgPrice / pkgQty) * 1000).toFixed(4)) 
        : Number(newCoursePrice);

      const formattedComboItems = isCombo ? newCourseComboItems.map(i => ({
        name: i.name || "Combo Component",
        providerId: i.providerId || newCourseProviderId || "global",
        providerServiceId: String(i.providerServiceId).trim(),
        quantity: Number(i.quantity) || 1000
      })) : [];

      await dbClient.addDoc("courses", {
        title: newCourseTitle,
        category: newCourseCategory,
        pricePerThousand: computedPricePerThousand,
        minLimit: isPkg ? pkgQty : Number(newCourseMinLimit),
        serviceType: isCombo ? "combo" : newCourseType,
        providerId: isCombo ? (formattedComboItems[0]?.providerId || newCourseProviderId || "global") : newCourseProviderId,
        providerServiceId: isCombo ? (formattedComboItems[0]?.providerServiceId || "combo") : newCourseProviderServiceId,
        preventDuplicateLink: preventDuplicateLink,
        iconUrl: newCourseIcon || null,
        status: "published",
        description: isCombo 
          ? `Combo Offer: ${formattedComboItems.map(i => `${i.name} (${i.quantity})`).join(" + ")}`
          : isPkg 
          ? `Offer Price: ₹${newCoursePackagePrice} for ${newCoursePackageQuantity} fixed quantity` 
          : `High quality ${newCourseType} service`,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        isPackage: isPkg,
        isCombo: isCombo,
        comboItems: formattedComboItems,
        packagePrice: isPkg ? pkgPrice : null,
        packageQuantity: isPkg ? pkgQty : null,
      });
      import("@/lib/cache").then(mod => mod.clearCache());
      toast.success(isCombo ? "Multi-Service Combo Package created!" : "Service added successfully!");
      fetchTabData(activeTab, true);
      setNewCourseTitle("");
      setNewCoursePrice("");
      setNewCourseMinLimit("1000");
      setNewCourseProviderServiceId("");
      setPreventDuplicateLink(false);
      setNewCourseIcon(null);
      setNewCourseIsPackage(false);
      setNewCoursePackagePrice("");
      setNewCoursePackageQuantity("1000");
      setNewCourseServiceMode("single");
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
  const [editServiceMode, setEditServiceMode] = useState<"single" | "package" | "combo">("single");
  const [editComboItems, setEditComboItems] = useState<Array<{ name: string; providerId: string; providerServiceId: string; quantity: string }>>([]);

  const startEditCourse = (course: any) => {
    setEditingCourse(course);
    setEditTitle(course.title);
    setEditPrice(String(course.pricePerThousand || course.price || ""));
    setEditMinLimit(String(course.minLimit || course.min_limit || ""));
    const pId = course.providerId || course.provider_id || "";
    setEditProviderId(pId === "global" ? "" : pId);
    setEditServiceId(course.providerServiceId || course.provider_service_id || "");
    setEditCategory(course.category || "Other");
    setEditType(course.serviceType || course.service_type || "likes");
    setEditPreventDuplicate(!!(course.preventDuplicateLink || course.prevent_duplicate_link));
    
    const isCombo = !!(course.isCombo || course.is_combo || course.serviceType === "combo" || course.service_type === "combo");
    const isPkg = !!(course.isPackage || course.is_package);
    
    setEditServiceMode(isCombo ? "combo" : (isPkg ? "package" : "single"));
    setEditIsPackage(isPkg);
    setEditPackagePrice(course.packagePrice ? String(course.packagePrice) : (course.package_price ? String(course.package_price) : ""));
    setEditPackageQuantity(course.packageQuantity ? String(course.packageQuantity) : (course.package_quantity ? String(course.package_quantity) : ""));
    
    if (course.comboItems || course.combo_items) {
      const items = course.comboItems || course.combo_items;
      setEditComboItems(items.map((i: any) => ({
        name: i.name || "",
        providerId: i.providerId || "",
        providerServiceId: String(i.providerServiceId || ""),
        quantity: String(i.quantity || "1000")
      })));
    } else {
      setEditComboItems([]);
    }
  };

  const handleUpdateCourse = async () => {
    if (!editingCourse) return;
    try {
      const isCombo = editServiceMode === "combo";
      const isPkg = editServiceMode === "package" || isCombo;
      const pkgPrice = Number(editPackagePrice);
      const pkgQty = isCombo ? 1 : Number(editPackageQuantity);

      const computedPricePerThousand = isPkg 
        ? Number(((pkgPrice / pkgQty) * 1000).toFixed(4)) 
        : Number(editPrice);

      const formattedComboItems = isCombo ? editComboItems.map(i => ({
        name: i.name || "Combo Component",
        providerId: i.providerId || editProviderId || "global",
        providerServiceId: String(i.providerServiceId).trim(),
        quantity: Number(i.quantity) || 1000
      })) : [];

      await dbClient.updateDoc("courses", editingCourse.id, {
        title: editTitle,
        pricePerThousand: computedPricePerThousand,
        minLimit: isPkg ? pkgQty : Number(editMinLimit),
        providerId: isCombo ? (formattedComboItems[0]?.providerId || editProviderId || "global") : editProviderId,
        providerServiceId: isCombo ? (formattedComboItems[0]?.providerServiceId || "combo") : editServiceId,
        category: editCategory,
        serviceType: isCombo ? "combo" : editType,
        preventDuplicateLink: editPreventDuplicate,
        isPackage: isPkg,
        isCombo: isCombo,
        comboItems: formattedComboItems,
        packagePrice: isPkg ? pkgPrice : null,
        packageQuantity: isPkg ? pkgQty : null,
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
              <TabsTrigger value="telegram-bot" className="rounded-xl px-6 flex items-center gap-1.5 font-bold">
                <Send className="w-3.5 h-3.5 text-blue-500" />
                Telegram UPI Bot
              </TabsTrigger>
            </>
          )}
          {isAdmin && (
            <>
              <TabsTrigger value="orders" className="rounded-xl px-6">Orders</TabsTrigger>
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
                                <span className="text-xs text-gray-500 font-medium">₹{course.pricePerThousand || course.price || 0}/1k</span>
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
                <div className="md:col-span-2 space-y-2">
                  <label className="text-xs font-bold uppercase tracking-wider text-gray-400">Service Mode</label>
                  <div className="grid grid-cols-3 gap-2 p-1 bg-white/5 rounded-xl border border-white/10">
                    <button
                      type="button"
                      onClick={() => { setNewCourseServiceMode("single"); setNewCourseIsPackage(false); }}
                      className={`py-2 text-xs font-semibold rounded-lg transition-all ${newCourseServiceMode === "single" ? "bg-primary text-white shadow-lg" : "text-gray-400 hover:text-white"}`}
                    >
                      Normal Service
                    </button>
                    <button
                      type="button"
                      onClick={() => { setNewCourseServiceMode("package"); setNewCourseIsPackage(true); }}
                      className={`py-2 text-xs font-semibold rounded-lg transition-all ${newCourseServiceMode === "package" ? "bg-primary text-white shadow-lg" : "text-gray-400 hover:text-white"}`}
                    >
                      Single Package
                    </button>
                    <button
                      type="button"
                      onClick={() => { setNewCourseServiceMode("combo"); setNewCourseIsPackage(true); }}
                      className={`py-2 text-xs font-semibold rounded-lg transition-all ${newCourseServiceMode === "combo" ? "bg-gradient-to-r from-purple-600 to-indigo-600 text-white shadow-lg" : "text-gray-400 hover:text-white"}`}
                    >
                      🔥 Multi Combo
                    </button>
                  </div>
                </div>

                {newCourseServiceMode === "combo" ? (
                  <div className="md:col-span-2 space-y-4 p-4 bg-purple-950/20 rounded-2xl border border-purple-500/30">
                    <div className="flex items-center justify-between">
                      <h4 className="text-sm font-bold text-purple-300 flex items-center gap-2">
                        <span>🔥</span> Multi-Service Combo Builder
                      </h4>
                      <span className="text-[10px] text-purple-400 bg-purple-900/50 px-2 py-0.5 rounded-full border border-purple-500/30">
                        Orders send automatically for each service
                      </span>
                    </div>

                    <div className="space-y-2">
                      <label className="text-xs font-bold uppercase tracking-wider text-gray-400">Combo Total Special Price (INR)</label>
                      <Input 
                        placeholder="e.g. 99 (Price for the entire combo package)" 
                        className="bg-white/10 border-white/20 text-white"
                        type="number"
                        value={newCoursePackagePrice}
                        onChange={(e) => setNewCoursePackagePrice(e.target.value)}
                      />
                    </div>

                    <div className="space-y-3 pt-2">
                      <label className="text-xs font-bold uppercase tracking-wider text-gray-400 block">
                        Combo Components (Services Included in 1 Link Order)
                      </label>

                      {newCourseComboItems.map((item, idx) => (
                        <div key={idx} className="p-3 bg-white/5 rounded-xl border border-white/10 space-y-3">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-bold text-gray-300">Component #{idx + 1}</span>
                            {newCourseComboItems.length > 1 && (
                              <button
                                type="button"
                                onClick={() => setNewCourseComboItems(newCourseComboItems.filter((_, i) => i !== idx))}
                                className="text-xs text-red-400 hover:text-red-300"
                              >
                                Remove
                              </button>
                            )}
                          </div>
                          <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
                            <Input
                              placeholder="Name e.g. 100k Views"
                              className="bg-white/10 border-white/20 text-white text-xs"
                              value={item.name}
                              onChange={(e) => {
                                const copy = [...newCourseComboItems];
                                copy[idx].name = e.target.value;
                                setNewCourseComboItems(copy);
                              }}
                            />
                            <select
                              className="w-full h-9 rounded-md bg-gray-900 border border-white/20 text-white px-2 text-xs"
                              value={item.providerId}
                              onChange={(e) => {
                                const copy = [...newCourseComboItems];
                                copy[idx].providerId = e.target.value;
                                setNewCourseComboItems(copy);
                              }}
                            >
                              <option value="">Default Provider</option>
                              {providers.map(p => (
                                <option key={p.id} value={p.id}>{p.name}</option>
                              ))}
                            </select>
                            <Input
                              placeholder="Service ID e.g. 1234"
                              className="bg-white/10 border-white/20 text-white text-xs"
                              value={item.providerServiceId}
                              onChange={(e) => {
                                const copy = [...newCourseComboItems];
                                copy[idx].providerServiceId = e.target.value;
                                setNewCourseComboItems(copy);
                              }}
                            />
                            <Input
                              placeholder="Qty e.g. 100000"
                              type="number"
                              className="bg-white/10 border-white/20 text-white text-xs"
                              value={item.quantity}
                              onChange={(e) => {
                                const copy = [...newCourseComboItems];
                                copy[idx].quantity = e.target.value;
                                setNewCourseComboItems(copy);
                              }}
                            />
                          </div>
                        </div>
                      ))}

                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setNewCourseComboItems([...newCourseComboItems, { name: "", providerId: "", providerServiceId: "", quantity: "1000" }])}
                        className="w-full bg-white/5 border-dashed border-white/20 text-xs text-purple-300 hover:bg-white/10"
                      >
                        + Add Another Service Component to Combo
                      </Button>
                    </div>
                  </div>
                ) : newCourseServiceMode === "package" ? (
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

                {newCourseServiceMode !== "combo" && (
                  <>
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
                  </>
                )}
                
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

        <TabsContent value="orders" className="space-y-4">
          {!fetchedTabs.has("orders") ? (
            renderTabPlaceholder("orders", "Orders")
          ) : (
            <>
              <div className="bg-blue-50 border border-blue-100 p-3 rounded-xl flex items-center gap-3">
                <AlertCircle className="w-4 h-4 text-blue-600 shrink-0" />
                <p className="text-[11px] text-blue-800 leading-tight">
                  <b>Latest Orders:</b> Showing the latest 50 orders placed on the platform. Click on status action to manually update status.
                </p>
              </div>

              <div className="flex items-center justify-between gap-4">
                <h2 className="text-lg font-bold">Latest User Orders (पेंडिंग और सफल ऑर्डर्स)</h2>
              </div>

              <div className="space-y-4">
                {orders && orders.length > 0 ? (
                  orders.map((order) => (
                    <Card key={order.id} className="border-none shadow-sm overflow-hidden bg-white animate-in fade-in">
                      <CardContent className="p-4 space-y-4">
                        <div className="flex items-start justify-between gap-4">
                          <div className="space-y-1">
                            <h3 className="font-bold text-sm leading-snug">{order.title}</h3>
                            <p className="text-[10px] text-gray-400 font-semibold">{order.category || "Other"}</p>
                            <p className="text-xs font-semibold text-gray-600">Placed by: {order.userEmail || "Unknown"}</p>
                            <p className="text-[10px] text-gray-400">
                              Date: {order.createdAt?.toDate ? order.createdAt.toDate().toLocaleString() : 
                                     order.createdAt ? new Date(order.createdAt).toLocaleString() : ""}
                            </p>
                          </div>
                          <div className="flex flex-col items-end gap-1.5 shrink-0">
                            <Badge className={cn(
                              "border-none",
                              order.status?.toLowerCase() === "pending" && "bg-orange-100 text-orange-700",
                              order.status?.toLowerCase() === "processing" && "bg-blue-100 text-blue-700",
                              order.status?.toLowerCase() === "in progress" && "bg-indigo-100 text-indigo-700",
                              order.status?.toLowerCase() === "completed" && "bg-green-100 text-green-700",
                              order.status?.toLowerCase() === "partial" && "bg-yellow-100 text-yellow-700",
                              order.status?.toLowerCase() === "canceled" && "bg-red-100 text-red-700",
                              order.status?.toLowerCase() === "failed" && "bg-red-600 text-white",
                              order.status?.toLowerCase() === "refunded" && "bg-gray-100 text-gray-700"
                            )}>
                              {order.status}
                            </Badge>
                            <p className="text-sm font-bold text-primary">₹{Number(order.totalPrice || order.total_price || 0).toFixed(2)}</p>
                          </div>
                        </div>

                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[10px] border-t pt-3">
                          <div>
                            <p className="text-gray-400 uppercase font-bold">Internal Order ID</p>
                            <p className="font-mono bg-gray-50 px-1 py-0.5 rounded border border-gray-100 select-all inline-block truncate max-w-full">
                              {order.id}
                            </p>
                          </div>
                          <div>
                            <p className="text-gray-400 uppercase font-bold">Provider Order ID</p>
                            <p className="font-mono font-bold text-indigo-700 bg-indigo-50 px-1.5 py-0.5 rounded border border-indigo-100 inline-block">
                              {order.providerOrderId || order.provider_order_id ? `#${order.providerOrderId || order.provider_order_id}` : "N/A"}
                            </p>
                          </div>
                          <div>
                            <p className="text-gray-400 uppercase font-bold">Quantity</p>
                            <p className="font-semibold text-gray-750">{order.quantity}</p>
                          </div>
                          <div>
                            <p className="text-gray-400 uppercase font-bold">Status Action</p>
                            <select 
                              className="text-[10px] font-bold border rounded p-1 bg-white"
                              value={order.status}
                              onChange={async (e) => {
                                const newStatus = e.target.value;
                                try {
                                  await dbClient.updateDoc("orders", order.id, { 
                                    status: newStatus,
                                    updatedAt: new Date().toISOString()
                                  });
                                  setOrders(prev => prev.map(o => o.id === order.id ? { ...o, status: newStatus } : o));
                                  toast.success(`Order status updated to ${newStatus}`);
                                } catch (err: any) {
                                  toast.error(`Failed to update status: ${err.message}`);
                                }
                              }}
                            >
                              <option value="Pending">Pending</option>
                              <option value="Processing">Processing</option>
                              <option value="In progress">In Progress</option>
                              <option value="Completed">Completed</option>
                              <option value="Partial">Partial</option>
                              <option value="Canceled">Canceled</option>
                              <option value="Failed">Failed</option>
                              <option value="Refunded">Refunded</option>
                            </select>
                          </div>
                        </div>

                        <div className="p-2 bg-gray-50 rounded-lg border border-gray-100">
                          <p className="text-[9px] font-bold text-gray-400 uppercase mb-1">Target Link</p>
                          {(() => {
                            const linkVal = String(order.targetLink || order.target_link || "").trim();
                            const isUrl = linkVal.startsWith("http://") || linkVal.startsWith("https://");
                            if (isUrl) {
                              return (
                                <a href={linkVal} target="_blank" rel="noreferrer" className="text-[10px] text-primary hover:underline break-all flex items-center gap-1">
                                  <ExternalLink className="w-3 h-3 shrink-0" />
                                  {linkVal}
                                </a>
                              );
                            }
                            return (
                              <p className="text-[10px] text-gray-800 font-medium break-all select-all">
                                {linkVal}
                              </p>
                            );
                          })()}
                        </div>

                        {order.status?.toLowerCase() === 'failed' && (
                          <div className="p-2 bg-red-50 text-red-600 rounded-lg text-[10px] font-bold border border-red-100 flex flex-col gap-1">
                            <p className="text-[9px] opacity-80">Reason: {typeof order.error === 'string' ? order.error : JSON.stringify(order.error || 'Check provider settings or target link.')}</p>
                          </div>
                        )}

                        <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-2 mt-2">
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-xs bg-indigo-50 text-indigo-700 border-indigo-200 hover:bg-indigo-100 flex items-center gap-1.5 h-8 font-bold"
                            onClick={() => handleResendOrderToProvider(order)}
                            disabled={transmittingOrders.has(order.id)}
                          >
                            <RefreshCw className={cn("w-3.5 h-3.5", transmittingOrders.has(order.id) && "animate-spin")} />
                            {transmittingOrders.has(order.id) ? "Sending to Provider..." : "⚡ Send / Re-transmit to Provider"}
                          </Button>

                          {order.providerOrderId && (
                            <span className="text-[11px] text-green-700 font-bold bg-green-50 px-2.5 py-1 rounded-md border border-green-200 flex items-center gap-1">
                              ✓ Provider ID: #{order.providerOrderId}
                            </span>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  ))
                ) : (
                  <p className="text-gray-500 italic text-center py-12">No orders found.</p>
                )}
              </div>
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
                {/* Header Actions & Controls */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white p-4 rounded-2xl shadow-sm border border-gray-100">
                  <div>
                    <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                      <Wallet className="w-5 h-5 text-primary" />
                      Deposit Requests Management
                    </h2>
                    <p className="text-xs text-gray-500">
                      Review user payment proofs, verify 12-digit UTRs, and approve wallet balance.
                    </p>
                  </div>
                  
                  <Button 
                    variant="outline" 
                    size="sm" 
                    onClick={handleRefreshDeposits}
                    disabled={isRefreshingDeposits}
                    className="rounded-xl border-gray-200 text-xs font-bold gap-2 shrink-0 h-10 px-4"
                  >
                    <RefreshCw className={cn("w-3.5 h-3.5", isRefreshingDeposits && "animate-spin text-primary")} />
                    {isRefreshingDeposits ? "Refreshing..." : "Refresh Deposits"}
                  </Button>
                </div>

                {/* Filters & Search */}
                <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between">
                  <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
                    <button
                      onClick={() => setDepositFilter("pending")}
                      className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 whitespace-nowrap ${
                        depositFilter === "pending"
                          ? "bg-amber-500 text-white shadow-sm"
                          : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                      }`}
                    >
                      Pending Review
                      <span className={`px-1.5 py-0.2 rounded-full text-[10px] ${
                        depositFilter === "pending" ? "bg-white text-amber-600 font-extrabold" : "bg-gray-200 text-gray-700"
                      }`}>
                        {deposits.filter(d => (d.status || '').toLowerCase() === 'pending').length}
                      </span>
                    </button>

                    <button
                      onClick={() => setDepositFilter("approved")}
                      className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 whitespace-nowrap ${
                        depositFilter === "approved"
                          ? "bg-emerald-600 text-white shadow-sm"
                          : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                      }`}
                    >
                      Approved
                      <span className={`px-1.5 py-0.2 rounded-full text-[10px] ${
                        depositFilter === "approved" ? "bg-white text-emerald-700 font-extrabold" : "bg-gray-200 text-gray-700"
                      }`}>
                        {deposits.filter(d => (d.status || '').toLowerCase() === 'approved').length}
                      </span>
                    </button>

                    <button
                      onClick={() => setDepositFilter("cancelled")}
                      className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 whitespace-nowrap ${
                        depositFilter === "cancelled"
                          ? "bg-rose-600 text-white shadow-sm"
                          : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                      }`}
                    >
                      Cancelled
                      <span className={`px-1.5 py-0.2 rounded-full text-[10px] ${
                        depositFilter === "cancelled" ? "bg-white text-rose-700 font-extrabold" : "bg-gray-200 text-gray-700"
                      }`}>
                        {deposits.filter(d => (d.status || '').toLowerCase() === 'cancelled').length}
                      </span>
                    </button>

                    <button
                      onClick={() => setDepositFilter("all")}
                      className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 whitespace-nowrap ${
                        depositFilter === "all"
                          ? "bg-gray-900 text-white shadow-sm"
                          : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                      }`}
                    >
                      All ({deposits.length})
                    </button>
                  </div>

                  <div className="relative w-full sm:w-72">
                    <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <Input
                      placeholder="Search UTR, Email, Amount..."
                      value={depositSearch}
                      onChange={(e) => setDepositSearch(e.target.value)}
                      className="pl-9 h-10 rounded-xl text-xs bg-white"
                    />
                    {depositSearch && (
                      <button
                        onClick={() => setDepositSearch("")}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-xs font-bold"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                </div>

                {/* Deposits List */}
                <div className="space-y-3">
                  {(() => {
                    const filtered = deposits.filter(deposit => {
                      const status = (deposit.status || '').toLowerCase();
                      if (depositFilter === "pending" && status !== "pending") return false;
                      if (depositFilter === "approved" && status !== "approved") return false;
                      if (depositFilter === "cancelled" && status !== "cancelled") return false;

                      if (depositSearch.trim()) {
                        const q = depositSearch.toLowerCase().trim();
                        const utr = String(deposit.utr || '').toLowerCase();
                        const email = String(deposit.userEmail || '').toLowerCase();
                        const amount = String(deposit.amount || '');
                        const id = String(deposit.id || '').toLowerCase();
                        return utr.includes(q) || email.includes(q) || amount.includes(q) || id.includes(q);
                      }
                      return true;
                    });

                    if (filtered.length === 0) {
                      return (
                        <div className="text-center py-16 bg-white rounded-2xl border border-dashed border-gray-200 space-y-3">
                          <Wallet className="w-10 h-10 text-gray-300 mx-auto" />
                          <div>
                            <p className="text-sm font-bold text-gray-700">No deposits found</p>
                            <p className="text-xs text-gray-400 mt-0.5">
                              {depositFilter === "pending" 
                                ? "No pending deposit requests waiting for review." 
                                : "No deposit records match your current filter."}
                            </p>
                          </div>
                          <Button 
                            variant="outline" 
                            size="sm" 
                            onClick={handleRefreshDeposits}
                            className="rounded-xl text-xs"
                          >
                            <RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Check for New Deposits
                          </Button>
                        </div>
                      );
                    }

                    return filtered.map((deposit) => {
                      const isPending = (deposit.status || '').toLowerCase() === 'pending';
                      const isApproved = (deposit.status || '').toLowerCase() === 'approved';
                      const isCancelled = (deposit.status || '').toLowerCase() === 'cancelled';
                      const dateStr = deposit.createdAt?.toDate 
                        ? deposit.createdAt.toDate().toLocaleString() 
                        : deposit.createdAt 
                          ? new Date(deposit.createdAt).toLocaleString() 
                          : "Just now";

                      return (
                        <Card key={deposit.id || deposit.utr} className="border border-gray-100 shadow-sm rounded-2xl overflow-hidden hover:border-gray-200 transition-all bg-white">
                          <CardContent className="p-4 sm:p-5 space-y-4">
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-gray-50 pb-3">
                              <div className="flex items-center gap-3">
                                <div className={`p-2.5 rounded-xl ${
                                  isPending ? "bg-amber-50 text-amber-600" : isApproved ? "bg-emerald-50 text-emerald-600" : "bg-rose-50 text-rose-600"
                                }`}>
                                  <Wallet className="w-5 h-5" />
                                </div>
                                <div>
                                  <div className="flex items-center gap-2">
                                    <p className="font-bold text-gray-900 text-sm">{deposit.userEmail || "User ID: " + (deposit.userId || 'Unknown')}</p>
                                    <Badge className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 border-none ${
                                      isPending ? "bg-amber-100 text-amber-800" : isApproved ? "bg-emerald-100 text-emerald-800" : "bg-rose-100 text-rose-800"
                                    }`}>
                                      {deposit.status || 'pending'}
                                    </Badge>
                                  </div>
                                  <p className="text-[11px] text-gray-400 mt-0.5">{dateStr}</p>
                                </div>
                              </div>

                              <div className="text-left sm:text-right">
                                <span className="text-[10px] uppercase font-bold text-gray-400 tracking-wider block">Requested Amount</span>
                                <span className="text-xl font-extrabold text-emerald-600">₹{Number(deposit.amount || 0).toFixed(2)}</span>
                              </div>
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                              <div className="space-y-1 bg-gray-50 p-3 rounded-xl border border-gray-100">
                                <div className="flex items-center justify-between">
                                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">12-Digit UTR / Ref No.</p>
                                  {deposit.utr && (
                                    <button 
                                      onClick={() => {
                                        navigator.clipboard.writeText(deposit.utr);
                                        toast.success("UTR copied to clipboard!");
                                      }}
                                      className="text-[10px] font-bold text-primary hover:underline"
                                    >
                                      Copy UTR
                                    </button>
                                  )}
                                </div>
                                <p className="text-sm font-mono font-bold text-gray-800 tracking-wider">
                                  {deposit.utr || "Not Provided"}
                                </p>
                              </div>

                              <div className="space-y-1 bg-gray-50 p-3 rounded-xl border border-gray-100 flex items-center justify-between">
                                <div>
                                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Payment Proof</p>
                                  <p className="text-xs text-gray-600 font-medium">
                                    {deposit.screenshotUrl ? "Screenshot Uploaded" : "No Screenshot"}
                                  </p>
                                </div>
                                {deposit.screenshotUrl ? (
                                  <Button 
                                    variant="outline" 
                                    size="sm"
                                    className="text-xs text-indigo-600 border-indigo-200 hover:bg-indigo-50 font-bold h-8 rounded-lg"
                                    onClick={() => setSelectedScreenshot(deposit.screenshotUrl)}
                                  >
                                    <ImageIcon className="w-3.5 h-3.5 mr-1" />
                                    View Image
                                  </Button>
                                ) : (
                                  <span className="text-[10px] text-gray-400 font-bold">N/A</span>
                                )}
                              </div>
                            </div>

                            {/* Actions if Pending */}
                            {isPending && (
                              <div className="flex gap-3 pt-1">
                                <Button 
                                  className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white font-bold h-11 rounded-xl shadow-md shadow-emerald-600/20"
                                  onClick={() => handleDepositAction(deposit, 'approved')}
                                  disabled={processingActions.has(deposit.id)}
                                >
                                  <CheckCircle2 className={cn("w-4 h-4 mr-2", processingActions.has(deposit.id) && "animate-spin")} />
                                  {processingActions.has(deposit.id) ? "Crediting Balance..." : `Approve & Add ₹${Number(deposit.amount || 0).toFixed(0)} to User Wallet`}
                                </Button>
                                <Button 
                                  variant="outline"
                                  className="text-rose-600 border-rose-200 hover:bg-rose-50 font-bold h-11 rounded-xl px-5"
                                  onClick={() => handleDepositAction(deposit, 'cancelled')}
                                  disabled={processingActions.has(deposit.id)}
                                >
                                  <XCircle className="w-4 h-4 mr-1.5" />
                                  Reject
                                </Button>
                              </div>
                            )}

                            {/* Verification metadata if processed */}
                            {!isPending && (
                              <div className="text-[11px] text-gray-400 bg-gray-50/70 p-2.5 rounded-xl flex items-center justify-between border border-gray-100">
                                <span>Status: <b className="text-gray-700 capitalize">{deposit.status}</b></span>
                                <span>Processed: {deposit.processedBy || 'System/Admin'}</span>
                              </div>
                            )}
                          </CardContent>
                        </Card>
                      );
                    });
                  })()}
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
                <div>
                  <h2 className="text-lg font-bold">Manage Users</h2>
                  <p className="text-xs text-gray-500">Search users and update wallet balances</p>
                </div>
                <div className="flex flex-wrap items-center w-full md:w-auto gap-2">
                  <div className="relative flex-1 md:w-72">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
                    <Input 
                      placeholder="Search email, name or ID..." 
                      className="pl-9 pr-8 rounded-xl bg-white w-full"
                      value={userSearch}
                      onChange={(e) => setUserSearch(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleSearchUser(true);
                        }
                      }}
                    />
                    {userSearch && (
                      <button
                        type="button"
                        onClick={() => {
                          setUserSearch("");
                          axios.post("/api/admin/search-user", { query: "" }).then(res => {
                            if (res.data && res.data.users) setAllUsers(res.data.users);
                          });
                        }}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-xs font-bold"
                      >
                        ✕
                      </button>
                    )}
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
                        <label className="text-xs font-bold uppercase tracking-wider text-primary font-bold">Backend Server URL (Optional override)</label>
                        <button
                          type="button"
                          onClick={() => setBackendApiUrl(window.location.origin)}
                          className="text-[10px] text-primary hover:underline font-semibold"
                        >
                          Use Current Site Domain
                        </button>
                      </div>
                      <Input 
                        placeholder="e.g. Leave blank or use current origin" 
                        value={backendApiUrl}
                        onChange={(e) => setBackendApiUrl(e.target.value)}
                        className="rounded-xl h-12 border-primary/50 focus:border-primary"
                      />
                    </div>
                  </div>
                  <p className="text-[10px] text-gray-500 mt-[-12px]">
                    Backend API Server: Default uses current origin automatically.
                  </p>

                  {(() => {
                    const hostname = window.location.hostname;
                    const isCustomDomain = !hostname.includes("run.app") && !hostname.includes("localhost") && !hostname.includes("127.0.0.1");
                    if (isCustomDomain) {
                      return (
                        <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-2xl p-4 space-y-1 mt-2">
                          <p className="text-emerald-400 font-bold text-xs uppercase tracking-wider flex items-center gap-1.5">
                            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                            Custom Domain Active ({hostname})
                          </p>
                          <p className="text-xs text-gray-300 leading-relaxed">
                            आपकी वेबसाइट कस्टम डोमेन पर एक्टिव है। सभी API कॉल्स और SMM ऑर्डर्स सीधे Cloud Run Backend Server से सुरक्षित रूप से कनेक्टेड हैं।
                          </p>
                        </div>
                      );
                    }
                    return null;
                  })()}

                  {/* QR Payment Methods Toggle: Instant Auto QR vs Manual UPI QR */}
                  <div className="border border-blue-100 bg-gradient-to-br from-blue-50/50 via-white to-emerald-50/40 p-4 rounded-3xl shadow-xs space-y-4">
                    <div className="flex items-center gap-2.5">
                      <div className="p-2 bg-blue-600 text-white rounded-xl shadow-xs">
                        <QrCode className="w-5 h-5" />
                      </div>
                      <div>
                        <h3 className="font-bold text-sm text-gray-900">QR Payment Methods Control (भुगतान विकल्प चालू / बंद करें)</h3>
                        <p className="text-[11px] text-gray-500">
                          अपनी पसंद के अनुसार "Instant Auto QR" या "Manual UPI QR" को On/Off करें। Off करने पर वह ऑप्शन Add Funds screen में ग्राहक को नहीं दिखेगा।
                        </p>
                      </div>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                      {/* 1. Instant Auto QR Toggle */}
                      <div className="p-3.5 rounded-2xl border bg-white flex flex-col justify-between space-y-3 shadow-xs">
                        <div className="flex items-start justify-between gap-3">
                          <div className="space-y-1">
                            <div className="flex items-center gap-1.5">
                              <Zap className="w-4 h-4 text-emerald-600 fill-emerald-600" />
                              <h4 className="font-bold text-xs text-gray-900">Instant Auto QR (Zero-UTR)</h4>
                            </div>
                            <p className="text-[10px] text-gray-500 leading-relaxed">
                              ग्राहक dynamic QR स्कैन करता है और 2 सेकंड में बिना 12-digit UTR डाले बैलेंस ऑटो-क्रेडिट हो जाता है।
                            </p>
                          </div>
                          <div 
                            className={cn(
                              "w-12 h-6 rounded-full p-1 cursor-pointer transition-colors duration-200 shrink-0",
                              instantQrEnabled ? "bg-emerald-600" : "bg-gray-200"
                            )}
                            onClick={() => setInstantQrEnabled(!instantQrEnabled)}
                          >
                            <div className={cn(
                              "w-4 h-4 bg-white rounded-full transition-transform duration-200 shadow-xs",
                              instantQrEnabled ? "translate-x-6" : "translate-x-0"
                            )} />
                          </div>
                        </div>
                        <div className="text-[10px] font-bold">
                          {instantQrEnabled ? (
                            <span className="text-emerald-700 bg-emerald-100/80 px-2 py-0.5 rounded-md">✓ ON (Customer ko dikhega)</span>
                          ) : (
                            <span className="text-rose-600 bg-rose-50 px-2 py-0.5 rounded-md">✕ OFF (Hidden from payment screen)</span>
                          )}
                        </div>
                      </div>

                      {/* 2. Manual UPI QR Toggle */}
                      <div className="p-3.5 rounded-2xl border bg-white flex flex-col justify-between space-y-3 shadow-xs">
                        <div className="flex items-start justify-between gap-3">
                          <div className="space-y-1">
                            <div className="flex items-center gap-1.5">
                              <QrCode className="w-4 h-4 text-blue-600" />
                              <h4 className="font-bold text-xs text-gray-900">Manual UPI QR (12-Digit UTR)</h4>
                            </div>
                            <p className="text-[10px] text-gray-500 leading-relaxed">
                              ग्राहक QR स्कैन करने के बाद 12-अंकों का UTR नंबर डालकर बैलेंस कन्फर्म करता है।
                            </p>
                          </div>
                          <div 
                            className={cn(
                              "w-12 h-6 rounded-full p-1 cursor-pointer transition-colors duration-200 shrink-0",
                              manualQrEnabled ? "bg-blue-600" : "bg-gray-200"
                            )}
                            onClick={() => setManualQrEnabled(!manualQrEnabled)}
                          >
                            <div className={cn(
                              "w-4 h-4 bg-white rounded-full transition-transform duration-200 shadow-xs",
                              manualQrEnabled ? "translate-x-6" : "translate-x-0"
                            )} />
                          </div>
                        </div>
                        <div className="text-[10px] font-bold">
                          {manualQrEnabled ? (
                            <span className="text-blue-700 bg-blue-100/80 px-2 py-0.5 rounded-md">✓ ON (Customer ko dikhega)</span>
                          ) : (
                            <span className="text-rose-600 bg-rose-50 px-2 py-0.5 rounded-md">✕ OFF (Hidden from payment screen)</span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>

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

                      <div className="border-t pt-6 mt-4 space-y-4">
                        <div className="flex items-center gap-2 mb-2">
                          <Palette className="w-5 h-5 text-primary shrink-0" />
                          <div>
                            <h3 className="font-bold text-sm">Website Theme Color Accent (वेबसाइट थीम का मुख्य रंग)</h3>
                            <p className="text-[10px] text-gray-500">Select a unique and beautiful theme color for the entire website. All primary accents, buttons, and visual details will dynamically adapt.</p>
                          </div>
                        </div>

                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                          {[
                            { id: "charcoal", name: "Default Charcoal", hindi: "क्लासिक चारकोल", color: "#1e293b", desc: "Original deep graphite/charcoal look" },
                            { id: "indigo", name: "Royal Indigo", hindi: "शाही इंडिगो", color: "#4f46e5", desc: "Vibrant and trendy brand blue" },
                            { id: "emerald", name: "Emerald Garden", hindi: "पन्ना हरा", color: "#059669", desc: "Fresh, secure, and trust-inspiring green" },
                            { id: "teal", name: "Ocean Teal", hindi: "महासागर चैती", color: "#0d9488", desc: "Cool, clean, and modern ocean style" },
                            { id: "rose", name: "Crimson Rose", hindi: "सिंदूरी लाल", color: "#e11d48", desc: "Passionate, elegant crimson accent" },
                            { id: "amber", name: "Golden Amber", hindi: "सुनहरा एम्बर", color: "#d97706", desc: "Warm and classy solar glow" },
                            { id: "violet", name: "Midnight Violet", hindi: "बैंगनी ड्रीम", color: "#7c3aed", desc: "Classic wholesale panel design" }
                          ].map((t) => (
                            <button
                              key={t.id}
                              type="button"
                              onClick={() => setSelectedTheme(t.id)}
                              className={cn(
                                "relative flex flex-col items-start p-3 rounded-2xl border-2 text-left transition-all duration-300 hover:scale-[1.02] cursor-pointer",
                                selectedTheme === t.id 
                                  ? "border-primary bg-primary/5 shadow-md shadow-primary/5" 
                                  : "border-gray-150 bg-white hover:border-gray-300"
                              )}
                            >
                              <div className="flex items-center justify-between w-full mb-2">
                                <span 
                                  className="w-6 h-6 rounded-full border shadow-sm shrink-0" 
                                  style={{ backgroundColor: t.color }}
                                />
                                {selectedTheme === t.id && (
                                  <div className="p-0.5 bg-primary rounded-full text-white">
                                    <Check className="w-3.5 h-3.5" />
                                  </div>
                                )}
                              </div>
                              <h4 className="font-bold text-xs text-gray-900 leading-tight">{t.name}</h4>
                              <p className="text-[9px] font-bold text-primary mb-1">{t.hindi}</p>
                              <p className="text-[8px] text-gray-400 leading-normal">{t.desc}</p>
                            </button>
                          ))}
                        </div>
                      </div>
                      
                      <div className="border-t pt-6 mt-6 space-y-4">
                        <div className="flex items-center gap-2 mb-2">
                          <svg className="w-5 h-5 text-primary shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
                          </svg>
                          <div>
                            <h3 className="font-bold text-sm">Festival Special Themes (त्योहार स्पेशल थीम)</h3>
                            <p className="text-[10px] text-gray-500">Enable an immersive glowing festival theme overlay for the entire website. (Select 'Normal' to disable)</p>
                          </div>
                        </div>

                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                          {[
                            { id: "none", name: "Normal (None)", hindi: "सामान्य दिन", color: "#64748b", icon: "☀️" },
                            { id: "diwali", name: "Happy Diwali", hindi: "दीपावली", color: "#f97316", icon: "🪔" },
                            { id: "eid", name: "Eid Mubarak", hindi: "ईद", color: "#10b981", icon: "🌙" },
                            { id: "holi", name: "Happy Holi", hindi: "होली", color: "#ec4899", icon: "🎨" },
                            { id: "christmas", name: "Merry Christmas", hindi: "क्रिसमस", color: "#ef4444", icon: "🎄" },
                            { id: "bakraeid", name: "Happy Bakra Eid", hindi: "बकरीद", color: "#059669", icon: "🐐" },
                            { id: "rakshabandhan", name: "Raksha Bandhan", hindi: "रक्षाबंधन", color: "#e11d48", icon: "🪢" }
                          ].map((t) => (
                            <button
                              key={t.id}
                              type="button"
                              onClick={() => {
                                setSelectedFestivalTheme(t.id);
                                // Dispatch event for instant preview
                                window.dispatchEvent(new CustomEvent("festivalThemePreview", { detail: t.id }));
                              }}
                              className={cn(
                                "relative flex flex-col items-center p-3 rounded-2xl border-2 text-center transition-all duration-300 hover:scale-[1.02] cursor-pointer",
                                selectedFestivalTheme === t.id 
                                  ? "border-primary bg-primary/5 shadow-md shadow-primary/5" 
                                  : "border-gray-150 bg-white hover:border-gray-300"
                              )}
                            >
                              <div className="text-3xl mb-2 drop-shadow-sm">{t.icon}</div>
                              <h4 className="font-bold text-xs text-gray-900 leading-tight">{t.name}</h4>
                              <p className="text-[9px] font-bold text-primary mb-1 mt-0.5" style={{ color: selectedFestivalTheme === t.id ? t.color : '#64748b' }}>{t.hindi}</p>
                              {selectedFestivalTheme === t.id && (
                                <div className="absolute top-2 right-2 p-0.5 bg-primary rounded-full text-white shadow-sm">
                                  <Check className="w-3.5 h-3.5" />
                                </div>
                              )}
                            </button>
                          ))}
                        </div>
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
                            <option value="paytm_business">Paytm Business (Auto Webhook & Status)</option>
                            <option value="phonepe_business">PhonePe Business (Auto Webhook & Status)</option>
                            <option value="upigateway">UPIGATEWAY.COM (Verify API)</option>
                            <option value="smmqr">SMMQR.COM (UPI Auto)</option>
                            <option value="vpaapi">VPAAPI.COM (Verify API)</option>
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
                          <p className="text-[11px] text-primary font-bold leading-relaxed">
                            ⚡ Instant Auto-Verification Active: When a user pays and enters their 12-digit UTR, the system verifies with {qrAutoProvider.toUpperCase()} / Paytm / PhonePe instantly and credits their wallet balance with zero manual admin delay.
                          </p>
                          
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2 border-t border-gray-100">
                            <div className="bg-gray-50 p-2.5 rounded-xl border border-gray-100">
                              <p className="text-[10px] font-bold text-gray-700 uppercase mb-1">Paytm Business Webhook URL</p>
                              <div className="flex items-center gap-1.5">
                                <code className="text-[9px] font-mono text-primary break-all flex-1">
                                  {window.location.origin}/api/webhooks/paytm
                                </code>
                                <Button 
                                  variant="outline" 
                                  size="sm" 
                                  className="h-6 px-2 text-[9px] font-bold shrink-0"
                                  onClick={() => {
                                    navigator.clipboard.writeText(`${window.location.origin}/api/webhooks/paytm`);
                                    toast.success("Paytm Webhook URL copied!");
                                  }}
                                >
                                  Copy
                                </Button>
                              </div>
                            </div>

                            <div className="bg-gray-50 p-2.5 rounded-xl border border-gray-100">
                              <p className="text-[10px] font-bold text-gray-700 uppercase mb-1">PhonePe Business Webhook URL</p>
                              <div className="flex items-center gap-1.5">
                                <code className="text-[9px] font-mono text-primary break-all flex-1">
                                  {window.location.origin}/api/webhooks/phonepe
                                </code>
                                <Button 
                                  variant="outline" 
                                  size="sm" 
                                  className="h-6 px-2 text-[9px] font-bold shrink-0"
                                  onClick={() => {
                                    navigator.clipboard.writeText(`${window.location.origin}/api/webhooks/phonepe`);
                                    toast.success("PhonePe Webhook URL copied!");
                                  }}
                                >
                                  Copy
                                </Button>
                              </div>
                            </div>
                          </div>

                          {qrAutoProvider === "upigateway" && (
                            <div className="pt-2 border-t border-gray-100">
                              <p className="text-[10px] font-bold text-gray-500 uppercase mb-1">UPIGateway Webhook URL</p>
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
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    {/* SMS FORWARDER AUTOMATIC PAYMENT VERIFICATION */}
                    <div className="p-6 bg-gradient-to-br from-indigo-50/70 via-white to-purple-50/50 rounded-3xl border-2 border-indigo-200/80 shadow-sm space-y-6">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                        <div className="flex items-start sm:items-center gap-3">
                          <div className="p-3 bg-indigo-600 text-white rounded-2xl shadow-md shadow-indigo-200">
                            <Smartphone className="w-6 h-6" />
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <h3 className="text-base font-black text-gray-900 tracking-tight">
                                SMS Forwarder Auto-Verification
                              </h3>
                              <span className="px-2 py-0.5 text-[10px] font-black uppercase tracking-wider bg-indigo-100 text-indigo-700 rounded-full border border-indigo-200">
                                Zero Gateway Needed
                              </span>
                            </div>
                            <p className="text-xs text-gray-500 mt-0.5">
                              Apne phone se Bank/UPI SMS ko forward karke UTR auto-match karein aur user ka wallet turant credit karein.
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center gap-3">
                          <label className="text-xs font-black uppercase tracking-wider text-gray-600">
                            {smsForwarderEnabled ? "Active" : "Disabled"}
                          </label>
                          <div 
                            onClick={() => setSmsForwarderEnabled(!smsForwarderEnabled)}
                            className={cn(
                              "w-12 h-6 flex items-center rounded-full p-1 cursor-pointer transition-colors duration-300",
                              smsForwarderEnabled ? "bg-indigo-600" : "bg-gray-300"
                            )}
                          >
                            <div className={cn(
                              "bg-white w-4 h-4 rounded-full shadow-md transform transition-transform duration-300",
                              smsForwarderEnabled ? "translate-x-6" : "translate-x-0"
                            )} />
                          </div>
                        </div>
                      </div>

                      {/* Setup Details & Webhook URLs */}
                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                        {/* Webhook URL Box */}
                        <div className="p-4 bg-white rounded-2xl border border-indigo-100 shadow-sm space-y-3">
                          <label className="text-[11px] font-black uppercase tracking-wider text-indigo-900 flex items-center gap-1.5">
                            <Zap className="w-3.5 h-3.5 text-indigo-600" />
                            Your SMS Webhook URL (Android App me daalein)
                          </label>

                          {/* Custom Domain Webhook URL */}
                          <div className="space-y-1">
                            <span className="text-[10px] font-bold text-gray-500 uppercase">Live Domain Webhook (Recommended)</span>
                            <div className="flex items-center gap-2 bg-indigo-50/50 p-2.5 rounded-xl border border-indigo-200">
                              <code className="text-xs font-mono font-bold text-indigo-700 select-all flex-1 break-all">
                                https://www.pyaresmmpanel.online/api/sms-webhook
                              </code>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="h-7 px-2.5 text-[11px] font-bold bg-white border-indigo-200 hover:bg-indigo-50 text-indigo-700 shrink-0 shadow-sm"
                                onClick={() => {
                                  navigator.clipboard.writeText("https://www.pyaresmmpanel.online/api/sms-webhook");
                                  toast.success("Live Domain Webhook URL copied!");
                                }}
                              >
                                <Copy className="w-3 h-3 mr-1" />
                                Copy
                              </Button>
                            </div>
                          </div>

                          {/* Current Origin Webhook URL */}
                          {window.location.origin !== "https://www.pyaresmmpanel.online" && (
                            <div className="space-y-1 pt-1 border-t border-gray-100">
                              <span className="text-[10px] font-bold text-gray-500 uppercase">Current Environment URL</span>
                              <div className="flex items-center gap-2 bg-gray-50 p-2 rounded-xl border border-gray-200">
                                <code className="text-[11px] font-mono font-bold text-gray-700 select-all flex-1 break-all">
                                  {window.location.origin}/api/sms-webhook
                                </code>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  className="h-6 px-2 text-[10px] font-bold text-gray-600 shrink-0"
                                  onClick={() => {
                                    navigator.clipboard.writeText(`${window.location.origin}/api/sms-webhook`);
                                    toast.success("Current Webhook URL copied!");
                                  }}
                                >
                                  Copy
                                </Button>
                              </div>
                            </div>
                          )}

                          <p className="text-[10px] text-gray-400">
                            Method: <b>POST</b> (or GET) | Supports JSON, Plain Text, Form-URL-Encoded.
                          </p>
                        </div>

                        {/* Secret Token Box */}
                        <div className="p-4 bg-white rounded-2xl border border-indigo-100 shadow-sm space-y-2">
                          <label className="text-[11px] font-black uppercase tracking-wider text-indigo-900 flex items-center gap-1.5">
                            <Key className="w-3.5 h-3.5 text-indigo-600" />
                            Secret Token (Optional Security)
                          </label>
                          <div className="flex items-center gap-2">
                            <Input
                              value={smsForwarderSecret}
                              onChange={(e) => setSmsForwarderSecret(e.target.value)}
                              placeholder="e.g. smm_secret_token_123"
                              className="h-10 text-xs font-mono font-bold"
                            />
                            <Button
                              type="button"
                              variant="secondary"
                              size="sm"
                              className="h-10 px-3 text-xs font-bold shrink-0"
                              onClick={() => {
                                const randomSecret = "smm_" + Math.random().toString(36).substring(2, 10);
                                setSmsForwarderSecret(randomSecret);
                                toast.success("Generated secure secret key!");
                              }}
                            >
                              Generate
                            </Button>
                          </div>
                          <p className="text-[10px] text-gray-400">
                            App header: <code className="text-indigo-600">x-sms-secret</code> ya URL me: <code className="text-indigo-600">?secret={smsForwarderSecret || "YOUR_SECRET"}</code>
                          </p>
                        </div>
                      </div>

                      {/* Manual UTR Credit / Resolve Tool */}
                      <div className="p-4 bg-emerald-50/60 rounded-2xl border border-emerald-200 shadow-sm space-y-3">
                        <div className="flex items-center justify-between">
                          <label className="text-xs font-black uppercase tracking-wider text-emerald-900 flex items-center gap-1.5">
                            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                            Manual UTR Resolver & Instant Wallet Credit
                          </label>
                          <span className="text-[10px] font-bold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full">
                            Instant Fix
                          </span>
                        </div>
                        <p className="text-[11px] text-emerald-800">
                          Agar kisi user ka UTR SMS app se aane me deri ho rahi hai ya miss ho gaya hai, to yahan UTR aur Amount daal kar turant user ke wallet me credit kar sakte hain:
                        </p>
                        <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
                          <Input
                            placeholder="12-digit UTR (e.g. 378642269354)"
                            value={manualUtr}
                            onChange={(e) => setManualUtr(e.target.value)}
                            className="h-10 text-xs font-mono font-bold bg-white"
                          />
                          <Input
                            placeholder="Amount (₹)"
                            type="number"
                            value={manualAmount}
                            onChange={(e) => setManualAmount(e.target.value)}
                            className="h-10 text-xs font-bold bg-white"
                          />
                          <Input
                            placeholder="User Email (optional if pending)"
                            value={manualUserEmail}
                            onChange={(e) => setManualUserEmail(e.target.value)}
                            className="h-10 text-xs bg-white"
                          />
                          <Button
                            type="button"
                            onClick={() => handleManualResolvePayment()}
                            disabled={isResolvingManual || !manualUtr}
                            className="h-10 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shrink-0 shadow-sm"
                          >
                            {isResolvingManual ? "Crediting..." : "Credit Wallet Now"}
                          </Button>
                        </div>
                      </div>

                      {/* Pending User Claims Box */}
                      {smsPendingUsers && smsPendingUsers.length > 0 && (
                        <div className="p-4 bg-amber-50 rounded-2xl border border-amber-200 shadow-sm space-y-3">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-black uppercase tracking-wider text-amber-900 flex items-center gap-1.5">
                              <AlertCircle className="w-4 h-4 text-amber-600" />
                              Users Waiting for SMS Verification ({smsPendingUsers.length})
                            </span>
                            <span className="text-[10px] font-bold text-amber-700">Click button to credit immediately</span>
                          </div>
                          <div className="space-y-2">
                            {smsPendingUsers.map((pending: any) => (
                              <div key={pending.utr} className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-3 bg-white rounded-xl border border-amber-200 shadow-xs">
                                <div>
                                  <div className="flex items-center gap-2">
                                    <span className="font-mono font-bold text-xs text-amber-900">UTR: {pending.utr}</span>
                                    <span className="font-bold text-xs text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                                      ₹{pending.amount || 0}
                                    </span>
                                  </div>
                                  <p className="text-[11px] text-gray-500 mt-0.5">
                                    User: <b>{pending.userEmail || pending.userId}</b> • Time: {new Date(pending.timestamp).toLocaleTimeString()}
                                  </p>
                                </div>
                                <Button
                                  type="button"
                                  size="sm"
                                  onClick={() => handleManualResolvePayment(pending.utr, pending.amount, pending.userEmail)}
                                  disabled={isResolvingManual}
                                  className="h-8 px-3 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shrink-0 shadow-sm"
                                >
                                  ⚡ 1-Click Approve & Credit ₹{pending.amount}
                                </Button>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Setup Guide Accordion / Steps */}
                      <div className="p-4 bg-indigo-50/50 rounded-2xl border border-indigo-100/80 space-y-2.5">
                        <p className="text-xs font-bold text-indigo-950 flex items-center gap-1.5">
                          <span>📋</span> 3 Simple Steps to Setup Free Android SMS Forwarder:
                        </p>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs text-indigo-900/90 font-medium">
                          <div className="bg-white/80 p-3 rounded-xl border border-indigo-100">
                            <b className="text-indigo-600 block mb-1">1. Install App</b>
                            Play Store se <b>"SMS Forwarder"</b> (developer: bogkonstantin) ya F-Droid se download karein.
                          </div>
                          <div className="bg-white/80 p-3 rounded-xl border border-indigo-100">
                            <b className="text-indigo-600 block mb-1">2. Target: Webhook</b>
                            Add Rule &gt; Destination: <b>Webhook URL (POST)</b> me upar wala URL paste karein.
                          </div>
                          <div className="bg-white/80 p-3 rounded-xl border border-indigo-100">
                            <b className="text-indigo-600 block mb-1">3. Template / Body</b>
                            App me: Template <b>{'{"from":"%from%","text":"%text%"}'}</b> likhein (dono side % lagayein), ya Template ko <b>Khali / Default</b> chhod dein!
                          </div>
                        </div>
                        <p className="text-[11px] text-amber-800 bg-amber-50 p-2.5 rounded-xl border border-amber-200">
                          💡 <b>Zaroori baat:</b> App me jo "Test" button hota hai, wo real SMS nahi bhejta (wo sirf <code>"%text"</code> bhejta hai). Real test karne ke liye kisi dusre phone se <b>₹1 ka actual UPI payment</b> apne QR code par bhejein taaki real bank SMS website par forward ho sake!
                        </p>
                      </div>

                      {/* Live SMS Parser Tester & Simulator */}
                      <div className="p-4 bg-white rounded-2xl border border-gray-200 shadow-sm space-y-3">
                        <div className="flex items-center justify-between">
                          <label className="text-xs font-black uppercase tracking-wider text-gray-800 flex items-center gap-1.5">
                            <Terminal className="w-4 h-4 text-indigo-600" />
                            Live SMS Parser & Tester
                          </label>
                          <div className="flex items-center gap-2">
                            <label className="flex items-center gap-1 text-[11px] font-bold text-gray-600 cursor-pointer">
                              <input 
                                type="checkbox"
                                checked={smsTestSimulate}
                                onChange={(e) => setSmsTestSimulate(e.target.checked)}
                                className="rounded text-indigo-600 focus:ring-indigo-500"
                              />
                              Simulate & Add to Available Queue
                            </label>
                          </div>
                        </div>

                        {/* Quick Sample Buttons */}
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-[10px] font-bold text-gray-400">Quick Test Samples:</span>
                          <button
                            type="button"
                            onClick={() => {
                              const s = "Payment of Rs. 100.00 received via PhonePe from Customer. UPI Ref: 425123456789";
                              setSmsTestText(s);
                              handleTestSmsParse(s);
                            }}
                            className="px-2 py-1 bg-purple-50 text-purple-700 hover:bg-purple-100 rounded-lg text-[10px] font-bold border border-purple-200 transition-colors"
                          >
                            PhonePe ₹100
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              const s = "Rs 500.00 received in your Paytm Payments Bank A/c 9876. UPI Ref no 425123456789. Check bal";
                              setSmsTestText(s);
                              handleTestSmsParse(s);
                            }}
                            className="px-2 py-1 bg-blue-50 text-blue-700 hover:bg-blue-100 rounded-lg text-[10px] font-bold border border-blue-200 transition-colors"
                          >
                            Paytm ₹500
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              const s = "Dear SBI User, your A/C ending 1234 credited by Rs 1,000.00 on 20Sep24 by transfer from User Ref No 425123456789 -SBI";
                              setSmsTestText(s);
                              handleTestSmsParse(s);
                            }}
                            className="px-2 py-1 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 rounded-lg text-[10px] font-bold border border-emerald-200 transition-colors"
                          >
                            SBI ₹1,000
                          </button>
                        </div>

                        <div className="flex gap-2">
                          <Input
                            value={smsTestText}
                            onChange={(e) => setSmsTestText(e.target.value)}
                            placeholder="Bank/UPI se aaya hua SMS yahan paste karein..."
                            className="h-10 text-xs font-medium"
                          />
                          <Button
                            type="button"
                            onClick={() => handleTestSmsParse()}
                            disabled={testingSms || !smsTestText.trim()}
                            className="h-10 px-4 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs shrink-0"
                          >
                            {testingSms ? "Parsing..." : "Test Parse"}
                          </Button>
                        </div>

                        {smsTestResult && (
                          <div className={cn(
                            "p-3 rounded-xl border text-xs space-y-1 font-medium",
                            smsTestResult.parsed?.valid 
                              ? "bg-emerald-50/80 border-emerald-200 text-emerald-800" 
                              : "bg-amber-50/80 border-amber-200 text-amber-800"
                          )}>
                            <div className="flex items-center justify-between font-bold">
                              <span>
                                {smsTestResult.parsed?.valid ? "✅ Valid Payment Detected" : "⚠️ Parsing Issue"}
                              </span>
                              {smsTestResult.parsed?.valid && (
                                <span className="text-emerald-700 text-xs">
                                  ₹{smsTestResult.parsed.amount} | UTR: {smsTestResult.parsed.utr}
                                </span>
                              )}
                            </div>
                            <p className="text-[11px] opacity-90">
                              {smsTestResult.parsed?.valid 
                                ? (smsTestResult.simulated 
                                    ? "Payment simulated! Users who enter UTR " + smsTestResult.parsed.utr + " will be credited instantly." 
                                    : "SMS pattern is 100% compatible! Enable simulation to test live user verification.") 
                                : (smsTestResult.parsed?.reason || "Could not detect valid amount or 12-digit UTR.")}
                            </p>
                          </div>
                        )}
                      </div>

                      {/* Real-time SMS Forwarder Logs */}
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-black uppercase tracking-wider text-gray-700">
                              Recent Forwarded SMS Logs ({smsLogs.length})
                            </span>
                            {loadingSmsLogs && <span className="text-[10px] text-gray-400">Refreshing...</span>}
                          </div>
                          <div className="flex items-center gap-2">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-7 px-2.5 text-[11px] font-bold"
                              onClick={fetchSmsLogs}
                            >
                              <RefreshCw className="w-3 h-3 mr-1" />
                              Refresh
                            </Button>
                            {smsLogs.length > 0 && (
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-7 px-2 text-[11px] font-bold text-red-500 hover:text-red-600 hover:bg-red-50"
                                onClick={handleClearSmsLogs}
                              >
                                Clear
                              </Button>
                            )}
                          </div>
                        </div>

                        {smsLogs.length === 0 ? (
                          <div className="p-6 text-center bg-white rounded-2xl border border-gray-100 text-xs text-gray-400">
                            No forwarded SMS received yet. Forward your first Bank/UPI SMS or use the test parser above.
                          </div>
                        ) : (
                          <div className="max-h-60 overflow-y-auto rounded-2xl border border-gray-200 divide-y divide-gray-100 bg-white shadow-inner">
                            {smsLogs.map((log: any) => (
                              <div key={log.id} className="p-3 text-xs space-y-1 hover:bg-gray-50/80 transition-colors">
                                <div className="flex items-center justify-between">
                                  <div className="flex items-center gap-2">
                                    <span className="font-bold text-gray-800">{log.sender || "SMS_APP"}</span>
                                    {log.amount > 0 && (
                                      <span className="font-black text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                                        ₹{log.amount}
                                      </span>
                                    )}
                                    {log.utr && (
                                      <span className="font-mono text-[11px] text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-md border border-indigo-100">
                                        UTR: {log.utr}
                                      </span>
                                    )}
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <span className={cn(
                                      "px-2 py-0.5 text-[10px] font-black uppercase rounded-full",
                                      log.status === "available" && "bg-blue-100 text-blue-700",
                                      (log.status === "claimed" || log.status === "claimed_auto") && "bg-emerald-100 text-emerald-700",
                                      (log.status === "invalid" || log.status === "invalid_format") && "bg-amber-100 text-amber-800",
                                      log.status?.startsWith("ignored") && "bg-gray-100 text-gray-500"
                                    )}>
                                      {log.status === "available" ? "Ready for user" : 
                                       log.status?.startsWith("claimed") ? `Claimed (${log.claimedEmail || log.claimedBy || "User"})` : 
                                       (log.status === "invalid" || log.status === "invalid_format") ? "No UTR/Amount detected" :
                                       "Ignored"}
                                    </span>
                                    <span className="text-[10px] text-gray-400">
                                      {new Date(log.timestamp).toLocaleTimeString()}
                                    </span>
                                  </div>
                                </div>
                                <p className="text-[11px] text-gray-500 font-mono break-all">
                                  {log.rawText}
                                </p>
                                {log.rawText?.includes("%text") && (
                                  <p className="text-[10px] text-amber-700 bg-amber-50 p-1.5 rounded border border-amber-200">
                                    ⚠️ <b>Notice:</b> App sent literal <code>"%text"</code> instead of real SMS text. In app settings use <code>%text%</code> or select Default JSON format.
                                  </p>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
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

            <TabsContent value="telegram-bot" className="space-y-6">
              <TelegramBotTab />
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
            <div className="md:col-span-2 space-y-2">
              <label className="text-xs font-bold uppercase tracking-wider text-gray-400">Service Mode</label>
              <div className="grid grid-cols-3 gap-2 p-1 bg-gray-100 rounded-xl border border-gray-200">
                <button
                  type="button"
                  onClick={() => { setEditServiceMode("single"); setEditIsPackage(false); }}
                  className={`py-2 text-xs font-semibold rounded-lg transition-all ${editServiceMode === "single" ? "bg-primary text-white shadow" : "text-gray-600 hover:text-gray-900"}`}
                >
                  Normal Service
                </button>
                <button
                  type="button"
                  onClick={() => { setEditServiceMode("package"); setEditIsPackage(true); }}
                  className={`py-2 text-xs font-semibold rounded-lg transition-all ${editServiceMode === "package" ? "bg-primary text-white shadow" : "text-gray-600 hover:text-gray-900"}`}
                >
                  Single Package
                </button>
                <button
                  type="button"
                  onClick={() => { setEditServiceMode("combo"); setEditIsPackage(true); }}
                  className={`py-2 text-xs font-semibold rounded-lg transition-all ${editServiceMode === "combo" ? "bg-gradient-to-r from-purple-600 to-indigo-600 text-white shadow" : "text-gray-600 hover:text-gray-900"}`}
                >
                  🔥 Multi Combo
                </button>
              </div>
            </div>

            {editServiceMode === "combo" ? (
              <div className="md:col-span-2 space-y-4 p-4 bg-purple-50 rounded-2xl border border-purple-200">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-bold text-purple-900 flex items-center gap-2">
                    <span>🔥</span> Multi-Service Combo Builder
                  </h4>
                  <span className="text-[10px] text-purple-700 bg-purple-100 px-2 py-0.5 rounded-full border border-purple-200">
                    Orders send automatically for each service
                  </span>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase tracking-wider text-gray-500">Combo Total Special Price (INR)</label>
                  <Input 
                    placeholder="e.g. 99" 
                    className="rounded-xl bg-white"
                    type="number"
                    value={editPackagePrice}
                    onChange={(e) => setEditPackagePrice(e.target.value)}
                  />
                </div>

                <div className="space-y-3 pt-2">
                  <label className="text-xs font-bold uppercase tracking-wider text-gray-500 block">
                    Combo Components (Services Included in 1 Link Order)
                  </label>

                  {editComboItems.map((item, idx) => (
                    <div key={idx} className="p-3 bg-white rounded-xl border border-gray-200 space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-gray-700">Component #{idx + 1}</span>
                        {editComboItems.length > 1 && (
                          <button
                            type="button"
                            onClick={() => setEditComboItems(editComboItems.filter((_, i) => i !== idx))}
                            className="text-xs text-red-500 hover:text-red-700"
                          >
                            Remove
                          </button>
                        )}
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
                        <Input
                          placeholder="Name e.g. 100k Views"
                          className="text-xs"
                          value={item.name}
                          onChange={(e) => {
                            const copy = [...editComboItems];
                            copy[idx].name = e.target.value;
                            setEditComboItems(copy);
                          }}
                        />
                        <select
                          className="w-full h-9 rounded-md bg-white border border-gray-200 text-xs px-2"
                          value={item.providerId}
                          onChange={(e) => {
                            const copy = [...editComboItems];
                            copy[idx].providerId = e.target.value;
                            setEditComboItems(copy);
                          }}
                        >
                          <option value="">Default Provider</option>
                          {providers.map(p => (
                            <option key={p.id} value={p.id}>{p.name}</option>
                          ))}
                        </select>
                        <Input
                          placeholder="Service ID e.g. 1234"
                          className="text-xs"
                          value={item.providerServiceId}
                          onChange={(e) => {
                            const copy = [...editComboItems];
                            copy[idx].providerServiceId = e.target.value;
                            setEditComboItems(copy);
                          }}
                        />
                        <Input
                          placeholder="Qty e.g. 100000"
                          type="number"
                          className="text-xs"
                          value={item.quantity}
                          onChange={(e) => {
                            const copy = [...editComboItems];
                            copy[idx].quantity = e.target.value;
                            setEditComboItems(copy);
                          }}
                        />
                      </div>
                    </div>
                  ))}

                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setEditComboItems([...editComboItems, { name: "", providerId: "", providerServiceId: "", quantity: "1000" }])}
                    className="w-full border-dashed border-purple-300 text-xs text-purple-700 hover:bg-purple-100/50"
                  >
                    + Add Another Service Component to Combo
                  </Button>
                </div>
              </div>
            ) : editServiceMode === "package" ? (
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

            {editServiceMode !== "combo" && (
              <>
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
                    {providers.map(p => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </div>
              </>
            )}
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


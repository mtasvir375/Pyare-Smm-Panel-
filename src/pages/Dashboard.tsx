import { useEffect, useState, useRef } from "react";
import { motion } from "motion/react";
import { Play, CheckCircle, Clock, ChevronRight, History, ExternalLink, Youtube, RefreshCw, AlertCircle, Trash2, Wallet, ArrowDownLeft, Copy, Check } from "lucide-react";
import CategoryIcon from "@/components/CategoryIcon";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { dbClient } from "@/lib/dbClient";
import { useAuth } from "@/context/AuthContext";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import axios from "axios";
import { toast } from "sonner";

export default function Dashboard() {
  const { user, userProfile, loading: authLoading } = useAuth();
  const [activeTab, setActiveTab] = useState<"orders" | "deposits">("orders");
  const [orders, setOrders] = useState<any[]>([]);
  const [deposits, setDeposits] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [depositsLoading, setDepositsLoading] = useState(false);
  const [checkingStatus, setCheckingStatus] = useState(false);
  const [copiedUtr, setCopiedUtr] = useState<string | null>(null);
  const statusIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const lastCheckedRef = useRef<number>(0);
  const [renderLimit] = useState(10);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [deletingOrderId, setDeletingOrderId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // Helper to parse dates/timestamps robustly in both ISO, Epoch, and DD/MM/YYYY formats
  const getTimestampMs = (val: any): number => {
    if (!val) return 0;
    if (typeof val === "number") return val;
    if (val instanceof Date) return val.getTime();
    
    // Firestore Timestamp
    if (typeof val.toDate === "function") {
      try {
        return val.toDate().getTime();
      } catch (e) {}
    }
    // Serialized Timestamp object ({ seconds, nanoseconds } or { _seconds, _nanoseconds })
    if (typeof val.seconds === "number") {
      return val.seconds * 1000 + Math.floor((val.nanoseconds || 0) / 1000000);
    }
    if (typeof val._seconds === "number") {
      return val._seconds * 1000 + Math.floor((val._nanoseconds || 0) / 1000000);
    }

    const str = String(val).trim();
    
    // Try parsing directly (ISO string, UTC format etc.)
    let parsed = Date.parse(str);
    if (!isNaN(parsed)) return parsed;

    // Handle DD/MM/YYYY or DD-MM-YYYY formats (e.g., "13/07/2026, 01:54:52" or "13-07-2026")
    const dmyRegex = /^(\d{1,2})[/\-](\d{1,2})[/\-](\d{4})(?:,\s*(\d{1,2}):(\d{2}):(\d{2}))?/;
    const match = str.match(dmyRegex);
    if (match) {
      const day = parseInt(match[1], 10);
      const month = parseInt(match[2], 10) - 1; // 0-indexed
      const year = parseInt(match[3], 10);
      const hour = match[4] ? parseInt(match[4], 10) : 0;
      const min = match[5] ? parseInt(match[5], 10) : 0;
      const sec = match[6] ? parseInt(match[6], 10) : 0;
      const date = new Date(year, month, day, hour, min, sec);
      if (!isNaN(date.getTime())) return date.getTime();
    }

    return 0;
  };

  useEffect(() => {
    if (!user) return;

    let isMounted = true;
    
    const fetchOrders = async () => {
      try {
        const uidKey = `orders_${user.uid}`;
        const emailKey = user.email ? `orders_${user.email.toLowerCase()}` : null;
        
        // 1. Check Chrome Cache (localStorage & sessionStorage) for instant 0ms rendering
        let cachedData = localStorage.getItem(uidKey) || sessionStorage.getItem(uidKey);
        if (!cachedData && emailKey) {
          cachedData = localStorage.getItem(emailKey) || sessionStorage.getItem(emailKey);
        }

        const parseOrdersList = (dataList: any[]): any[] => {
          const mergedMap = new Map();
          const uUid = user.uid;
          const uEmail = (user.email || "").trim().toLowerCase();

          if (Array.isArray(dataList)) {
            dataList.forEach(order => {
              if (!order) return;
              const orderUid = order.userId || order.user_id;
              const orderEmail = String(order.userEmail || order.user_email || "").trim().toLowerCase();
              
              const matchesUser = (orderUid && orderUid === uUid) || (uEmail && orderEmail && orderEmail === uEmail);
              if (!matchesUser) return;

              const pId = order.providerOrderId || order.provider_order_id;
              const isFailedAborted = order.status?.toLowerCase() === 'failed' && (!pId || pId === 'N/A');
              if (!isFailedAborted) {
                const key = order.id || pId || order.createdAt || order.created_at;
                if (key) {
                  mergedMap.set(key, order);
                }
              }
            });
          }

          const result = Array.from(mergedMap.values());
          result.sort((a, b) => {
            const timeA = getTimestampMs(a.createdAt || a.created_at);
            const timeB = getTimestampMs(b.createdAt || b.created_at);
            return timeB - timeA;
          });
          return result;
        };

        let initialOrders: any[] = [];
        if (cachedData) {
          try {
            const parsed = JSON.parse(cachedData);
            if (Array.isArray(parsed) && parsed.length > 0) {
              initialOrders = parseOrdersList(parsed);
              if (isMounted && initialOrders.length > 0) {
                setOrders(initialOrders.slice(0, 10));
                setLoading(false);
              }
            }
          } catch (e) {
            cachedData = null;
          }
        }

        // 2. If browser cache is cleared, load immediately from userProfile (0ms, 0 extra Firestore reads!)
        if (initialOrders.length === 0 && userProfile && Array.isArray((userProfile as any).latestOrders) && (userProfile as any).latestOrders.length > 0) {
          initialOrders = parseOrdersList((userProfile as any).latestOrders);
          if (isMounted && initialOrders.length > 0) {
            setOrders(initialOrders.slice(0, 10));
            setLoading(false);
            console.log(`[DASHBOARD] ✅ Restored ${initialOrders.length} orders instantly from persistent User Profile!`);
          }
        }

        // 3. Stale-While-Revalidate: fetch latest 10 orders from server cache/db
        try {
          const fetched = await dbClient.getUserOrders(user.uid, 10, user.email || undefined);
          if (Array.isArray(fetched) && isMounted) {
            const combined = [...initialOrders, ...fetched];
            const freshParsed = parseOrdersList(combined);

            // Strictly cap to latest 10 orders (FIFO rotation)
            const latest10 = freshParsed.slice(0, 10);
            setOrders(latest10);

            // Update local/session cache with fresh list
            const jsonStr = JSON.stringify(latest10);
            const nowStr = Date.now().toString();
            const keysToSave = [uidKey];
            if (emailKey) keysToSave.push(emailKey);

            keysToSave.forEach(k => {
              try {
                localStorage.setItem(k, jsonStr);
                localStorage.setItem(`${k}_time`, nowStr);
                sessionStorage.setItem(k, jsonStr);
                sessionStorage.setItem(`${k}_time`, nowStr);
              } catch (storageErr) {}
            });
          }
        } catch (serverErr) {
          console.warn("[DASHBOARD] Notice while fetching orders:", serverErr);
        }

      } catch (err) {
        console.error("[DASHBOARD] Error loading orders:", err);
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    const fetchDeposits = async () => {
      if (!user) return;
      try {
        const depKey = `deposits_${user.uid}`;
        const cached = localStorage.getItem(depKey) || sessionStorage.getItem(depKey);
        if (cached) {
          try {
            const parsed = JSON.parse(cached);
            if (Array.isArray(parsed) && parsed.length > 0) setDeposits(parsed.slice(0, 10));
          } catch (e) {}
        } else if (userProfile && Array.isArray((userProfile as any).latestDeposits) && (userProfile as any).latestDeposits.length > 0) {
          // If browser cache is cleared, load immediately from persistent User Profile (0ms, 0 extra reads!)
          setDeposits((userProfile as any).latestDeposits.slice(0, 10));
          console.log(`[DASHBOARD] ✅ Restored ${(userProfile as any).latestDeposits.length} deposits from persistent User Profile!`);
        }

        const fresh = await dbClient.getUserDeposits(user.uid, user.email || undefined);
        if (Array.isArray(fresh) && isMounted) {
          const latest10Deposits = fresh.slice(0, 10);
          setDeposits(latest10Deposits);
          try {
            const jsonStr = JSON.stringify(latest10Deposits);
            localStorage.setItem(depKey, jsonStr);
            sessionStorage.setItem(depKey, jsonStr);
          } catch (e) {}
        }
      } catch (depErr) {
        console.warn("[DASHBOARD] Could not load user deposits:", depErr);
      }
    };
    
    fetchOrders();
    fetchDeposits();
    
    return () => { isMounted = false; };
  }, [user, renderLimit, refreshTrigger]);

  const refreshDeposits = async () => {
    if (!user || depositsLoading) return;
    setDepositsLoading(true);
    try {
      const fresh = await dbClient.getUserDeposits(user.uid, user.email || undefined);
      if (Array.isArray(fresh)) {
        setDeposits(fresh);
        const depKey = `deposits_${user.uid}`;
        try {
          const jsonStr = JSON.stringify(fresh);
          localStorage.setItem(depKey, jsonStr);
          sessionStorage.setItem(depKey, jsonStr);
        } catch (e) {}
      }
      toast.success("Deposit history updated!");
    } catch (e) {
      toast.error("Failed to refresh deposits");
    } finally {
      setDepositsLoading(false);
    }
  };

  const checkOrdersStatus = async (force = false) => {
    if (checkingStatus || orders.length === 0) return;
    
    // Throttle checks to once every 30 minutes to save quota as per user request
    const now = Date.now();
    if (!force && lastCheckedRef.current && (now - lastCheckedRef.current < 30 * 60 * 1000)) {
      return;
    }
    
    setCheckingStatus(true);
    lastCheckedRef.current = now;
    try {
      // Only process the latest 2 orders to save reads/writes
      const ordersToProcess = orders.slice(0, 2);

      for (const order of ordersToProcess) {
        const currentStatus = (order.status || '').toLowerCase();
        
        // Only check status for orders that have a providerOrderId and are not in a final state
        if (order.providerOrderId && !['completed', 'canceled', 'refunded', 'partial'].includes(currentStatus)) {
          try {
            await axios.post("/api/sync-order-status", {
              orderId: order.id
            });
          } catch (err) {
            console.error("Error syncing status for order:", order.id, err);
          }
        }
      }

      // Rather than deleting the cache (which could result in blank screen if network is slow),
      // fetch latest orders and update the cache seamlessly!
      if (user) {
        try {
          const fresh = await dbClient.getUserOrders(user.uid, 10, user.email || undefined);
          if (Array.isArray(fresh) && fresh.length > 0) {
            const uidKey = `orders_${user.uid}`;
            const emailKey = user.email ? `orders_${user.email.toLowerCase()}` : null;
            const jsonStr = JSON.stringify(fresh);
            const nowStr = Date.now().toString();
            [uidKey, emailKey].filter(Boolean).forEach(k => {
              try {
                localStorage.setItem(k!, jsonStr);
                localStorage.setItem(`${k!}_time`, nowStr);
                sessionStorage.setItem(k!, jsonStr);
                sessionStorage.setItem(`${k!}_time`, nowStr);
              } catch (e) {}
            });
          }
        } catch (syncErr) {
          console.warn("[DASHBOARD] Could not refresh orders list:", syncErr);
        }
      }
      setRefreshTrigger(prev => prev + 1);
    } catch (error) {
      console.error("Error in checkOrdersStatus:", error);
    } finally {
      setCheckingStatus(false);
    }
  };

  const handleDeleteOrder = async (orderId: string) => {
    if (!user) return;
    setDeletingOrderId(orderId);
    try {
      const response = await axios.post("/api/orders/delete", {
        orderId,
        userId: user.uid
      });
      if (response.data.success) {
        setOrders(prev => prev.filter(o => o.id !== orderId));
        // Directly remove the deleted order from local cache to avoid reloading from DB
        const uidKey = `orders_${user.uid}`;
        const emailKey = user.email ? `orders_${user.email.toLowerCase()}` : null;
        [uidKey, emailKey].filter(Boolean).forEach(k => {
          try {
            const cachedData = localStorage.getItem(k!) || sessionStorage.getItem(k!);
            if (cachedData) {
              const parsed = JSON.parse(cachedData);
              if (Array.isArray(parsed)) {
                const filtered = parsed.filter((o: any) => o && o.id !== orderId);
                const jsonStr = JSON.stringify(filtered);
                localStorage.setItem(k!, jsonStr);
                sessionStorage.setItem(k!, jsonStr);
              }
            }
          } catch (e) {
            console.warn("Failed to update cache after deleting order:", e);
          }
        });
        setConfirmDeleteId(null);
      } else {
        console.error("Failed to delete order:", response.data.error || "Unknown error");
      }
    } catch (err: any) {
      console.error("Error deleting order:", err);
    } finally {
      setDeletingOrderId(null);
    }
  };

  // Run status check ONLY when user specifically refreshes
  // Auto-sync on mount removed to stay within Firebase free tier limits.
  useEffect(() => {
    // Component initialization logic only
  }, []);

  if (authLoading) {
    return (
      <div className="w-full max-w-xl mx-auto py-20 flex flex-col items-center justify-center space-y-4">
        <RefreshCw className="w-10 h-10 text-primary animate-spin" />
        <p className="text-gray-500 font-medium">Loading your orders...</p>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="text-center py-20">
        <p className="text-gray-500">Please log in to view your dashboard.</p>
      </div>
    );
  }

  const formatErrorMessage = (err: any): string => {
    if (!err) return "Unknown error";
    if (typeof err === "string") return err;
    if (typeof err === "object") {
      if (err.message && typeof err.message === "string") return err.message;
      if (err.error && typeof err.error === "string") return err.error;
      if (err.msg && typeof err.msg === "string") return err.msg;
      
      const keys = ["message", "error", "msg", "errors", "detail", "err"];
      for (const k of keys) {
        if (err[k]) {
          if (typeof err[k] === "string") return err[k];
        }
      }
      
      try {
        return JSON.stringify(err);
      } catch {
        return "[Object]";
      }
    }
    return String(err);
  };

  const getStatusBadge = (status: string) => {
    switch (status?.toLowerCase()) {
      case 'pending':
      case 'processing':
      case 'in progress':
      case 'approved':
      case 'completed':
        return <Badge className="bg-green-100 text-green-700 border-none font-bold text-[10px]">Completed</Badge>;
      case 'partial':
        return <Badge className="bg-yellow-100 text-yellow-700 border-none font-bold text-[10px]">Partial</Badge>;
      case 'canceled':
        return <Badge className="bg-red-100 text-red-700 border-none font-bold text-[10px]">Canceled</Badge>;
      case 'failed':
        return <Badge className="bg-red-600 text-white border-none font-bold text-[10px]">Failed</Badge>;
      case 'refunded':
        return <Badge className="bg-gray-100 text-gray-700 border-none font-bold text-[10px]">Refunded</Badge>;
      default:
        return <Badge className="bg-green-100 text-green-700 border-none font-bold text-[10px]">Completed</Badge>;
    }
  };

  const getDepositStatusBadge = (status: string) => {
    const s = String(status || '').toLowerCase();
    if (s === 'approved' || s === 'completed' || s === 'success') {
      return (
        <Badge className="bg-emerald-50 text-emerald-700 border border-emerald-200 font-bold text-[10px] flex items-center gap-1">
          <CheckCircle className="w-3 h-3 text-emerald-600" />
          Successful
        </Badge>
      );
    }
    if (s === 'pending') {
      return (
        <Badge className="bg-amber-50 text-amber-700 border border-amber-200 font-bold text-[10px] flex items-center gap-1">
          <Clock className="w-3 h-3 text-amber-600" />
          Verifying
        </Badge>
      );
    }
    return (
      <Badge className="bg-red-50 text-red-700 border border-red-200 font-bold text-[10px] flex items-center gap-1">
        <AlertCircle className="w-3 h-3 text-red-600" />
        Failed
      </Badge>
    );
  };

  const formatDepositDate = (val: any): string => {
    const ms = getTimestampMs(val);
    if (!ms) return "Recently";
    try {
      return new Date(ms).toLocaleString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: true
      });
    } catch {
      return new Date(ms).toLocaleString();
    }
  };

  const handleCopyUtr = (text: string) => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopiedUtr(text);
    toast.success("12-Digit code copied to clipboard!");
    setTimeout(() => setCopiedUtr(null), 2500);
  };

  const successfulDeposits = deposits.filter(d => {
    const s = String(d.status || '').toLowerCase();
    return s === 'approved' || s === 'completed' || s === 'success';
  });

  const totalDepositedAmount = successfulDeposits.reduce((acc, d) => {
    return acc + (Number(d.amount) || 0);
  }, 0);

  return (
    <div className="w-full max-w-xl mx-auto space-y-6">
      {/* Header with Title and Quick Switch Button */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            {activeTab === "orders" ? "My Service Orders" : "My Deposit History"}
          </h1>
          <p className="text-xs text-gray-500 mt-0.5">
            {activeTab === "orders" 
              ? `Showing latest ${orders.length} service orders (Stored persistently in your account)` 
              : `Showing latest ${deposits.length} wallet deposits (Stored persistently in your account)`}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {activeTab === "orders" ? (
            <>
              {/* Cute Deposit History button in Orders section */}
              <Button 
                variant="outline" 
                size="sm" 
                className="text-xs font-bold bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100 hover:text-emerald-800 rounded-xl px-3 py-1.5 shadow-sm transition-all flex items-center gap-1.5"
                onClick={() => setActiveTab("deposits")}
              >
                <Wallet className="w-3.5 h-3.5 text-emerald-600" />
                <span>💰 Deposit History</span>
                {deposits.length > 0 && (
                  <span className="bg-emerald-600 text-white text-[10px] px-1.5 py-0.2 rounded-full font-mono font-bold ml-0.5">
                    {deposits.length}
                  </span>
                )}
              </Button>

              <Button 
                variant="ghost" 
                size="sm" 
                className="text-xs font-bold text-gray-500 hover:text-primary rounded-xl"
                onClick={() => checkOrdersStatus(true)}
                disabled={checkingStatus}
              >
                <RefreshCw className={cn("w-3 h-3 mr-1.5", checkingStatus && "animate-spin")} />
                {checkingStatus ? "Checking..." : "Refresh"}
              </Button>
            </>
          ) : (
            <>
              {/* Button to Switch Back to Service Orders */}
              <Button 
                variant="outline" 
                size="sm" 
                className="text-xs font-bold bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100 hover:text-blue-800 rounded-xl px-3 py-1.5 shadow-sm transition-all flex items-center gap-1.5"
                onClick={() => setActiveTab("orders")}
              >
                <Play className="w-3.5 h-3.5 text-blue-600" />
                <span>📦 Service Orders</span>
                {orders.length > 0 && (
                  <span className="bg-blue-600 text-white text-[10px] px-1.5 py-0.2 rounded-full font-mono font-bold ml-0.5">
                    {orders.length}
                  </span>
                )}
              </Button>

              <Button 
                variant="ghost" 
                size="sm" 
                className="text-xs font-bold text-gray-500 hover:text-primary rounded-xl"
                onClick={refreshDeposits}
                disabled={depositsLoading}
              >
                <RefreshCw className={cn("w-3 h-3 mr-1.5", depositsLoading && "animate-spin")} />
                {depositsLoading ? "Updating..." : "Refresh"}
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Tabs Switcher for Orders vs Deposits */}
      <div className="flex p-1 bg-gray-100/90 rounded-2xl border border-gray-200/60 shadow-inner">
        <button
          onClick={() => setActiveTab("orders")}
          className={cn(
            "flex-1 flex items-center justify-center gap-2 py-2.5 text-xs font-bold rounded-xl transition-all",
            activeTab === "orders" 
              ? "bg-white text-gray-900 shadow-sm" 
              : "text-gray-500 hover:text-gray-900"
          )}
        >
          <Play className="w-3.5 h-3.5 text-primary" />
          <span>Service Orders</span>
          <span className={cn(
            "text-[10px] px-1.5 py-0.5 rounded-full font-mono font-bold",
            activeTab === "orders" ? "bg-primary/10 text-primary" : "bg-gray-200 text-gray-600"
          )}>
            {orders.length}/10
          </span>
        </button>

        <button
          onClick={() => setActiveTab("deposits")}
          className={cn(
            "flex-1 flex items-center justify-center gap-2 py-2.5 text-xs font-bold rounded-xl transition-all",
            activeTab === "deposits" 
              ? "bg-white text-emerald-700 shadow-sm" 
              : "text-gray-500 hover:text-gray-900"
          )}
        >
          <Wallet className="w-3.5 h-3.5 text-emerald-600" />
          <span>Deposit History</span>
          <span className={cn(
            "text-[10px] px-1.5 py-0.5 rounded-full font-mono font-bold",
            activeTab === "deposits" ? "bg-emerald-100 text-emerald-700" : "bg-gray-200 text-gray-600"
          )}>
            {deposits.length}/10
          </span>
        </button>
      </div>

      {/* MAIN CONTENT AREA */}
      {activeTab === "orders" ? (
        <div className="space-y-4">
          {loading ? (
            [1, 2, 3, 4, 5].map((i) => (
              <Card key={i} className="overflow-hidden border-none shadow-sm">
                <CardContent className="p-4 space-y-4">
                  <Skeleton className="h-6 w-3/4" />
                  <Skeleton className="h-4 w-1/2" />
                  <Skeleton className="h-2 w-full" />
                </CardContent>
              </Card>
            ))
          ) : orders.length > 0 ? (
            orders.map((order) => (
              <motion.div
                key={order.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
              >
                <Card className="overflow-hidden border-none shadow-sm bg-white">
                  <CardContent className="p-4 space-y-3">
                    <div className="flex items-center justify-between gap-4">
                      <div className="flex items-center gap-3 flex-1 min-w-0">
                        <div className="w-10 h-10 bg-gray-50 rounded-xl flex items-center justify-center shrink-0">
                          <CategoryIcon category={order.category} className="w-5 h-5" />
                        </div>
                        <div className="min-w-0 py-1">
                          <h3 className="font-bold text-sm line-clamp-2 leading-tight">{order.title}</h3>
                          <p className="text-[10px] text-gray-400 font-medium">{order.category || 'Other'}</p>
                        </div>
                      </div>
                      
                      <div className="flex items-center gap-2 shrink-0">
                        {getStatusBadge(order.status)}
                        
                        {confirmDeleteId === order.id ? (
                          <div className="flex items-center gap-1 bg-red-50 p-1 rounded-lg border border-red-100 animate-in fade-in">
                            <Button 
                              variant="ghost" 
                              size="sm" 
                              className="h-6 text-[9px] font-bold text-red-600 hover:bg-red-200/50 px-1.5"
                              onClick={() => handleDeleteOrder(order.id)}
                              disabled={deletingOrderId === order.id}
                            >
                              {deletingOrderId === order.id ? "..." : "Yes"}
                            </Button>
                            <Button 
                              variant="ghost" 
                              size="sm" 
                              className="h-6 text-[9px] font-bold text-gray-500 hover:bg-gray-100 px-1.5"
                              onClick={() => setConfirmDeleteId(null)}
                              disabled={deletingOrderId === order.id}
                            >
                              No
                            </Button>
                          </div>
                        ) : (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="w-8 h-8 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg shrink-0"
                            title="Delete from history"
                            onClick={() => setConfirmDeleteId(order.id)}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        )}
                      </div>
                    </div>
                    
                    <div className="grid grid-cols-3 gap-2 text-[10px]">
                      <div className="space-y-1">
                        <p className="text-gray-400 uppercase font-bold">Order ID</p>
                        <p className="font-mono font-bold text-gray-900 bg-gray-100/80 px-1.5 py-0.5 rounded border border-gray-150 inline-block">
                          {order.providerOrderId && order.providerOrderId !== 'PENDING' ? `#${order.providerOrderId}` : (order.provider_order_id && order.provider_order_id !== 'PENDING' ? `#${order.provider_order_id}` : (order.status?.toLowerCase() === 'failed' ? 'N/A' : 'Processing'))}
                        </p>
                      </div>
                      <div className="space-y-1 text-center">
                        <p className="text-gray-400 uppercase font-bold">Order Details</p>
                        <p className="font-medium">Qty: {order.quantity} | ₹{order.totalPrice || order.total_price}</p>
                      </div>
                      <div className="space-y-1 text-right">
                        <p className="text-gray-400 uppercase font-bold">Date & Time</p>
                        <p className="font-medium">{new Date(order.createdAt || order.created_at).toLocaleString()}</p>
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
                      <div className="p-2 bg-red-50 text-red-600 rounded-lg text-[10px] font-bold border border-red-100 flex flex-col gap-1 animate-in fade-in">
                        <div className="flex items-center gap-1.5">
                          <AlertCircle className="w-3 h-3" />
                          ORDER REJECTED
                        </div>
                        <p className="text-[9px] opacity-80 pl-4">{formatErrorMessage(order.error) || "Check target link or contact support."}</p>
                      </div>
                    )}

                    {order.status === 'pending' && !order.provider_order_id && (
                      <p className="text-[10px] text-orange-600 bg-orange-50 p-2 rounded-lg font-medium">
                        Order is pending. We are trying to connect to the provider. If it stays pending, please contact support.
                      </p>
                    )}
                  </CardContent>
                </Card>
              </motion.div>
            ))
          ) : (
            <div className="text-center py-20 bg-white rounded-3xl border-2 border-dashed border-gray-200">
              <History className="w-12 h-12 text-gray-300 mx-auto mb-4" />
              <h3 className="font-bold text-gray-900">No orders yet</h3>
              <p className="text-gray-500 text-sm max-w-xs mx-auto mt-2">
                Start growing your social media by placing your first order.
              </p>
              <Link to="/courses">
                <Button className="mt-6 rounded-full px-8">Browse Services</Button>
              </Link>
            </div>
          )}
        </div>
      ) : (
        /* DEPOSIT HISTORY TAB */
        <div className="space-y-4">
          {/* Summary Card */}
          <div className="bg-gradient-to-r from-emerald-500 to-teal-600 text-white rounded-2xl p-4 shadow-sm flex items-center justify-between">
            <div className="space-y-1">
              <p className="text-emerald-100 text-xs font-medium">Total Successfully Deposited</p>
              <h2 className="text-2xl font-black">₹{totalDepositedAmount.toFixed(2)}</h2>
              <p className="text-[11px] text-emerald-100">
                {successfulDeposits.length} Successful {successfulDeposits.length === 1 ? 'Deposit' : 'Deposits'}
              </p>
            </div>
            <Link to="/profile">
              <Button size="sm" className="bg-white text-emerald-800 hover:bg-emerald-50 rounded-xl font-bold text-xs shadow-sm">
                + Add More Funds
              </Button>
            </Link>
          </div>

          {depositsLoading ? (
            [1, 2, 3].map((i) => (
              <Card key={i} className="overflow-hidden border-none shadow-sm">
                <CardContent className="p-4 space-y-3">
                  <Skeleton className="h-6 w-1/3" />
                  <Skeleton className="h-4 w-1/2" />
                  <Skeleton className="h-2 w-full" />
                </CardContent>
              </Card>
            ))
          ) : deposits.length > 0 ? (
            deposits.map((dep, idx) => {
              const code = dep.utr || dep.orderRef || dep.order_ref || (dep.id?.startsWith('intent_') ? dep.id.replace('intent_', '') : '') || '';
              const isApproved = String(dep.status || '').toLowerCase() === 'approved' || String(dep.status || '').toLowerCase() === 'completed' || String(dep.status || '').toLowerCase() === 'success';

              return (
                <motion.div
                  key={dep.id || idx}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                >
                  <Card className="overflow-hidden border-none shadow-sm bg-white hover:shadow-md transition-shadow">
                    <CardContent className="p-4 space-y-3">
                      {/* Top Row: Amount & Status Badge */}
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className={cn(
                            "w-10 h-10 rounded-xl flex items-center justify-center shrink-0",
                            isApproved ? "bg-emerald-50 text-emerald-600" : "bg-amber-50 text-amber-600"
                          )}>
                            <ArrowDownLeft className="w-5 h-5 stroke-[2.5]" />
                          </div>
                          <div>
                            <div className="flex items-baseline gap-1">
                              <span className="text-xl font-black text-emerald-600">
                                + ₹{Number(dep.amount || 0).toFixed(2)}
                              </span>
                            </div>
                            <p className="text-[11px] font-semibold text-gray-500">
                              {dep.method || dep.gateway || "Instant UPI QR (Zero-UTR)"}
                            </p>
                          </div>
                        </div>

                        <div>
                          {getDepositStatusBadge(dep.status)}
                        </div>
                      </div>

                      {/* Details Grid */}
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 pt-2 border-t border-gray-100 text-[11px]">
                        {/* 12-Digit Code / UTR */}
                        <div className="col-span-2 sm:col-span-1 space-y-0.5">
                          <p className="text-[10px] uppercase font-bold text-gray-400">12-Digit Ref / UTR</p>
                          {code ? (
                            <button
                              onClick={() => handleCopyUtr(code)}
                              className="group flex items-center gap-1.5 font-mono font-bold text-gray-900 bg-gray-50 hover:bg-gray-100 px-2 py-1 rounded-lg border border-gray-200 transition-colors text-xs"
                              title="Click to copy code"
                            >
                              <span>{code}</span>
                              {copiedUtr === code ? (
                                <Check className="w-3 h-3 text-emerald-600 shrink-0" />
                              ) : (
                                <Copy className="w-3 h-3 text-gray-400 group-hover:text-gray-700 shrink-0" />
                              )}
                            </button>
                          ) : (
                            <span className="font-mono text-gray-400 text-xs">Direct Credit</span>
                          )}
                        </div>

                        {/* Date & Time */}
                        <div className="space-y-0.5">
                          <p className="text-[10px] uppercase font-bold text-gray-400">Date & Time</p>
                          <p className="font-medium text-gray-700">
                            {formatDepositDate(dep.createdAt || dep.timestamp || dep.completedAt)}
                          </p>
                        </div>

                        {/* Payment Method / Bank */}
                        <div className="space-y-0.5 text-right sm:text-left">
                          <p className="text-[10px] uppercase font-bold text-gray-400">Gateway</p>
                          <p className="font-medium text-gray-700 truncate">
                            {dep.gateway || dep.senderBank || "UPI Auto-Verify"}
                          </p>
                        </div>
                      </div>

                      {/* Note for Instant Zero-UTR Guarantee */}
                      <div className="bg-emerald-50/50 rounded-lg px-2.5 py-1.5 border border-emerald-150/60 flex items-center justify-between text-[10px] text-emerald-800">
                        <span className="font-medium flex items-center gap-1">
                          <CheckCircle className="w-3 h-3 text-emerald-600" />
                          Wallet Balance Credited
                        </span>
                        <span className="text-[9px] text-emerald-600 font-semibold font-mono">
                          ID: {dep.id?.slice(0, 16)}...
                        </span>
                      </div>
                    </CardContent>
                  </Card>
                </motion.div>
              );
            })
          ) : (
            <div className="text-center py-16 bg-white rounded-3xl border-2 border-dashed border-gray-200 p-6 space-y-4">
              <div className="w-14 h-14 bg-emerald-50 text-emerald-600 rounded-2xl flex items-center justify-center mx-auto">
                <Wallet className="w-7 h-7" />
              </div>
              <div>
                <h3 className="font-bold text-gray-900 text-base">No Deposits Found Yet</h3>
                <p className="text-gray-500 text-xs max-w-sm mx-auto mt-1 leading-relaxed">
                  Whenever you scan the QR code to add balance to your wallet, all successful deposits and 12-digit transaction codes will be safely recorded here.
                </p>
              </div>
              <Link to="/profile">
                <Button className="rounded-full px-6 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs">
                  Add Balance to Wallet Now
                </Button>
              </Link>
            </div>
          )}
        </div>
      )}
    </div>
  );
}


import { useEffect, useState, useRef } from "react";
import { motion } from "motion/react";
import { Play, CheckCircle, Clock, ChevronRight, History, ExternalLink, Youtube, RefreshCw, AlertCircle, Trash2 } from "lucide-react";
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

export default function Dashboard() {
  const { user, loading: authLoading } = useAuth();
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [checkingStatus, setCheckingStatus] = useState(false);
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
      // 1. Check Session Storage and Local Storage Cache
      const cacheKey = `orders_${user.uid}`;
      let cachedData = localStorage.getItem(cacheKey) || sessionStorage.getItem(cacheKey);
      let cacheTime = localStorage.getItem(`${cacheKey}_time`) || sessionStorage.getItem(`${cacheKey}_time`);
      const now = Date.now();

      let dbOrders: any[] = [];

      // A 7-day TTL cache guarantees zero Firebase reads across page loads/navigation
      const isExpired = cacheTime ? (now - parseInt(cacheTime) > 7 * 24 * 60 * 60 * 1000) : true;

      if (cachedData && !isExpired) {
        console.log("[DASHBOARD] ✅ Using persistent local cache for orders - 0 Firestore reads!");
        try {
          dbOrders = JSON.parse(cachedData);
        } catch (e) {
          cachedData = null;
        }
      }

      if (!cachedData || isExpired || dbOrders.length === 0) {
        try {
          console.log("[DASHBOARD] Local cache empty/expired. Reading orders from Firestore...");
          dbOrders = await dbClient.getUserOrders(user.uid, 50); // Fetch more for better history
          localStorage.setItem(cacheKey, JSON.stringify(dbOrders));
          localStorage.setItem(`${cacheKey}_time`, now.toString());
          sessionStorage.setItem(cacheKey, JSON.stringify(dbOrders));
          sessionStorage.setItem(`${cacheKey}_time`, now.toString());
        } catch (error) {
          console.error("Error fetching orders from DB:", error);
        }
      }

      // 2. Clear deprecated device-cached orders from device memory
      try {
        const localOrdersKey = `local_orders_${user.uid}`;
        localStorage.removeItem(localOrdersKey);
      } catch (e) {
        console.warn("[DASHBOARD] Failed to clear device-cached orders:", e);
      }

      // 3. Merge both collections and remove any duplicates by order ID
      const mergedMap = new Map();
      
      // Load DB orders first and ensure strict filtering by user's UID to prevent showing "fake" or other users' orders
      // Also exclude "failed" aborted orders that do not have a valid provider ID (e.g. they failed before transmission)
      dbOrders.forEach(order => {
        if (order && (order.userId === user.uid || order.user_id === user.uid)) {
          const pId = order.providerOrderId || order.provider_order_id;
          const isFailedAborted = order.status?.toLowerCase() === 'failed' && (!pId || pId === 'N/A');
          if (!isFailedAborted) {
            if (order.id || order.createdAt || order.created_at) {
              const key = order.id || order.createdAt || order.created_at;
              mergedMap.set(key, order);
            }
          }
        }
      });

      const mergedOrders = Array.from(mergedMap.values());

      // 4. Sort order history by creation date descending robustly using helper
      mergedOrders.sort((a, b) => {
        const timeA = getTimestampMs(a.createdAt || a.created_at);
        const timeB = getTimestampMs(b.createdAt || b.created_at);
        return timeB - timeA;
      });

      if (isMounted) {
        setOrders(mergedOrders.slice(0, 15)); // Show 15 instead of 10
        setLoading(false);
      }
    };
    
    fetchOrders();
    
    return () => { isMounted = false; };
  }, [user, renderLimit, refreshTrigger]);

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

      // Clear both localStorage and sessionStorage cache to force re-fetch of fresh data on manual refresh
      if (user) {
        localStorage.removeItem(`orders_${user.uid}`);
        localStorage.removeItem(`orders_${user.uid}_time`);
        sessionStorage.removeItem(`orders_${user.uid}`);
        sessionStorage.removeItem(`orders_${user.uid}_time`);
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
        // Highly optimal: Directly remove the deleted order from local cache to avoid reloading from DB
        const cacheKey = `orders_${user.uid}`;
        try {
          const cachedData = localStorage.getItem(cacheKey);
          if (cachedData) {
            const parsed = JSON.parse(cachedData);
            const filtered = parsed.filter((o: any) => o.id !== orderId);
            localStorage.setItem(cacheKey, JSON.stringify(filtered));
            sessionStorage.setItem(cacheKey, JSON.stringify(filtered));
          }
        } catch (e) {
          console.warn("Failed to update cache after deleting order:", e);
        }
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
        return <Badge className="bg-green-100 text-green-700 border-none">Completed</Badge>;
      case 'partial':
        return <Badge className="bg-yellow-100 text-yellow-700 border-none">Partial</Badge>;
      case 'canceled':
        return <Badge className="bg-red-100 text-red-700 border-none">Canceled</Badge>;
      case 'failed':
        return <Badge className="bg-red-600 text-white border-none">Failed</Badge>;
      case 'refunded':
        return <Badge className="bg-gray-100 text-gray-700 border-none">Refunded</Badge>;
      default:
        return <Badge className="bg-green-100 text-green-700 border-none">Completed</Badge>;
    }
  };

  return (
    <div className="w-full max-w-xl mx-auto space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">My Orders</h1>
        <div className="flex items-center gap-4">
          <Button 
            variant="ghost" 
            size="sm" 
            className="text-xs font-bold text-gray-500 hover:text-primary"
            onClick={() => checkOrdersStatus(true)}
            disabled={checkingStatus}
          >
            <RefreshCw className={cn("w-3 h-3 mr-2", checkingStatus && "animate-spin")} />
            {checkingStatus ? "Updating..." : "Refresh Status"}
          </Button>
          <div className="text-sm text-gray-500">
            Last {orders.length} Orders
          </div>
        </div>
      </div>

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
                    <a href={order.targetLink || order.target_link} target="_blank" rel="noreferrer" className="text-[10px] text-primary hover:underline break-all flex items-center gap-1">
                      <ExternalLink className="w-3 h-3" />
                      {order.targetLink || order.target_link}
                    </a>
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

        {/* Load more removed to save quota as per request */}
      </div>
    </div>
  );
}


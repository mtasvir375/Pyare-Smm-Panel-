import { useEffect, useState, useRef } from "react";
import { motion } from "motion/react";
import { CheckCircle, Clock, History, ExternalLink, RefreshCw, AlertCircle, Trash2 } from "lucide-react";
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
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [checkingStatus, setCheckingStatus] = useState(false);
  const statusIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const lastCheckedRef = useRef<number>(0);
  const [renderLimit] = useState(10);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [deletingOrderId, setDeletingOrderId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'orders' | 'payments'>('orders');
  const [userDeposits, setUserDeposits] = useState<any[]>([]);
  const [loadingDeposits, setLoadingDeposits] = useState(false);

  const fetchUserDeposits = async () => {
    if (!user) return;
    setLoadingDeposits(true);
    try {
      const allDeps = await dbClient.getDepositsAdmin(100);
      const uUid = user.uid;
      const uEmail = (user.email || "").trim().toLowerCase();
      const filtered = allDeps.filter((d: any) => {
        const dUid = d.userId || d.user_id;
        const dEmail = String(d.userEmail || d.user_email || "").trim().toLowerCase();
        return (dUid && dUid === uUid) || (uEmail && dEmail && dEmail === uEmail);
      });
      filtered.sort((a: any, b: any) => {
        const timeA = getTimestampMs(a.createdAt || a.created_at || a.verifiedAt);
        const timeB = getTimestampMs(b.createdAt || b.created_at || b.verifiedAt);
        return timeB - timeA;
      });
      setUserDeposits(filtered);
    } catch (e) {
      console.error("Error loading payment history:", e);
    } finally {
      setLoadingDeposits(false);
    }
  };

  useEffect(() => {
    if (viewMode === 'payments') {
      fetchUserDeposits();
    }
  }, [viewMode, user]);

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
        let cachedTime = Number(localStorage.getItem(`${uidKey}_time`) || sessionStorage.getItem(`${uidKey}_time`) || 0);
        if (!cachedData && emailKey) {
          cachedData = localStorage.getItem(emailKey) || sessionStorage.getItem(emailKey);
          cachedTime = Number(localStorage.getItem(`${emailKey}_time`) || sessionStorage.getItem(`${emailKey}_time`) || 0);
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

        // Strict Quota Guard: If orders are already loaded from cache or userProfile, SKIP network read completely!
        if (initialOrders.length > 0 && refreshTrigger === 0) {
          setLoading(false);
          return;
        }

        // 4. Only fetch from network if cache is missing or expired
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

  const renderContent = () => {
    if (viewMode === 'payments') {
      return (
        <div className="space-y-4">
          {loadingDeposits ? (
            [1, 2, 3].map((i) => (
              <Card key={i} className="overflow-hidden border-none shadow-sm">
                <CardContent className="p-4 space-y-4">
                  <Skeleton className="h-6 w-3/4" />
                  <Skeleton className="h-4 w-1/2" />
                </CardContent>
              </Card>
            ))
          ) : userDeposits.length > 0 ? (
            userDeposits.map((deposit) => {
              const amount = deposit.amount || 0;
              const status = (deposit.status || 'pending').toLowerCase();
              const utr = deposit.utr || deposit.orderRef || deposit.id || 'N/A';
              const dateStr = deposit.createdAt || deposit.verifiedAt || deposit.created_at || new Date().toISOString();
              
              return (
                <motion.div
                  key={deposit.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                >
                  <Card className="overflow-hidden border-none shadow-sm bg-white">
                    <CardContent className="p-4 space-y-3">
                      <div className="flex items-center justify-between gap-4">
                        <div className="flex items-center gap-3 flex-1 min-w-0">
                          <div className="w-10 h-10 bg-emerald-50 text-emerald-600 rounded-xl flex items-center justify-center shrink-0 font-bold text-lg">
                            ₹
                          </div>
                          <div className="min-w-0 py-0.5">
                            <h3 className="font-bold text-sm text-gray-900">Wallet Deposit: ₹{amount}</h3>
                            <p className="text-[11px] text-gray-500 font-mono mt-0.5">
                              UTR / ID: <span className="font-bold text-gray-800">{utr}</span>
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          {status === 'approved' || status === 'completed' ? (
                            <Badge className="bg-emerald-100 text-emerald-700 border-none font-bold text-[10px]">Success</Badge>
                          ) : status === 'cancelled' || status === 'rejected' ? (
                            <Badge className="bg-rose-100 text-rose-700 border-none font-bold text-[10px]">Cancelled</Badge>
                          ) : (
                            <Badge className="bg-amber-100 text-amber-700 border-none font-bold text-[10px]">Pending</Badge>
                          )}
                        </div>
                      </div>

                      <div className="pt-2 border-t border-gray-100 flex items-center justify-between text-[11px] text-gray-400">
                        <span>Date: {new Date(dateStr).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</span>
                        <span className="capitalize font-medium text-gray-600">{deposit.provider || deposit.gateway || deposit.paymentMethod || 'UPI / Manual'}</span>
                      </div>
                    </CardContent>
                  </Card>
                </motion.div>
              );
            })
          ) : (
            <Card className="border-none shadow-sm bg-white p-8 text-center space-y-3">
              <div className="w-12 h-12 bg-emerald-50 text-emerald-600 rounded-full flex items-center justify-center mx-auto">
                <History className="w-6 h-6" />
              </div>
              <h3 className="font-bold text-gray-900 text-base">No Payment History Yet</h3>
              <p className="text-xs text-gray-500 max-w-sm mx-auto">
                When you add funds to your wallet via UPI, QR code, or gateway, your permanent payment history will appear here with 12-digit UTR IDs.
              </p>
            </Card>
          )}
        </div>
      );
    }

    if (loading) {
      return (
        <div className="space-y-4">
          {[1, 2, 3, 4, 5].map((i) => (
            <Card key={i} className="overflow-hidden border-none shadow-sm">
              <CardContent className="p-4 space-y-4">
                <Skeleton className="h-6 w-3/4" />
                <Skeleton className="h-4 w-1/2" />
                <Skeleton className="h-2 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      );
    }

    if (orders.length === 0) {
      return (
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
      );
    }

    return (
      <div className="space-y-4">
        {orders.map((order) => (
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
        ))}
      </div>
    );
  };

  return (
    <div className="w-full max-w-xl mx-auto space-y-6">
      {/* Header with Title and Refresh Button */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            {viewMode === 'orders' ? 'My Service Orders' : 'Payment History'}
          </h1>
          <p className="text-xs text-gray-500 mt-0.5">
            {viewMode === 'orders' ? `Showing latest ${orders.length} service orders` : `Permanent records of your wallet deposits & payments`}
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <div className="bg-gray-100 p-1 rounded-xl flex items-center gap-1">
            <button
              onClick={() => setViewMode('orders')}
              className={cn("px-3 py-1.5 rounded-lg text-xs font-bold transition-all", viewMode === 'orders' ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-900")}
            >
              Orders
            </button>
            <button
              onClick={() => setViewMode('payments')}
              className={cn("px-3 py-1.5 rounded-lg text-xs font-bold transition-all", viewMode === 'payments' ? "bg-white text-emerald-700 shadow-sm" : "text-gray-500 hover:text-gray-900")}
            >
              View Payment History
            </button>
          </div>

          <Button 
            variant="ghost" 
            size="sm" 
            className="text-xs font-bold text-gray-500 hover:text-primary rounded-xl"
            onClick={() => {
              if (viewMode === 'orders') checkOrdersStatus(true);
              else fetchUserDeposits();
            }}
            disabled={checkingStatus || loadingDeposits}
          >
            <RefreshCw className={cn("w-3 h-3 mr-1.5", (checkingStatus || loadingDeposits) && "animate-spin")} />
            {checkingStatus || loadingDeposits ? "Refreshing..." : "Refresh"}
          </Button>
        </div>
      </div>

      {/* MAIN CONTENT AREA */}
      <div className="space-y-4">
        {renderContent()}
      </div>
    </div>
  );
}


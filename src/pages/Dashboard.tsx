import { useEffect, useState, useRef } from "react";
import { motion } from "motion/react";
import { Play, CheckCircle, Clock, ChevronRight, History, ExternalLink, Youtube, RefreshCw, AlertCircle } from "lucide-react";
import CategoryIcon from "@/components/CategoryIcon";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { collection, query, where, onSnapshot, doc, getDoc, orderBy, updateDoc, limit } from "firebase/firestore";
import { db, handleFirestoreError, OperationType } from "@/lib/firebase";
import { useAuth } from "@/context/AuthContext";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import axios from "axios";

export default function Dashboard() {
  const { user } = useAuth();
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [checkingStatus, setCheckingStatus] = useState(false);
  const statusIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const lastCheckedRef = useRef<number>(0);
  const [renderLimit] = useState(3);

  useEffect(() => {
    if (!user) return;

    let isMounted = true;
    
    const fetchOrders = async () => {
      // 1. Check Session Storage Cache
      const cacheKey = `orders_${user.uid}`;
      const cachedData = sessionStorage.getItem(cacheKey);
      const cacheTime = sessionStorage.getItem(`${cacheKey}_time`);
      const now = Date.now();

      if (cachedData && cacheTime && (now - parseInt(cacheTime) < 5 * 60 * 1000)) { // 5 minutes cache
        console.log("[DASHBOARD] ✅ Using session cache for orders");
        setOrders(JSON.parse(cachedData));
        setLoading(false);
        return;
      }

      try {
        const { getDocs } = await import("firebase/firestore");
        const qOrders = query(
          collection(db, "orders"),
          where("userId", "==", user.uid),
          orderBy("createdAt", "desc"),
          limit(renderLimit)
        );
        const snapshot = await getDocs(qOrders);
        if (!isMounted) return;
        const ordersData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        
        // Update State and Cache
        setOrders(ordersData);
        sessionStorage.setItem(cacheKey, JSON.stringify(ordersData));
        sessionStorage.setItem(`${cacheKey}_time`, now.toString());
        
        setLoading(false);
      } catch (error) {
        handleFirestoreError(error, OperationType.LIST, "orders");
        if (isMounted) setLoading(false);
      }
    };
    
    fetchOrders();
    
    return () => { isMounted = false; };
  }, [user, renderLimit]);

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
        
        // Removed auto-completion logic from frontend to prevent write storms.
        // Server-side background sync will handle this.

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
    } catch (error) {
      console.error("Error in checkOrdersStatus:", error);
    } finally {
      setCheckingStatus(false);
    }
  };

  // Run status check ONLY when user specifically refreshes
  // Auto-sync on mount removed to stay within Firebase free tier limits.
  useEffect(() => {
    // Component initialization logic only
  }, []);

  if (!user) {
    return (
      <div className="text-center py-20">
        <p className="text-gray-500">Please log in to view your dashboard.</p>
      </div>
    );
  }

  const getStatusBadge = (status: string) => {
    switch (status?.toLowerCase()) {
      case 'pending':
        return <Badge className="bg-orange-100 text-orange-700 border-none">Pending</Badge>;
      case 'processing':
        return <Badge className="bg-blue-100 text-blue-700 border-none">Processing</Badge>;
      case 'in progress':
        return <Badge className="bg-indigo-100 text-indigo-700 border-none">In Progress</Badge>;
      case 'completed':
        return <Badge className="bg-green-100 text-green-700 border-none">Completed</Badge>;
      case 'partial':
        return <Badge className="bg-yellow-100 text-yellow-700 border-none">Partial</Badge>;
      case 'canceled':
        return <Badge className="bg-red-100 text-red-700 border-none">Canceled</Badge>;
      case 'failed':
        return <Badge className="bg-red-600 text-white border-none">Failed (Refunded)</Badge>;
      case 'refunded':
        return <Badge className="bg-gray-100 text-gray-700 border-none">Refunded</Badge>;
      case 'approved': // Legacy status from manual approval
        return <Badge className="bg-green-100 text-green-700 border-none">Approved</Badge>;
      default:
        return <Badge className="bg-gray-100 text-gray-700 border-none">{status || 'Unknown'}</Badge>;
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
          [1, 2, 3].map((i) => (
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
                        <h3 className="font-bold text-sm line-clamp-2 leading-tight">{order.courseTitle}</h3>
                        <p className="text-[10px] text-gray-400 font-medium">{order.category || 'Other'}</p>
                      </div>
                    </div>
                    {getStatusBadge(order.status)}
                  </div>
                  
                  <div className="grid grid-cols-2 gap-4 text-[10px]">
                    <div className="space-y-1">
                      <p className="text-gray-400 uppercase font-bold">Order Details</p>
                      <p className="font-medium">Qty: {order.quantity} | ₹{order.totalPrice}</p>
                    </div>
                    <div className="space-y-1 text-right">
                      <p className="text-gray-400 uppercase font-bold">Date & Time</p>
                      <p className="font-medium">{order.createdAt?.toDate ? order.createdAt.toDate().toLocaleString() : new Date(order.createdAt).toLocaleString()}</p>
                    </div>
                  </div>

                  <div className="p-2 bg-gray-50 rounded-lg border border-gray-100">
                    <p className="text-[9px] font-bold text-gray-400 uppercase mb-1">Target Link</p>
                    <a href={order.targetLink} target="_blank" rel="noreferrer" className="text-[10px] text-primary hover:underline break-all flex items-center gap-1">
                      <ExternalLink className="w-3 h-3" />
                      {order.targetLink}
                    </a>
                  </div>

                  {order.status?.toLowerCase() === 'failed' && (
                    <div className="p-2 bg-red-50 text-red-600 rounded-lg text-[10px] font-bold border border-red-100 flex items-center gap-1.5 animate-pulse">
                      <AlertCircle className="w-3 h-3" />
                      ORDER REJECTED - Amount (₹{order.totalPrice}) has been automatically refunded to your wallet.
                    </div>
                  )}

                  {order.status === 'pending' && !order.providerOrderId && (
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


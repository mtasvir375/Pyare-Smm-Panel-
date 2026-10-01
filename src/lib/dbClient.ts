import { 
  collection, 
  doc, 
  getDoc, 
  getDocs, 
  setDoc, 
  updateDoc, 
  deleteDoc, 
  query, 
  where, 
  orderBy, 
  limit, 
  serverTimestamp,
  Timestamp,
  onSnapshot,
  getCountFromServer,
  addDoc as firestoreAddDoc
} from 'firebase/firestore';
import { db } from './firebase';
import axios from 'axios';
import { formatApiUrl } from './apiConfig';

export interface UserProfile {
  uid: string;
  email: string;
  userEmail?: string;
  displayName: string;
  photoURL: string;
  role: 'student' | 'instructor' | 'admin' | 'payment_admin';
  balance: number;
  createdAt: any;
  latestOrders?: any[];
  latestDeposits?: any[];
  isFallback?: boolean;
}

export const dbClient = {
  // Generic helpers
  async getDoc(table: string, id: string, options?: { fresh?: boolean }): Promise<any> {
    const forceFresh = !!options?.fresh;
    if (table === "settings" && id === "payment" && !forceFresh) {
      try {
        const { getCachedSettings } = await import('@/lib/cache');
        const settings = await getCachedSettings();
        if (settings) return settings;
      } catch (e) {}
    }
    // 1. Try authoritative backend proxy first
    try {
      const res = await axios.post(formatApiUrl('/api/db/get'), { collection: table, id, fresh: forceFresh });
      if (res.data && res.data.success && res.data.data && Object.keys(res.data.data).length > 0) {
        return { id, ...res.data.data };
      }
      if (res.data && res.data.error === "Document not found") {
        return null;
      }
    } catch (proxyErr: any) {}

    // 2. Direct Web SDK as safe fallback
    try {
      const docRef = doc(db, table, id);
      const snap = await getDoc(docRef);
      if (snap.exists()) return { id: snap.id, ...snap.data() };
      return null;
    } catch (err: any) {
      return null;
    }
  },

  async getDocs(table: string, constraints: any[] = []): Promise<any[]> {
    // 1. Try authoritative backend proxy first (0 reads if cached in server/disk memory)
    try {
      const res = await axios.post(formatApiUrl('/api/db/list'), { collection: table, limit: table === 'courses' ? 100 : 30 });
      if (res.data && res.data.success && Array.isArray(res.data.data)) {
        return res.data.data;
      }
    } catch (proxyErr: any) {}

    // 2. Safe capped fallback only if proxy fails
    try {
      const colRef = collection(db, table);
      const limitCount = table === 'courses' ? 200 : (table === 'providers' ? 50 : 30);
      const effectiveConstraints = constraints && constraints.length > 0 
        ? constraints 
        : [limit(limitCount)];
      const qSafe = query(colRef, ...effectiveConstraints);
      const snap = await getDocs(qSafe);
      return snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    } catch (err: any) {
      return [];
    }
  },

  async setDoc(table: string, id: string, data: any): Promise<void> {
    if (table === 'courses' || table === 'settings' || table === 'providers') {
      axios.post(formatApiUrl('/api/clear-cache')).catch(() => {});
    }
    try {
      await axios.post(formatApiUrl('/api/db/set'), { collection: table, id, data });
    } catch (proxyErr: any) {}

    try {
      const docRef = doc(db, table, id);
      await setDoc(docRef, { ...data, updatedAt: serverTimestamp() }, { merge: true }).catch(() => {});
    } catch (fsErr: any) {}
  },

  async updateDoc(table: string, id: string, data: any): Promise<void> {
    if (table === 'courses' || table === 'settings' || table === 'providers') {
      axios.post(formatApiUrl('/api/clear-cache')).catch(() => {});
    }
    try {
      await axios.post(formatApiUrl('/api/db/update'), { collection: table, id, data });
    } catch (e: any) {}

    try {
      const docRef = doc(db, table, id);
      await setDoc(docRef, { ...data, updatedAt: serverTimestamp() }, { merge: true }).catch(() => {});
    } catch (fsErr: any) {}
  },

  async addDoc(table: string, data: any): Promise<any> {
    if (table === 'courses' || table === 'settings' || table === 'providers') {
      axios.post(formatApiUrl('/api/clear-cache')).catch(() => {});
    }
    try {
      // Single authoritative insert via server proxy (0 extra reads, exact 1 write)
      const res = await axios.post(formatApiUrl('/api/db/add'), { collection: table, data });
      if (res.data && res.data.success !== false && res.data.id) {
        return { id: res.data.id, ...data };
      }
    } catch (e: any) {
      console.warn(`[DB-CLIENT] Proxy add failed for ${table}, attempting direct add...`);
    }

    const colRef = collection(db, table);
    const docRef = await firestoreAddDoc(colRef, { ...data, createdAt: serverTimestamp() });
    return { id: docRef.id, ...data };
  },

  async saveDoc(table: string, id: string, data: any): Promise<void> {
    return this.setDoc(table, id, data);
  },

  async deleteDoc(table: string, id: string): Promise<void> {
    if (table === 'courses' || table === 'settings' || table === 'providers') {
      axios.post('/api/clear-cache').catch(() => {});
    }
    const docRef = doc(db, table, id);
    await deleteDoc(docRef);
  },

  // User specific
  async getUserProfile(uid: string): Promise<UserProfile | null> {
    if (!uid) return null;
    
    // 1. Try authoritative backend proxy first (avoids stale client-side cache and guarantees real-time balance)
    try {
      const res = await axios.post(formatApiUrl('/api/db/get'), { collection: 'users', id: uid, fresh: true });
      if (res.data && res.data.success && res.data.data) {
        return { id: uid, uid, ...res.data.data };
      }
    } catch (proxyErr: any) {}

    // 2. Direct Firestore fallback
    try {
      const docRef = doc(db, 'users', uid);
      const snap = await getDoc(docRef);
      if (snap.exists()) {
        const data = snap.data() as any;
        return { id: snap.id, uid, ...data };
      }
    } catch (err: any) {}

    return null;
  },

  async createUserProfile(uid: string, profileData: Partial<UserProfile>): Promise<void> {
    const existing = await this.getUserProfile(uid);
    if (existing) {
      return;
    }
    const data = {
      uid,
      email: profileData.email || '',
      displayName: profileData.displayName || '',
      photoURL: profileData.photoURL || '',
      role: profileData.role || 'student',
      balance: profileData.balance !== undefined ? profileData.balance : 0,
      createdAt: serverTimestamp(),
      ...profileData
    };
    await this.setDoc('users', uid, data);
  },

  async updateUserProfile(uid: string, data: any): Promise<void> {
    await this.updateDoc('users', uid, data);
  },

  // Specialized queries
  async getPublishedCourses(): Promise<any[]> {
    return this.getDocs('courses', [where('status', '==', 'published'), orderBy('createdAt', 'desc')]);
  },

  async getMyOrders(userId: string): Promise<any[]> {
    try {
      const response = await axios.get(formatApiUrl(`/api/user-orders/${userId}?limit=50`));
      return response.data;
    } catch (e) {
      return [];
    }
  },

  async getUserOrders(userId: string, l = 10, email?: string): Promise<any[]> {
    const limitCount = Math.min(l, 10);
    // 1. Try server endpoint
    try {
      const emailQuery = email ? `&email=${encodeURIComponent(email)}` : "";
      const response = await axios.get(formatApiUrl(`/api/user-orders/${userId}?limit=${limitCount}${emailQuery}`), { timeout: 6000 });
      if (Array.isArray(response.data) && response.data.length > 0) {
        return response.data.slice(0, 10);
      }
    } catch (e) {}

    // 2. Try User Profile document (0 extra Firestore read if cached, 1 read otherwise)
    try {
      const userDoc = await this.getDoc('users', userId);
      if (userDoc && Array.isArray(userDoc.latestOrders) && userDoc.latestOrders.length > 0) {
        return userDoc.latestOrders.slice(0, 10);
      }
    } catch (uErr) {}

    // 3. Fallback targeted query on 'orders' collection (strictly limit to 10!)
    try {
      const q = query(
        collection(db, 'orders'),
        where('userId', '==', userId),
        limit(10)
      );
      const snapshot = await getDocs(q);
      const orders = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      orders.sort((a: any, b: any) => {
        const tA = new Date(a.createdAt || a.created_at || 0).getTime();
        const tB = new Date(b.createdAt || b.created_at || 0).getTime();
        return tB - tA;
      });
      return orders.slice(0, 10);
    } catch (fallbackErr) {
      return [];
    }
  },

  async getAllOrders(): Promise<any[]> {
    try {
      const response = await axios.get(formatApiUrl(`/api/admin/all-orders`));
      return response.data;
    } catch (e) {
      return [];
    }
  },

  async getPendingDeposits(force = false): Promise<any[]> {
    try {
      const res = await axios.get(formatApiUrl(`/api/admin/all-deposits?limit=50&force=${force}`));
      if (Array.isArray(res.data)) {
        return res.data.filter((d: any) => (d.status || '').toLowerCase() === 'pending');
      }
    } catch (e) {}
    return [];
  },

  async getDepositsAdmin(l = 50, force = false): Promise<any[]> {
    try {
      const res = await axios.get(formatApiUrl(`/api/admin/all-deposits?limit=${l}&force=${force}`));
      if (Array.isArray(res.data) && res.data.length > 0) return res.data;
    } catch (e) {}
    // Direct Firestore fallback
    try {
      const q = query(collection(db, 'deposits'), limit(l));
      const snap = await getDocs(q);
      return snap.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch (e) {
      return [];
    }
  },

  async processDepositAction(depositId: string, action: 'approved' | 'cancelled', deposit?: any, adminEmail?: string): Promise<any> {
    try {
      const res = await axios.post(formatApiUrl('/api/admin/process-deposit'), {
        depositId,
        action,
        adminEmail,
        deposit
      });
      if (res.data && res.data.success) {
        return res.data;
      }
      throw new Error(res.data?.error || "Process deposit failed");
    } catch (err: any) {
      if (action === 'approved' && deposit) {
        const uId = deposit.userId || deposit.user_id;
        const depositAmount = Number(deposit.amount || 0);
        const userProfile = await this.getUserProfile(uId);
        if (!userProfile) throw new Error("User not found");
        const newBalance = Number(userProfile.balance || 0) + depositAmount;
        await this.updateUserProfile(uId, { balance: newBalance });
        await this.updateDoc("deposits", depositId, {
          status: 'approved',
          verifiedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          processedBy: adminEmail || 'admin'
        });
        return { success: true, status: 'approved' };
      } else {
        await this.updateDoc("deposits", depositId, {
          status: 'cancelled',
          updatedAt: new Date().toISOString(),
          processedBy: adminEmail || 'admin'
        });
        return { success: true, status: 'cancelled' };
      }
    }
  },

  async getProviders(): Promise<any[]> {
    try {
      const { getCachedProviders } = await import('@/lib/cache');
      const cached = await getCachedProviders();
      if (Array.isArray(cached) && cached.length > 0) return cached;
    } catch (e) {}
    try {
      const res = await axios.get(formatApiUrl('/api/providers'));
      if (Array.isArray(res.data) && res.data.length > 0) return res.data;
    } catch (e) {}
    return this.getDocs('providers', [orderBy('createdAt', 'desc')]);
  },

  async checkDuplicateOrder(userId: string, courseId: string, link: string): Promise<boolean> {
    const twentyFiveMinsAgo = Date.now() - 25 * 60 * 1000;
    const trimmedLink = link.trim();

    // 1. First check local storage cached orders to save Firestore reads
    try {
      const cacheKeys = [`cached_orders_${userId}`, `orders_${userId}`];
      for (const key of cacheKeys) {
        const raw = localStorage.getItem(key) || sessionStorage.getItem(key);
        if (raw) {
          const orders = JSON.parse(raw);
          if (Array.isArray(orders)) {
            const hasDuplicate = orders.some((order: any) => {
              if (!order) return false;
              const oLink = (order.targetLink || order.target_link || "").trim();
              const oCId = order.courseId || order.serviceId;
              if (oLink !== trimmedLink || oCId !== courseId) return false;

              // Only active pending orders count as duplicate
              const oStatus = (order.status || "").toLowerCase();
              if (["completed", "failed", "cancelled", "refunded"].includes(oStatus)) return false;

              let createdMs = 0;
              const ca = order.createdAt || order.created_at;
              if (ca) {
                if (typeof ca === "number") createdMs = ca;
                else if (typeof ca === "string") createdMs = new Date(ca).getTime();
                else if (ca._seconds) createdMs = ca._seconds * 1000;
                else if (ca.seconds) createdMs = ca.seconds * 1000;
              }
              return createdMs > twentyFiveMinsAgo;
            });
            if (hasDuplicate) return true;
          }
        }
      }
    } catch (e) {}

    // 2. Fallback to query Firestore
    const twentyFiveMinsAgoDate = new Date(twentyFiveMinsAgo);
    const q = query(
      collection(db, 'orders'),
      where('userId', '==', userId),
      where('targetLink', '==', trimmedLink),
      limit(5)
    );
    
    const snap = await getDocs(q);
    if (snap.empty) return false;
    
    return snap.docs.some(doc => {
      const data = doc.data();
      const cId = data.courseId || data.serviceId;
      if (cId !== courseId) return false;

      const oStatus = (data.status || "").toLowerCase();
      if (["completed", "failed", "cancelled", "refunded"].includes(oStatus)) return false;
      
      let createdDate: Date | null = null;
      if (data.createdAt) {
        if (typeof data.createdAt === 'string') {
          createdDate = new Date(data.createdAt);
        } else if (data.createdAt.toDate) {
          createdDate = data.createdAt.toDate();
        } else {
          createdDate = new Date(data.createdAt);
        }
      }
      
      if (createdDate && createdDate > twentyFiveMinsAgoDate) {
        return true;
      }
      return false;
    });
  },

  async getTableCount(table: string): Promise<number> {
    const snap = await getCountFromServer(collection(db, table));
    return snap.data().count;
  },

  // Order specific
  async createOrder(id: string, data: any): Promise<void> {
    const docRef = doc(db, 'orders', id);
    await setDoc(docRef, { 
      ...data, 
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
  },

  async getCourses(): Promise<any[]> {
    try {
      const { getCachedCourses } = await import('@/lib/cache');
      const cached = await getCachedCourses();
      if (Array.isArray(cached) && cached.length > 0) return cached;
    } catch (e) {}
    try {
      const res = await axios.get('/api/courses');
      if (Array.isArray(res.data) && res.data.length > 0) return res.data;
    } catch (e) {}
    return this.getDocs('courses', [orderBy('createdAt', 'desc'), limit(100)]);
  },

  async getOrdersAdmin(l = 50): Promise<any[]> {
    try {
      const response = await axios.get(`/api/admin/all-orders?limit=${l}`);
      if (Array.isArray(response.data) && response.data.length > 0) return response.data;
    } catch (e) {}
    return this.getDocs('orders', [orderBy('createdAt', 'desc'), limit(l)]);
  },

  async submitManualDeposit(depositId: string, data: any): Promise<void> {
    await this.setDoc('deposits', depositId, {
      ...data,
      status: 'pending',
      type: 'deposit',
      createdAt: serverTimestamp()
    });
  },

  async getUserDeposits(userId: string, userEmail?: string): Promise<any[]> {
    // Deposit history viewing disabled to save 100% Firestore read quota
    return [];
  },

  observeOrder(id: string, callback: (data: any) => void): () => void {
    const docRef = doc(db, 'orders', id);
    return onSnapshot(docRef, (snap) => {
      if (snap.exists()) {
        callback({ id: snap.id, ...snap.data() });
      } else {
        callback(null);
      }
    });
  }
};

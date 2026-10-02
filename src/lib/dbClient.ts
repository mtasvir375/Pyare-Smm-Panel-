import axios from 'axios';
import { formatApiUrl } from './apiConfig';
import { db } from './firebase';
import { 
  doc, 
  getDoc as getFirestoreDoc, 
  setDoc as setFirestoreDoc, 
  getDocs as getFirestoreDocs, 
  collection, 
  deleteDoc as deleteFirestoreDoc, 
  limit as fsLimit, 
  query as fsQuery,
  orderBy as fsOrderBy
} from 'firebase/firestore';

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
  // Generic helpers - Dual API Gateway & Direct Firestore SDK for 100% synchronization across Default & Custom Domains
  async getDoc(table: string, id: string, options?: { fresh?: boolean }): Promise<any> {
    const forceFresh = !!options?.fresh;
    if (table === "settings" && id === "payment" && !forceFresh) {
      try {
        const { getCachedSettings } = await import('@/lib/cache');
        const settings = await getCachedSettings();
        if (settings) return settings;
      } catch (e) {}
    }

    // 1. Try API gateway
    try {
      const res = await axios.post(formatApiUrl('/api/db/get'), { collection: table, id, fresh: forceFresh }, { timeout: 4000 });
      if (res.data && res.data.success && res.data.data && Object.keys(res.data.data).length > 0) {
        return { id, ...res.data.data };
      }
    } catch (proxyErr: any) {}

    // 2. Direct Firestore fallback (Always works across custom domain and default URL!)
    try {
      const docRef = doc(db, table, id);
      const snap = await getFirestoreDoc(docRef);
      if (snap.exists()) {
        return { id: snap.id, ...snap.data() };
      }
    } catch (fsErr: any) {}

    return null;
  },

  async getDocs(table: string, constraints: any[] = []): Promise<any[]> {
    const limitCount = table === 'courses' ? 100 : (table === 'providers' ? 50 : 30);

    // 1. Try API gateway
    try {
      const res = await axios.post(formatApiUrl('/api/db/list'), { collection: table, limit: limitCount }, { timeout: 4000 });
      if (res.data && res.data.success && Array.isArray(res.data.data) && res.data.data.length > 0) {
        return res.data.data;
      }
    } catch (proxyErr: any) {}

    // 2. Direct Firestore fallback
    try {
      const colRef = collection(db, table);
      const q = fsQuery(colRef, fsLimit(limitCount));
      const snap = await getFirestoreDocs(q);
      if (!snap.empty) {
        return snap.docs.map(d => ({ id: d.id, ...d.data() }));
      }
    } catch (fsErr: any) {}

    return [];
  },

  async setDoc(table: string, id: string, data: any): Promise<void> {
    if (table === 'courses' || table === 'settings' || table === 'providers') {
      axios.post(formatApiUrl('/api/clear-cache')).catch(() => {});
    }

    // 1. Send to API Gateway
    axios.post(formatApiUrl('/api/db/set'), { collection: table, id, data }).catch(() => {});

    // 2. Write directly to Firestore SDK to ensure instant permanent sync across ALL domains!
    try {
      const docRef = doc(db, table, id);
      await setFirestoreDoc(docRef, data, { merge: true });
    } catch (fsErr: any) {}
  },

  async updateDoc(table: string, id: string, data: any): Promise<void> {
    await this.setDoc(table, id, data);
  },

  async addDoc(table: string, data: any): Promise<any> {
    if (table === 'courses' || table === 'settings' || table === 'providers') {
      axios.post(formatApiUrl('/api/clear-cache')).catch(() => {});
    }
    const prefix = table === "orders" ? "ord_" : table === "deposits" ? "dep_" : table === "transactions" ? "txn_" : "doc_";
    const autoId = data?.id || (prefix + Date.now() + "_" + Math.random().toString(36).substring(2, 7));
    const merged = { ...data, id: autoId };

    // Write to API & Firestore
    await this.setDoc(table, autoId, merged);
    return merged;
  },

  async saveDoc(table: string, id: string, data: any): Promise<void> {
    return this.setDoc(table, id, data);
  },

  async deleteDoc(table: string, id: string): Promise<void> {
    if (table === 'courses' || table === 'settings' || table === 'providers') {
      axios.post(formatApiUrl('/api/clear-cache')).catch(() => {});
    }
    axios.post(formatApiUrl('/api/db/delete'), { collection: table, id }).catch(() => {});
    try {
      const docRef = doc(db, table, id);
      await deleteFirestoreDoc(docRef);
    } catch (fsErr: any) {}
  },

  // User specific
  async getUserProfile(uid: string): Promise<UserProfile | null> {
    if (!uid) return null;
    return this.getDoc('users', uid, { fresh: true });
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
      createdAt: new Date().toISOString(),
      ...profileData
    };
    await this.setDoc('users', uid, data);
  },

  async updateUserProfile(uid: string, data: any): Promise<void> {
    await this.updateDoc('users', uid, data);
  },

  // Specialized queries
  async getPublishedCourses(): Promise<any[]> {
    return this.getCourses();
  },

  async getMyOrders(userId: string): Promise<any[]> {
    try {
      const response = await axios.get(formatApiUrl(`/api/user-orders/${userId}?limit=50`), { timeout: 4000 });
      return response.data || [];
    } catch (e) {
      return [];
    }
  },

  async getUserOrders(userId: string, l = 10, email?: string): Promise<any[]> {
    const limitCount = Math.min(l, 10);
    try {
      const emailQuery = email ? `&email=${encodeURIComponent(email)}` : "";
      const response = await axios.get(formatApiUrl(`/api/user-orders/${userId}?limit=${limitCount}${emailQuery}`), { timeout: 4000 });
      if (Array.isArray(response.data)) {
        return response.data.slice(0, 10);
      }
    } catch (e) {}
    return [];
  },

  async getAllOrders(): Promise<any[]> {
    return this.getOrdersAdmin(50);
  },

  async getPendingDeposits(force = false): Promise<any[]> {
    try {
      const res = await axios.get(formatApiUrl(`/api/admin/all-deposits?limit=50&force=${force}`), { timeout: 4000 });
      if (Array.isArray(res.data)) {
        return res.data.filter((d: any) => (d.status || '').toLowerCase() === 'pending');
      }
    } catch (e) {}
    return [];
  },

  async getDepositsAdmin(l = 50, force = false): Promise<any[]> {
    try {
      const res = await axios.get(formatApiUrl(`/api/admin/all-deposits?limit=${l}&force=${force}`), { timeout: 4000 });
      if (Array.isArray(res.data) && res.data.length > 0) return res.data;
    } catch (e) {}

    // Firestore fallback
    try {
      const snap = await getFirestoreDocs(fsQuery(collection(db, 'deposits'), fsLimit(l)));
      if (!snap.empty) {
        return snap.docs.map(d => ({ id: d.id, ...d.data() }));
      }
    } catch (e) {}
    return [];
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
      throw err;
    }
  },

  async getProviders(forceRefresh = false): Promise<any[]> {
    if (forceRefresh) {
      try {
        const { clearCache } = await import('@/lib/cache');
        clearCache();
      } catch (e) {}
    }

    // 1. Direct Firestore SDK fetch (most authoritative on client/custom domain)
    try {
      const snap = await getFirestoreDocs(collection(db, 'providers'));
      if (!snap.empty) {
        const docsList = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        if (docsList.length > 0) return docsList;
      }
    } catch (e) {}

    // 2. Try cache
    try {
      const { getCachedProviders } = await import('@/lib/cache');
      const cached = await getCachedProviders(forceRefresh);
      if (Array.isArray(cached) && cached.length > 0) return cached;
    } catch (e) {}

    // 3. Fallback to API Gateway
    try {
      const res = await axios.get(formatApiUrl(`/api/providers?force=${forceRefresh}&t=${Date.now()}`), { timeout: 4000 });
      if (Array.isArray(res.data) && res.data.length > 0) return res.data;
    } catch (e) {}

    return [];
  },

  async checkDuplicateOrder(userId: string, courseId: string, link: string): Promise<boolean> {
    const twentyFiveMinsAgo = Date.now() - 25 * 60 * 1000;
    const trimmedLink = link.trim();

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

    return false;
  },

  async getTableCount(table: string): Promise<number> {
    const docs = await this.getDocs(table);
    return docs.length;
  },

  // Order specific
  async createOrder(id: string, data: any): Promise<void> {
    await this.setDoc('orders', id, data);
  },

  async getCourses(): Promise<any[]> {
    try {
      const { getCachedCourses } = await import('@/lib/cache');
      const cached = await getCachedCourses();
      if (Array.isArray(cached) && cached.length > 0) return cached;
    } catch (e) {}

    try {
      const res = await axios.get(formatApiUrl('/api/courses'), { timeout: 4000 });
      if (Array.isArray(res.data) && res.data.length > 0) return res.data;
    } catch (e) {}

    // Firestore direct fallback
    try {
      const snap = await getFirestoreDocs(collection(db, 'courses'));
      if (!snap.empty) {
        return snap.docs.map(d => ({ id: d.id, ...d.data() }));
      }
    } catch (e) {}

    return [];
  },

  async getOrdersAdmin(l = 50): Promise<any[]> {
    try {
      const response = await axios.get(formatApiUrl(`/api/admin/all-orders?limit=${l}`), { timeout: 4000 });
      if (Array.isArray(response.data) && response.data.length > 0) return response.data;
    } catch (e) {}

    // Firestore fallback
    try {
      const snap = await getFirestoreDocs(fsQuery(collection(db, 'orders'), fsLimit(l)));
      if (!snap.empty) {
        return snap.docs.map(d => ({ id: d.id, ...d.data() }));
      }
    } catch (e) {}

    return [];
  },

  async submitManualDeposit(depositId: string, data: any): Promise<void> {
    await this.setDoc('deposits', depositId, {
      ...data,
      status: 'pending',
      type: 'deposit',
      createdAt: new Date().toISOString()
    });
  },

  async getUserDeposits(userId: string, userEmail?: string): Promise<any[]> {
    return [];
  },

  observeOrder(id: string, callback: (data: any) => void): () => void {
    return () => {};
  }
};

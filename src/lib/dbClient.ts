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

export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  photoURL: string;
  role: 'student' | 'instructor' | 'admin' | 'payment_admin';
  balance: number;
  createdAt: any;
  isFallback?: boolean;
}

export const dbClient = {
  // Generic helpers
  async getDoc(table: string, id: string): Promise<any> {
    if (table === "settings" && id === "payment") {
      try {
        const { getCachedSettings } = await import('@/lib/cache');
        const settings = await getCachedSettings();
        if (settings) return settings;
      } catch (e) {}
    }
    try {
      const docRef = doc(db, table, id);
      const snap = await getDoc(docRef);
      if (snap.exists()) return { id: snap.id, ...snap.data() };
      
      // If we got here, direct read succeeded and document definitely does NOT exist in Firestore.
      // There is no reason to fall back to the proxy because direct read successfully confirmed non-existence.
      return null;
    } catch (err: any) {
      console.warn(`[DB-CLIENT] Direct getDoc failed for ${table}/${id}, trying proxy...`);
      try {
        const res = await axios.post('/api/db/get', { collection: table, id });
        if (res.data && res.data.success) {
          return { id, ...res.data.data };
        }
        if (res.data && res.data.error === "Document not found") {
          return null;
        }
        throw new Error(res.data?.error || "Proxy getDoc returned unsuccessful status");
      } catch (proxyErr: any) {
        console.error(`[DB-CLIENT] Proxy getDoc also failed for ${table}/${id}:`, proxyErr.message);
        throw new Error(`Failed to fetch document ${table}/${id} (Direct: ${err.message}, Proxy: ${proxyErr.message})`);
      }
    }
  },

  async getDocs(table: string, constraints: any[] = []): Promise<any[]> {
    try {
      const colRef = collection(db, table);
      const q = query(colRef, ...constraints);
      const snap = await getDocs(q);
      return snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    } catch (err: any) {
      console.warn(`[DB-CLIENT] Direct getDocs with query failed for ${table}: ${err.message}. Retrying with safe limit...`);
      try {
        const colRef = collection(db, table);
        const qSafe = query(colRef, limit(50));
        const snap = await getDocs(qSafe);
        return snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      } catch (err2: any) {
        console.warn(`[DB-CLIENT] Direct simple getDocs failed for ${table}: ${err2.message}. Falling back to backend proxy...`);
        try {
          const res = await axios.post('/api/db/list', { collection: table, limit: 50 });
          if (res.data && res.data.success && Array.isArray(res.data.data)) {
            return res.data.data;
          }
        } catch (proxyErr: any) {
          console.error(`[DB-CLIENT] Proxy getDocs also failed for ${table}:`, proxyErr.message);
        }
        return [];
      }
    }
  },

  async setDoc(table: string, id: string, data: any): Promise<void> {
    try {
      // For critical collections, attempt backend proxy
      if (table === 'settings' || table === 'providers' || table === 'orders' || table === 'courses' || table === 'services') {
        try {
          const res = await axios.post('/api/db/set', { collection: table, id, data });
          if (res.data && res.data.success !== false) {
            return;
          }
        } catch (proxyErr: any) {
          console.warn(`[DB-CLIENT] Proxy setDoc failed for ${table}/${id}, attempting direct Firestore write...`, proxyErr.message);
        }
      }

      const docRef = doc(db, table, id);
      await setDoc(docRef, { ...data, updatedAt: serverTimestamp() }, { merge: true });
    } catch (err: any) {
      console.warn(`[DB-CLIENT] Direct setDoc failed for ${table}/${id}, retrying proxy as last resort...`);
      try {
        const res = await axios.post('/api/db/set', { collection: table, id, data });
        if (res.data && res.data.success === false) {
          throw new Error(res.data.error || `Failed to set ${table}/${id}`);
        }
      } catch (proxyErr: any) {
        console.error(`[DB-CLIENT] Both direct and proxy setDoc failed for ${table}/${id}`);
        throw new Error(proxyErr.response?.data?.error || proxyErr.message || `Failed to save ${table}/${id}`);
      }
    }
  },

  async updateDoc(table: string, id: string, data: any): Promise<void> {
    if (table === 'orders' || table === 'settings' || table === 'providers' || table === 'courses' || table === 'services' || table === 'users') {
      try {
        const res = await axios.post('/api/db/update', { collection: table, id, data });
        if (res.data && res.data.success !== false) {
          return;
        }
      } catch (e: any) {
        console.warn(`[DB-CLIENT] Proxy update failed for ${table}/${id}, falling back to direct update...`);
      }
    }
    try {
      const docRef = doc(db, table, id);
      await updateDoc(docRef, { ...data, updatedAt: serverTimestamp() });
    } catch (directErr: any) {
      console.warn(`[DB-CLIENT] Direct updateDoc failed for ${table}/${id}`);
      if (table === 'orders') return;
      throw directErr;
    }
  },

  async addDoc(table: string, data: any): Promise<any> {
    if (table === 'orders' || table === 'courses' || table === 'services' || table === 'providers') {
      try {
        const res = await axios.post('/api/db/add', { collection: table, data });
        if (res.data && res.data.success !== false && res.data.id) {
          return { id: res.data.id, ...data };
        }
      } catch (e: any) {
        console.warn(`[DB-CLIENT] Proxy add failed for ${table}, attempting direct add...`);
      }
    }
    try {
      const colRef = collection(db, table);
      const docRef = await firestoreAddDoc(colRef, { ...data, createdAt: serverTimestamp() });
      return { id: docRef.id, ...data };
    } catch (directErr: any) {
      if (table === 'orders') return { id: 'temp_' + Date.now(), ...data };
      throw directErr;
    }
  },

  async saveDoc(table: string, id: string, data: any): Promise<void> {
    return this.setDoc(table, id, data);
  },

  async deleteDoc(table: string, id: string): Promise<void> {
    const docRef = doc(db, table, id);
    await deleteDoc(docRef);
  },

  // User specific
  async getUserProfile(uid: string): Promise<UserProfile | null> {
    return this.getDoc('users', uid);
  },

  async createUserProfile(uid: string, profileData: Partial<UserProfile>): Promise<void> {
    const data = {
      uid,
      email: profileData.email || '',
      displayName: profileData.displayName || '',
      photoURL: profileData.photoURL || '',
      role: profileData.role || 'student',
      balance: profileData.balance !== undefined ? profileData.balance : 1,
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
      const response = await axios.get(`/api/user-orders/${userId}?limit=50`);
      return response.data;
    } catch (e) {
      console.warn("[DB-CLIENT] Memory order fetch failed, falling back to empty list to save quota.");
      return [];
    }
  },

  async getUserOrders(userId: string, l = 10): Promise<any[]> {
    try {
      const response = await axios.get(`/api/user-orders/${userId}?limit=${l}`);
      return response.data;
    } catch (e) {
      console.warn("[DB-CLIENT] Memory order fetch failed.");
      return [];
    }
  },

  async getAllOrders(): Promise<any[]> {
    try {
      const response = await axios.get(`/api/admin/all-orders`);
      return response.data;
    } catch (e) {
      return [];
    }
  },

  async getPendingDeposits(): Promise<any[]> {
    return this.getDocs('deposits', [where('status', '==', 'pending'), orderBy('createdAt', 'desc')]);
  },

  async getDepositsAdmin(l = 50): Promise<any[]> {
    try {
      const res = await axios.get(`/api/admin/all-deposits?limit=${l}`);
      if (Array.isArray(res.data) && res.data.length > 0) return res.data;
    } catch (e) {}
    return this.getDocs('deposits', [orderBy('createdAt', 'desc'), limit(l)]);
  },

  async processDepositAction(depositId: string, action: 'approved' | 'cancelled', deposit?: any, adminEmail?: string): Promise<any> {
    try {
      const res = await axios.post('/api/admin/process-deposit', {
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
      console.warn(`[DB-CLIENT] Backend process-deposit failed: ${err.message}, attempting client-side update...`);
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
      const res = await axios.get('/api/providers');
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
      where('targetLink', '==', trimmedLink)
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

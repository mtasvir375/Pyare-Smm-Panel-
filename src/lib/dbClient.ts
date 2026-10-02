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
  // Generic helpers - 100% SQLite & Node.js memory powered (0 Firestore reads/writes)
  async getDoc(table: string, id: string, options?: { fresh?: boolean }): Promise<any> {
    const forceFresh = !!options?.fresh;
    if (table === "settings" && id === "payment" && !forceFresh) {
      try {
        const { getCachedSettings } = await import('@/lib/cache');
        const settings = await getCachedSettings();
        if (settings) return settings;
      } catch (e) {}
    }
    try {
      const res = await axios.post(formatApiUrl('/api/db/get'), { collection: table, id, fresh: forceFresh });
      if (res.data && res.data.success && res.data.data && Object.keys(res.data.data).length > 0) {
        return { id, ...res.data.data };
      }
      if (res.data && res.data.error === "Document not found") {
        return null;
      }
    } catch (proxyErr: any) {}

    return null;
  },

  async getDocs(table: string, constraints: any[] = []): Promise<any[]> {
    try {
      const limitCount = table === 'courses' ? 100 : (table === 'providers' ? 50 : 30);
      const res = await axios.post(formatApiUrl('/api/db/list'), { collection: table, limit: limitCount });
      if (res.data && res.data.success && Array.isArray(res.data.data)) {
        return res.data.data;
      }
    } catch (proxyErr: any) {}

    return [];
  },

  async setDoc(table: string, id: string, data: any): Promise<void> {
    if (table === 'courses' || table === 'settings' || table === 'providers') {
      axios.post(formatApiUrl('/api/clear-cache')).catch(() => {});
    }
    try {
      await axios.post(formatApiUrl('/api/db/set'), { collection: table, id, data });
    } catch (proxyErr: any) {}
  },

  async updateDoc(table: string, id: string, data: any): Promise<void> {
    if (table === 'courses' || table === 'settings' || table === 'providers') {
      axios.post(formatApiUrl('/api/clear-cache')).catch(() => {});
    }
    try {
      await axios.post(formatApiUrl('/api/db/update'), { collection: table, id, data });
    } catch (e: any) {}
  },

  async addDoc(table: string, data: any): Promise<any> {
    if (table === 'courses' || table === 'settings' || table === 'providers') {
      axios.post(formatApiUrl('/api/clear-cache')).catch(() => {});
    }
    try {
      const res = await axios.post(formatApiUrl('/api/db/add'), { collection: table, data });
      if (res.data && res.data.success !== false && res.data.id) {
        return { id: res.data.id, ...data };
      }
    } catch (e: any) {}

    const fakeId = `doc_${Date.now()}`;
    return { id: fakeId, ...data };
  },

  async saveDoc(table: string, id: string, data: any): Promise<void> {
    return this.setDoc(table, id, data);
  },

  async deleteDoc(table: string, id: string): Promise<void> {
    if (table === 'courses' || table === 'settings' || table === 'providers') {
      axios.post(formatApiUrl('/api/clear-cache')).catch(() => {});
    }
    try {
      await axios.post(formatApiUrl('/api/db/delete'), { collection: table, id });
    } catch (e) {}
  },

  // User specific
  async getUserProfile(uid: string): Promise<UserProfile | null> {
    if (!uid) return null;
    
    try {
      const res = await axios.post(formatApiUrl('/api/db/get'), { collection: 'users', id: uid, fresh: true });
      if (res.data && res.data.success && res.data.data) {
        return { id: uid, uid, ...res.data.data };
      }
    } catch (proxyErr: any) {}

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
      const response = await axios.get(formatApiUrl(`/api/user-orders/${userId}?limit=50`));
      return response.data || [];
    } catch (e) {
      return [];
    }
  },

  async getUserOrders(userId: string, l = 10, email?: string): Promise<any[]> {
    const limitCount = Math.min(l, 10);
    try {
      const emailQuery = email ? `&email=${encodeURIComponent(email)}` : "";
      const response = await axios.get(formatApiUrl(`/api/user-orders/${userId}?limit=${limitCount}${emailQuery}`), { timeout: 6000 });
      if (Array.isArray(response.data)) {
        return response.data.slice(0, 10);
      }
    } catch (e) {}
    return [];
  },

  async getAllOrders(): Promise<any[]> {
    try {
      const response = await axios.get(formatApiUrl(`/api/admin/all-orders`));
      return response.data || [];
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
      if (Array.isArray(res.data)) return res.data;
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
    try {
      const res = await axios.post(formatApiUrl('/api/db/list'), { collection: table, limit: 1000 });
      if (res.data && res.data.success && Array.isArray(res.data.data)) {
        return res.data.data.length;
      }
    } catch (e) {}
    return 0;
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
      const res = await axios.get(formatApiUrl('/api/courses'));
      if (Array.isArray(res.data) && res.data.length > 0) return res.data;
    } catch (e) {}
    return [];
  },

  async getOrdersAdmin(l = 50): Promise<any[]> {
    try {
      const response = await axios.get(formatApiUrl(`/api/admin/all-orders?limit=${l}`));
      if (Array.isArray(response.data) && response.data.length > 0) return response.data;
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

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
    } catch (err) {
      console.warn(`[DB-CLIENT] Direct getDocs failed for ${table}, trying proxy...`);
      try {
        const res = await axios.post('/api/db/list', { collection: table });
        if (res.data.success) return res.data.data;
      } catch (proxyErr) {
        console.error(`[DB-CLIENT] Proxy getDocs also failed for ${table}`);
      }
      return [];
    }
  },

  async setDoc(table: string, id: string, data: any): Promise<void> {
    try {
      // For critical collections or when client SDK fails, use the proxy
      if (table === 'settings' || table === 'providers' || table === 'orders' || table === 'courses' || table === 'services') {
        const res = await axios.post('/api/db/set', { collection: table, id, data });
        if (res.data && res.data.success === false) {
          throw new Error(res.data.error || `Failed to set ${table}/${id} via proxy`);
        }
        return;
      }

      const docRef = doc(db, table, id);
      await setDoc(docRef, { ...data, updatedAt: serverTimestamp() }, { merge: true });
    } catch (err: any) {
      console.warn(`[DB-CLIENT] Direct setDoc failed for ${table}/${id}, trying proxy...`);
      try {
        const res = await axios.post('/api/db/set', { collection: table, id, data });
        if (res.data && res.data.success === false) {
          throw new Error(res.data.error || `Failed to set ${table}/${id} via fallback proxy`);
        }
      } catch (proxyErr) {
        console.error(`[DB-CLIENT] Proxy setDoc also failed for ${table}/${id}`);
        throw proxyErr;
      }
    }
  },

  async updateDoc(table: string, id: string, data: any): Promise<void> {
    if (table === 'orders' || table === 'settings' || table === 'providers' || table === 'courses' || table === 'services' || table === 'users') {
      try {
        const res = await axios.post('/api/db/update', { collection: table, id, data });
        if (res.data && res.data.success === false) {
          throw new Error(res.data.error || `Failed to update ${table}/${id} via proxy`);
        }
        return;
      } catch (e: any) {
        console.warn(`[DB-CLIENT] Proxy update failed for ${table}/${id}.`);
        if (table === 'orders') return;
        throw e;
      }
    }
    const docRef = doc(db, table, id);
    await updateDoc(docRef, { ...data, updatedAt: serverTimestamp() });
  },

  async addDoc(table: string, data: any): Promise<any> {
    if (table === 'orders' || table === 'courses' || table === 'services' || table === 'providers') {
      try {
        const res = await axios.post('/api/db/add', { collection: table, data });
        if (res.data && res.data.success === false) {
          throw new Error(res.data.error || `Failed to add ${table} via proxy`);
        }
        return { id: res.data.id, ...data };
      } catch (e: any) {
        if (table === 'orders') return { id: 'temp_' + Date.now(), ...data };
        console.warn(`[DB-CLIENT] Proxy add failed for ${table}.`);
        throw e;
      }
    }
    const colRef = collection(db, table);
    const docRef = await firestoreAddDoc(colRef, { ...data, createdAt: serverTimestamp() });
    return { id: docRef.id, ...data };
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
    return this.getDocs('deposits', [orderBy('createdAt', 'desc'), limit(l)]);
  },

  async getProviders(): Promise<any[]> {
    return this.getDocs('providers', [orderBy('createdAt', 'desc')]);
  },

  async checkDuplicateOrder(userId: string, courseId: string, link: string): Promise<boolean> {
    // Check if any order with same link and course was placed in last 25 minutes
    const twentyFiveMinsAgo = new Date(Date.now() - 25 * 60 * 1000);
    
    // Fetch all orders of this user with this target link to avoid complex composite index requirement
    const q = query(
      collection(db, 'orders'),
      where('userId', '==', userId),
      where('targetLink', '==', link.trim())
    );
    
    const snap = await getDocs(q);
    if (snap.empty) return false;
    
    return snap.docs.some(doc => {
      const data = doc.data();
      const cId = data.courseId || data.serviceId;
      if (cId !== courseId) return false;
      
      // Parse createdAt
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
      
      if (createdDate && createdDate > twentyFiveMinsAgo) {
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
    return this.getDocs('courses', [orderBy('createdAt', 'desc')]);
  },

  async getOrdersAdmin(l = 50): Promise<any[]> {
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

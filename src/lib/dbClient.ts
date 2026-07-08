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
}

export const dbClient = {
  // Generic helpers
  async getDoc(table: string, id: string): Promise<any> {
    const docRef = doc(db, table, id);
    const snap = await getDoc(docRef);
    if (!snap.exists()) return null;
    return { id: snap.id, ...snap.data() };
  },

  async getDocs(table: string, constraints: any[] = []): Promise<any[]> {
    const colRef = collection(db, table);
    const q = query(colRef, ...constraints);
    const snap = await getDocs(q);
    return snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  },

  async setDoc(table: string, id: string, data: any): Promise<void> {
    if (table === 'orders') {
      try {
        await axios.post('/api/db/set', { collection: table, id, data });
        return;
      } catch (e) {
        console.warn("[DB-CLIENT] Memory order set failed.");
        return;
      }
    }
    const docRef = doc(db, table, id);
    await setDoc(docRef, { ...data, updatedAt: serverTimestamp() }, { merge: true });
  },

  async updateDoc(table: string, id: string, data: any): Promise<void> {
    if (table === 'orders') {
      try {
        await axios.post('/api/db/update', { collection: table, id, data });
        return;
      } catch (e) {
        console.warn("[DB-CLIENT] Memory order update failed.");
        return;
      }
    }
    const docRef = doc(db, table, id);
    await updateDoc(docRef, { ...data, updatedAt: serverTimestamp() });
  },

  async addDoc(table: string, data: any): Promise<any> {
    if (table === 'orders') {
      try {
        const res = await axios.post('/api/db/add', { collection: table, data });
        return { id: res.data.id, ...data };
      } catch (e) {
        return { id: 'temp_' + Date.now(), ...data };
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

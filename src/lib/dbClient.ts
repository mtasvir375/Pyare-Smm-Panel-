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
    const docRef = doc(db, table, id);
    await setDoc(docRef, { ...data, updatedAt: serverTimestamp() }, { merge: true });
  },

  async updateDoc(table: string, id: string, data: any): Promise<void> {
    const docRef = doc(db, table, id);
    await updateDoc(docRef, { ...data, updatedAt: serverTimestamp() });
  },

  async addDoc(table: string, data: any): Promise<any> {
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
      balance: profileData.balance || 0,
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
    return this.getDocs('orders', [where('userId', '==', userId), orderBy('createdAt', 'desc')]);
  },

  async getUserOrders(userId: string, l = 10): Promise<any[]> {
    return this.getDocs('orders', [where('userId', '==', userId), orderBy('createdAt', 'desc'), limit(l)]);
  },

  async getAllOrders(): Promise<any[]> {
    return this.getDocs('orders', [orderBy('createdAt', 'desc')]);
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
    // Check if any order with same link and course was placed in last 10 minutes
    const tenMinsAgo = new Date(Date.now() - 10 * 60 * 1000);
    const q = query(
      collection(db, 'orders'),
      where('userId', '==', userId),
      where('courseId', '==', courseId),
      where('targetLink', '==', link),
      where('createdAt', '>', tenMinsAgo),
      limit(1)
    );
    const snap = await getDocs(q);
    return !snap.empty;
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

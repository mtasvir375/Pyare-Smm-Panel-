import { supabase } from "./supabaseClient";

/**
 * Universal Database Client for SMM Panel Pro.
 * Exclusively uses Supabase for all reads, writes, and real-time subscriptions.
 */

export const dbClient = {
  // 1. USER PROFILES
  async getUserProfile(uid: string): Promise<any | null> {
    try {
      const { data, error } = await supabase
        .from("users")
        .select("*")
        .eq("id", uid)
        .maybeSingle();
      
      if (error) throw error;
      return data;
    } catch (err) {
      console.warn("[SUPABASE] getUserProfile failed:", err);
      return null;
    }
  },

  async createUserProfile(uid: string, profileData: any): Promise<void> {
    const fsData = {
      id: uid,
      email: profileData.email || "",
      display_name: profileData.displayName || "",
      role: profileData.role || "student",
      balance: profileData.balance !== undefined ? Number(profileData.balance) : 1,
    };
    
    const { error } = await supabase.from("users").upsert(fsData);
    if (error) throw error;
  },

  async updateUserProfile(uid: string, data: any): Promise<void> {
    const { error } = await supabase.from("users").update(data).eq("id", uid);
    if (error) throw error;
  },

  observeUserProfile(uid: string, callback: (data: any) => void): () => void {
    // Subscription for real-time updates
    const channel = supabase
      .channel(`user-profile-${uid}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "users", filter: `id=eq.${uid}` },
        (payload) => callback(payload.new)
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  },

  // 2. ORDERS
  async getUserOrders(uid: string, limitNum: number = 10): Promise<any[]> {
    const { data, error } = await supabase
      .from("orders")
      .select("*")
      .eq("user_id", uid)
      .order("created_at", { ascending: false })
      .limit(limitNum);
    
    if (error) throw error;
    return data || [];
  },

  async checkDuplicateOrder(uid: string, serviceId: string, targetLink: string): Promise<boolean> {
    const { data, error } = await supabase
      .from("orders")
      .select("created_at")
      .eq("user_id", uid)
      .eq("service_id", serviceId)
      .eq("target_link", targetLink)
      .order("created_at", { ascending: false })
      .limit(1);

    if (error) return false;
    if (data && data.length > 0) {
      const orderTime = new Date(data[0].created_at).getTime();
      if ((Date.now() - orderTime) < 10 * 60 * 1000) { // 10 minutes
        return true;
      }
    }
    return false;
  },

  async createOrder(orderId: string, orderData: any): Promise<void> {
    const { error } = await supabase.from("orders").insert({
      id: orderId,
      user_id: orderData.user_id || orderData.userId,
      service_id: orderData.service_id || orderData.courseId || orderData.serviceId,
      title: orderData.title || orderData.courseTitle,
      target_link: orderData.target_link || orderData.targetLink,
      quantity: orderData.quantity,
      total_price: orderData.total_price || orderData.totalPrice,
      status: orderData.status || "pending"
    });
    if (error) throw error;
  },

  observeOrder(orderId: string, callback: (data: any) => void): () => void {
    const channel = supabase
      .channel(`order-${orderId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "orders", filter: `id=eq.${orderId}` },
        (payload) => callback(payload.new)
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  },

  // 3. TRANSACTIONS
  async submitManualDeposit(depositId: string, depositData: any): Promise<void> {
    const { error } = await supabase.from("transactions").insert({
      id: depositId,
      user_id: depositData.user_id || depositData.userId,
      amount: depositData.amount,
      type: "deposit",
      utr: depositData.utr,
      screenshot_url: depositData.screenshot_url || depositData.screenshotUrl,
      status: "pending"
    });
    if (error) throw error;
  },

  // 4. ADMIN OPERATIONS
  async getServices(): Promise<any[]> {
    const { data, error } = await supabase
      .from("services")
      .select("*")
      .order("created_at", { ascending: false });
    
    if (error) throw error;
    return data || [];
  },

  async getCourses(): Promise<any[]> {
    return this.getServices();
  },

  async getAdminOrders(limitNum: number = 50): Promise<any[]> {
    const { data, error } = await supabase
      .from("orders")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limitNum);
    
    if (error) throw error;
    return data || [];
  },

  async getOrdersAdmin(limitNum: number = 50): Promise<any[]> {
    return this.getAdminOrders(limitNum);
  },

  async getAdminTransactions(limitNum: number = 50): Promise<any[]> {
    const { data, error } = await supabase
      .from("transactions")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limitNum);
    
    if (error) throw error;
    return data || [];
  },

  async getDepositsAdmin(limitNum: number = 50): Promise<any[]> {
    return this.getAdminTransactions(limitNum);
  },

  async getProviders(): Promise<any[]> {
    const { data, error } = await supabase
      .from("providers")
      .select("*")
      .order("created_at", { ascending: false });
    
    if (error) throw error;
    return data || [];
  },

  async searchUsersAdmin(searchQuery: string, limitNum: number = 30): Promise<any[]> {
    let query = supabase.from("users").select("*").limit(limitNum);
    
    if (searchQuery) {
      query = query.or(`email.ilike.%${searchQuery}%,display_name.ilike.%${searchQuery}%`);
    }
    
    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  },

  async getDoc(table: string, id: string): Promise<any | null> {
    const { data, error } = await supabase.from(table).select("*").eq("id", id).maybeSingle();
    if (error) return null;
    return data;
  },

  async updateDoc(table: string, id: string, data: any): Promise<void> {
    const { error } = await supabase.from(table).update(data).eq("id", id);
    if (error) throw error;
  },

  async saveDoc(table: string, id: string, data: any): Promise<void> {
    const { error } = await supabase.from(table).upsert({ id, ...data });
    if (error) throw error;
  },

  async deleteDoc(table: string, id: string): Promise<void> {
    const { error } = await supabase.from(table).delete().eq("id", id);
    if (error) throw error;
  },

  observeTable(table: string, callback: (payload: any) => void): () => void {
    const channel = supabase
      .channel(`table-changes-${table}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: table },
        (payload) => callback(payload)
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  },

  async getTableCount(table: string): Promise<number> {
    const { count, error } = await supabase
      .from(table)
      .select("*", { count: "exact", head: true });
    
    if (error) return 0;
    return count || 0;
  }
};

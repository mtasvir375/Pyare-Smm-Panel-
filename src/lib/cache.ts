import axios from "axios";
import { db } from "@/lib/firebase";
import { collection, doc, getDocs, getDoc } from "firebase/firestore";

let cachedCourses: any = null;
let lastCoursesFetch = 0;
const CACHE_DURATION = 30 * 60 * 1000; // 30 minutes to save massive reads

// Clear cache (useful for admin when they update something)
export const clearCache = () => {
    cachedCourses = null;
    lastCoursesFetch = 0;
    cachedSettings = null;
    lastSettingsFetch = 0;
    try {
        localStorage.removeItem("cached_courses");
        localStorage.removeItem("cached_courses_time");
        localStorage.removeItem("cached_settings");
        localStorage.removeItem("cached_settings_time");
    } catch(e) {}
    
    // Concurrently clear server-side cache so visitors fetch fresh data immediately
    axios.post("/api/clear-cache").catch((err) => {
        console.error("Failed to clear server-side cache via API proxy:", err);
    });
}

export const getCachedCourses = async (forceRefresh = false) => {
  const now = Date.now();
  
  if (!forceRefresh) {
    if (cachedCourses && (now - lastCoursesFetch < CACHE_DURATION)) {
      return cachedCourses;
    }
    
    // Check localStorage
    try {
      const lsTime = localStorage.getItem("cached_courses_time");
      if (lsTime && (now - parseInt(lsTime) < CACHE_DURATION)) {
        const lsData = localStorage.getItem("cached_courses");
        if (lsData) {
          const parsed = JSON.parse(lsData);
          // Always ensure sorting on retrieval
          const categoryOrder = ["Instagram", "YouTube", "Facebook", "TikTok", "Telegram", "Twitter", "Other"];
          const getTimestamp = (item: any) => {
            const val = item.updatedAt || item.updated_at || item.createdAt || item.created_at;
            if (!val) return 0;
            if (typeof val.toDate === "function") return val.toDate().getTime();
            if (typeof val.seconds === "number") return val.seconds * 1000;
            if (val._seconds !== undefined) return val._seconds * 1000;
            const t = new Date(val).getTime();
            return isNaN(t) ? 0 : t;
          };

          parsed.sort((a: any, b: any) => {
            const orderA = categoryOrder.indexOf(a.category) === -1 ? 99 : categoryOrder.indexOf(a.category);
            const orderB = categoryOrder.indexOf(b.category) === -1 ? 99 : categoryOrder.indexOf(b.category);
            if (orderA !== orderB) return orderA - orderB;
            
            const timeA = getTimestamp(a);
            const timeB = getTimestamp(b);
            return timeB - timeA;
          });
          cachedCourses = parsed;
          lastCoursesFetch = parseInt(lsTime);
          return cachedCourses;
        }
      }
    } catch(e) {}
  }
  
  // Try fetching from Express API proxy first.
  // Express serves this from backend memory cache (24h TTL) to prevent Firestore read quota consumption!
  try {
    const res = await axios.get("/api/courses");
    const activeServices = res.data.map((data: any) => ({
      id: data.id,
      ...data,
      price: data.pricePerThousand !== undefined ? Number(data.pricePerThousand) : (data.price !== undefined ? Number(data.price) : 0),
      pricePerThousand: data.pricePerThousand !== undefined ? Number(data.pricePerThousand) : (data.price !== undefined ? Number(data.price) : 0),
      minLimit: data.minLimit !== undefined ? Number(data.minLimit) : (data.min_limit !== undefined ? Number(data.min_limit) : 1000),
      min_limit: data.minLimit !== undefined ? Number(data.minLimit) : (data.min_limit !== undefined ? Number(data.min_limit) : 1000),
      providerServiceId: data.providerServiceId !== undefined ? String(data.providerServiceId) : (data.provider_service_id !== undefined ? String(data.provider_service_id) : "0"),
      provider_service_id: data.providerServiceId !== undefined ? String(data.providerServiceId) : (data.provider_service_id !== undefined ? String(data.provider_service_id) : "0"),
      isPackage: data.isPackage !== undefined ? !!data.isPackage : !!data.is_package,
      is_package: data.isPackage !== undefined ? !!data.isPackage : !!data.is_package,
      packagePrice: data.packagePrice !== undefined ? Number(data.packagePrice) : (data.package_price !== undefined ? Number(data.package_price) : 0),
      package_price: data.packagePrice !== undefined ? Number(data.packagePrice) : (data.package_price !== undefined ? Number(data.package_price) : 0),
      packageQuantity: data.packageQuantity !== undefined ? Number(data.packageQuantity) : (data.package_quantity !== undefined ? Number(data.package_quantity) : 1000),
      package_quantity: data.packageQuantity !== undefined ? Number(data.packageQuantity) : (data.package_quantity !== undefined ? Number(data.package_quantity) : 1000),
      iconUrl: data.iconUrl || data.icon_url || null,
      icon_url: data.iconUrl || data.icon_url || null,
    }));

    cachedCourses = activeServices;
    lastCoursesFetch = now;
    try {
      localStorage.setItem("cached_courses_time", now.toString());
      localStorage.setItem("cached_courses", JSON.stringify(cachedCourses));
    } catch(e) {}
    console.log("[CACHE] Successfully refreshed courses from Express API proxy!");
  } catch (apiErr) {
    console.warn("[CACHE] Failed to fetch courses from Express API proxy, falling back to direct Web SDK query", apiErr);
    try {
      // Direct Web SDK Query Fallback
      const querySnapshot = await getDocs(collection(db, "courses"));
      const fetchedCourses = querySnapshot.docs.map(gdoc => {
        const data = gdoc.data();
        return {
          id: gdoc.id,
          ...data,
          price: data.pricePerThousand !== undefined ? Number(data.pricePerThousand) : (data.price !== undefined ? Number(data.price) : 0),
          pricePerThousand: data.pricePerThousand !== undefined ? Number(data.pricePerThousand) : (data.price !== undefined ? Number(data.price) : 0),
          minLimit: data.minLimit !== undefined ? Number(data.minLimit) : (data.min_limit !== undefined ? Number(data.min_limit) : 1000),
          min_limit: data.minLimit !== undefined ? Number(data.minLimit) : (data.min_limit !== undefined ? Number(data.min_limit) : 1000),
          providerServiceId: data.providerServiceId !== undefined ? String(data.providerServiceId) : (data.provider_service_id !== undefined ? String(data.provider_service_id) : "0"),
          provider_service_id: data.providerServiceId !== undefined ? String(data.providerServiceId) : (data.provider_service_id !== undefined ? String(data.provider_service_id) : "0"),
          isPackage: data.isPackage !== undefined ? !!data.isPackage : !!data.is_package,
          is_package: data.isPackage !== undefined ? !!data.isPackage : !!data.is_package,
          packagePrice: data.packagePrice !== undefined ? Number(data.packagePrice) : (data.package_price !== undefined ? Number(data.package_price) : 0),
          package_price: data.packagePrice !== undefined ? Number(data.packagePrice) : (data.package_price !== undefined ? Number(data.package_price) : 0),
          packageQuantity: data.packageQuantity !== undefined ? Number(data.packageQuantity) : (data.package_quantity !== undefined ? Number(data.package_quantity) : 1000),
          package_quantity: data.packageQuantity !== undefined ? Number(data.packageQuantity) : (data.package_quantity !== undefined ? Number(data.package_quantity) : 1000),
          iconUrl: data.iconUrl || data.icon_url || null,
          icon_url: data.iconUrl || data.icon_url || null,
        };
      });

      const activeServices = fetchedCourses.filter((s: any) => s.status !== "archived" && s.status !== "hidden");

      const categoryOrder = ["Instagram", "YouTube", "Facebook", "TikTok", "Telegram", "Twitter", "Other"];
      const getTimestamp = (item: any) => {
        const val = item.updatedAt || item.updated_at || item.createdAt || item.created_at;
        if (!val) return 0;
        if (typeof val.toDate === "function") return val.toDate().getTime();
        if (typeof val.seconds === "number") return val.seconds * 1000;
        if (val._seconds !== undefined) return val._seconds * 1000;
        const t = new Date(val).getTime();
        return isNaN(t) ? 0 : t;
      };

      activeServices.sort((a: any, b: any) => {
        const orderA = categoryOrder.indexOf(a.category) === -1 ? 99 : categoryOrder.indexOf(a.category);
        const orderB = categoryOrder.indexOf(b.category) === -1 ? 99 : categoryOrder.indexOf(b.category);
        if (orderA !== orderB) return orderA - orderB;
        
        const timeA = getTimestamp(a);
        const timeB = getTimestamp(b);
        return timeB - timeA;
      });

      cachedCourses = activeServices;
      lastCoursesFetch = now;
      try {
        localStorage.setItem("cached_courses_time", now.toString());
        localStorage.setItem("cached_courses", JSON.stringify(cachedCourses));
      } catch(e) {}
    } catch (sdkErr) {
      console.error("[CACHE] Direct Web SDK query failed as well:", sdkErr);
      if (!cachedCourses) cachedCourses = [];
    }
  }
  
  return cachedCourses;
};

let cachedSettings: any = null;
let lastSettingsFetch = 0;

export const getCachedSettings = async (forceRefresh = false) => {
  const now = Date.now();
  
  if (!forceRefresh) {
    if (cachedSettings && (now - lastSettingsFetch < CACHE_DURATION)) {
      return cachedSettings;
    }
    
    // Check localStorage
    try {
      const lsTime = localStorage.getItem("cached_settings_time");
      if (lsTime && (now - parseInt(lsTime) < CACHE_DURATION)) {
        const lsData = localStorage.getItem("cached_settings");
        if (lsData) {
          cachedSettings = JSON.parse(lsData);
          lastSettingsFetch = parseInt(lsTime);
          return cachedSettings;
        }
      }
    } catch(e) {}
  }
  
  // Try fetching from Express API proxy first.
  // Express serves this from backend memory cache (24h TTL) to prevent Firestore read quota consumption!
  try {
    const res = await axios.get("/api/settings");
    const settingsData = {
      ...res.data,
      upiId: res.data.upiId || "",
      paymentQrUrl: res.data.paymentQrUrl || "",
      merchantName: res.data.merchantName || "",
      razorpayEnabled: !!res.data.razorpayEnabled,
      razorpayKeyId: res.data.razorpayKeyId || "",
      razorpayKeySecret: res.data.razorpayKeySecret || "",
      phonepeEnabled: !!res.data.phonepeEnabled,
      phonepeMerchantId: res.data.phonepeMerchantId || "",
      phonepeSaltKey: res.data.phonepeSaltKey || "",
      phonepeSaltIndex: res.data.phonepeSaltIndex || "1",
      phonepeEnv: res.data.phonepeEnv || "sandbox",
      paytmEnabled: !!res.data.paytmEnabled,
      paytmMid: res.data.paytmMid || "",
      paytmMerchantKey: res.data.paytmMerchantKey || "",
      paytmEnv: res.data.paytmEnv || "sandbox",
      whatsappLink: res.data.whatsappLink || "",
      whatsappChatNumber: res.data.whatsappChatNumber || "",
      backendApiUrl: res.data.backendApiUrl || "",
      qrAutoEnabled: !!res.data.qrAutoEnabled,
    };

    cachedSettings = settingsData;
    lastSettingsFetch = now;
    try {
      localStorage.setItem("cached_settings_time", now.toString());
      localStorage.setItem("cached_settings", JSON.stringify(cachedSettings));
    } catch(e) {}
    console.log("[CACHE] Successfully refreshed settings from Express API proxy!");
  } catch (apiErr) {
    console.warn("[CACHE] Failed to fetch settings from Express API proxy, falling back to direct Web SDK query", apiErr);
    try {
      // Direct Web SDK Query Fallback
      const docRef = doc(db, "settings", "payment");
      const docSnap = await getDoc(docRef);
      let settingsData = docSnap.exists() ? docSnap.data() : null;

      if (!settingsData) {
        throw new Error("Settings document does not exist");
      }

      settingsData = {
        ...settingsData,
        upiId: settingsData.upiId || "",
        paymentQrUrl: settingsData.paymentQrUrl || "",
        merchantName: settingsData.merchantName || "",
        razorpayEnabled: !!settingsData.razorpayEnabled,
        razorpayKeyId: settingsData.razorpayKeyId || "",
        razorpayKeySecret: settingsData.razorpayKeySecret || "",
        phonepeEnabled: !!settingsData.phonepeEnabled,
        phonepeMerchantId: settingsData.phonepeMerchantId || "",
        phonepeSaltKey: settingsData.phonepeSaltKey || "",
        phonepeSaltIndex: settingsData.phonepeSaltIndex || "1",
        phonepeEnv: settingsData.phonepeEnv || "sandbox",
        paytmEnabled: !!settingsData.paytmEnabled,
        paytmMid: settingsData.paytmMid || "",
        paytmMerchantKey: settingsData.paytmMerchantKey || "",
        paytmEnv: settingsData.paytmEnv || "sandbox",
        whatsappLink: settingsData.whatsappLink || "",
        whatsappChatNumber: settingsData.whatsappChatNumber || "",
        backendApiUrl: settingsData.backendApiUrl || "",
        qrAutoEnabled: !!settingsData.qrAutoEnabled,
      };

      cachedSettings = settingsData;
      lastSettingsFetch = now;
      try {
        localStorage.setItem("cached_settings_time", now.toString());
        localStorage.setItem("cached_settings", JSON.stringify(cachedSettings));
      } catch(e) {}
    } catch (sdkErr) {
      console.error("[CACHE] Direct Web SDK query failed as well:", sdkErr);
      if (!cachedSettings) cachedSettings = {};
    }
  }
  return cachedSettings || {};
};

import axios from "axios";
import { db } from "@/lib/firebase";
import { collection, doc, getDocs, getDoc } from "firebase/firestore";
import { DEFAULT_SERVICES, DEFAULT_SETTINGS } from "@/data/defaultServices";

let cachedCourses: any = null;
let lastCoursesFetch = 0;
const CACHE_DURATION = 120 * 60 * 1000; // 2 hours cache for optimal Firestore read quota savings

// Clear cache (useful for admin when they update something)
export const clearCache = () => {
    cachedCourses = null;
    lastCoursesFetch = 0;
    cachedSettings = null;
    lastSettingsFetch = 0;
    cachedProviders = null;
    lastProvidersFetch = 0;
    try {
        localStorage.removeItem("cached_courses");
        localStorage.removeItem("cached_courses_time");
        localStorage.removeItem("cached_settings");
        localStorage.removeItem("cached_settings_time");
        localStorage.removeItem("cached_providers");
        localStorage.removeItem("cached_providers_time");
    } catch(e) {}
    
    // Concurrently clear server-side cache so visitors fetch fresh data immediately
    axios.post("/api/clear-cache").catch((err) => {
        console.error("Failed to clear server-side cache via API proxy:", err);
    });
}

// Helper to detect if a courses array is just the mock default seed
const isMockCourses = (list: any[]) => {
  return Array.isArray(list) && list.length > 0 && list.every(item => item && typeof item.id === "string" && item.id.startsWith("srv_"));
};

// Helper to detect if settings are just the unconfigured defaults
const isDefaultSettings = (s: any) => {
  return s && s.whatsappChatNumber === "+919999999999" && (!s.updatedAt || s.upiId === "paytmqr281005050101111956557626@paytm");
};

export const getCachedCourses = async (forceRefresh = false) => {
  const now = Date.now();
  
  if (!forceRefresh) {
    if (cachedCourses && !isMockCourses(cachedCourses) && (now - lastCoursesFetch < CACHE_DURATION)) {
      return cachedCourses;
    }
    
    // Check localStorage
    try {
      const lsTime = localStorage.getItem("cached_courses_time");
      if (lsTime && (now - parseInt(lsTime) < CACHE_DURATION)) {
        const lsData = localStorage.getItem("cached_courses");
        if (lsData) {
          const parsed = JSON.parse(lsData);
          if (Array.isArray(parsed) && parsed.length > 0 && !isMockCourses(parsed)) {
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
      }
    } catch(e) {}
  }
  
  // 1. Primary path: Fetch from server Express API proxy (serves from Node memory with 0 Firestore reads)
  try {
    const res = await axios.get(forceRefresh ? "/api/courses?fresh=1" : "/api/courses");
    if (Array.isArray(res.data) && res.data.length > 0) {
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
      console.log("[CACHE] Successfully loaded courses from Express memory cache!");
      return cachedCourses;
    }
  } catch (apiErr) {
    console.warn("[CACHE] Express API proxy /api/courses call failed:", apiErr);
  }

  // 2. Direct Firestore fallback (crucial for custom domain / Vercel where Express backend isn't mounted)
  try {
    const colRef = collection(db, "courses");
    const snap = await getDocs(colRef);
    if (!snap.empty) {
      const activeServices = snap.docs.map((docSnap) => {
        const data = docSnap.data() as any;
        return {
          id: docSnap.id,
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

      cachedCourses = activeServices;
      lastCoursesFetch = now;
      try {
        localStorage.setItem("cached_courses_time", now.toString());
        localStorage.setItem("cached_courses", JSON.stringify(cachedCourses));
      } catch(e) {}
      console.log("[CACHE] Successfully loaded courses directly from Firestore!");
      return cachedCourses;
    }
  } catch (fsErr) {
    console.warn("[CACHE] Direct Firestore fetch for courses failed:", fsErr);
  }

  // 3. Fallback to local default services only if both failed and Firestore is empty
  console.log("[CACHE] Serving default seed services as last resort.");
  cachedCourses = DEFAULT_SERVICES;
  lastCoursesFetch = now;
  try {
    localStorage.setItem("cached_courses_time", now.toString());
    localStorage.setItem("cached_courses", JSON.stringify(cachedCourses));
  } catch(e) {}
  return cachedCourses;
};

let cachedSettings: any = null;
let lastSettingsFetch = 0;

export const getCachedSettings = async (forceRefresh = false) => {
  const now = Date.now();
  
  if (forceRefresh) {
    cachedSettings = null;
    lastSettingsFetch = 0;
    try {
      localStorage.removeItem("cached_settings");
      localStorage.removeItem("cached_settings_time");
    } catch(e) {}
  } else {
    if (cachedSettings && !isDefaultSettings(cachedSettings) && (now - lastSettingsFetch < CACHE_DURATION)) {
      return cachedSettings;
    }
    
    // Check localStorage
    try {
      const lsTime = localStorage.getItem("cached_settings_time");
      if (lsTime && (now - parseInt(lsTime) < CACHE_DURATION)) {
        const lsData = localStorage.getItem("cached_settings");
        if (lsData) {
          const parsed = JSON.parse(lsData);
          if (parsed && !isDefaultSettings(parsed)) {
            cachedSettings = parsed;
            lastSettingsFetch = parseInt(lsTime);
            return cachedSettings;
          }
        }
      }
    } catch(e) {}
  }
  
  // 1. Primary path: Fetch from server Express API proxy (serves from Node memory with 0 Firestore reads)
  try {
    const url = forceRefresh ? `/api/settings?fresh=1&t=${now}` : "/api/settings";
    const res = await axios.get(url);
    if (res.data && typeof res.data === "object" && Object.keys(res.data).length > 0) {
      const settingsData = {
        ...DEFAULT_SETTINGS,
        ...res.data,
        upiId: res.data.upiId || DEFAULT_SETTINGS.upiId,
        paymentQrUrl: res.data.paymentQrUrl || "",
        merchantName: res.data.merchantName || DEFAULT_SETTINGS.merchantName,
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
        whatsappLink: res.data.whatsappLink || DEFAULT_SETTINGS.whatsappLink,
        whatsappChatNumber: res.data.whatsappChatNumber || DEFAULT_SETTINGS.whatsappChatNumber,
        backendApiUrl: res.data.backendApiUrl || "",
        qrAutoEnabled: !!res.data.qrAutoEnabled,
        selectedTheme: res.data.selectedTheme || "charcoal",
        selectedFestivalTheme: res.data.selectedFestivalTheme || "none",
      };

      cachedSettings = settingsData;
      lastSettingsFetch = now;
      try {
        localStorage.setItem("cached_settings_time", now.toString());
        localStorage.setItem("cached_settings", JSON.stringify(cachedSettings));
      } catch(e) {}
      console.log("[CACHE] Successfully loaded settings from Express memory cache!");
      return cachedSettings;
    }
  } catch (apiErr) {
    console.warn("[CACHE] Express API proxy /api/settings call failed:", apiErr);
  }

  // 2. Direct Firestore fallback (crucial for custom domain / Vercel where Express backend isn't mounted)
  try {
    const snap = await getDoc(doc(db, "settings", "payment"));
    if (snap.exists()) {
      const data = snap.data() || {};
      const settingsData = {
        ...DEFAULT_SETTINGS,
        ...data,
        upiId: data.upiId || DEFAULT_SETTINGS.upiId,
        paymentQrUrl: data.paymentQrUrl || "",
        merchantName: data.merchantName || DEFAULT_SETTINGS.merchantName,
        razorpayEnabled: !!data.razorpayEnabled,
        razorpayKeyId: data.razorpayKeyId || "",
        razorpayKeySecret: data.razorpayKeySecret || "",
        phonepeEnabled: !!data.phonepeEnabled,
        phonepeMerchantId: data.phonepeMerchantId || "",
        phonepeSaltKey: data.phonepeSaltKey || "",
        phonepeSaltIndex: data.phonepeSaltIndex || "1",
        phonepeEnv: data.phonepeEnv || "sandbox",
        paytmEnabled: !!data.paytmEnabled,
        paytmMid: data.paytmMid || "",
        paytmMerchantKey: data.paytmMerchantKey || "",
        paytmEnv: data.paytmEnv || "sandbox",
        whatsappLink: data.whatsappLink || DEFAULT_SETTINGS.whatsappLink,
        whatsappChatNumber: data.whatsappChatNumber || DEFAULT_SETTINGS.whatsappChatNumber,
        backendApiUrl: data.backendApiUrl || "",
        qrAutoEnabled: !!data.qrAutoEnabled,
        selectedTheme: data.selectedTheme || "charcoal",
        selectedFestivalTheme: data.selectedFestivalTheme || "none",
      };

      cachedSettings = settingsData;
      lastSettingsFetch = now;
      try {
        localStorage.setItem("cached_settings_time", now.toString());
        localStorage.setItem("cached_settings", JSON.stringify(cachedSettings));
      } catch(e) {}
      console.log("[CACHE] Successfully loaded settings directly from Firestore!");
      return cachedSettings;
    }
  } catch (fsErr) {
    console.warn("[CACHE] Direct Firestore fetch for settings failed:", fsErr);
  }

  // 3. Graceful zero-read fallback to default settings only if both failed
  console.log("[CACHE] Serving default settings as last resort.");
  cachedSettings = DEFAULT_SETTINGS;
  lastSettingsFetch = now;
  try {
    localStorage.setItem("cached_settings_time", now.toString());
    localStorage.setItem("cached_settings", JSON.stringify(cachedSettings));
  } catch(e) {}
  return cachedSettings;
};

let cachedProviders: any = null;
let lastProvidersFetch = 0;

export const getCachedProviders = async (forceRefresh = false) => {
  const now = Date.now();
  
  if (!forceRefresh) {
    if (cachedProviders && (now - lastProvidersFetch < CACHE_DURATION)) {
      return cachedProviders;
    }
    
    // Check localStorage
    try {
      const lsTime = localStorage.getItem("cached_providers_time");
      if (lsTime && (now - parseInt(lsTime) < CACHE_DURATION)) {
        const lsData = localStorage.getItem("cached_providers");
        if (lsData) {
          cachedProviders = JSON.parse(lsData);
          lastProvidersFetch = parseInt(lsTime);
          return cachedProviders;
        }
      }
    } catch(e) {}
  }
  
  try {
    const res = await axios.get("/api/providers");
    if (Array.isArray(res.data) && res.data.length > 0) {
      cachedProviders = res.data;
      lastProvidersFetch = now;
      try {
        localStorage.setItem("cached_providers_time", now.toString());
        localStorage.setItem("cached_providers", JSON.stringify(cachedProviders));
      } catch(e) {}
      return cachedProviders;
    }
  } catch (apiErr) {
    console.warn("[CACHE] Failed to load providers from /api/providers:", apiErr);
  }

  // Direct Firestore fallback
  try {
    const snap = await getDocs(collection(db, "providers"));
    if (!snap.empty) {
      cachedProviders = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      lastProvidersFetch = now;
      try {
        localStorage.setItem("cached_providers_time", now.toString());
        localStorage.setItem("cached_providers", JSON.stringify(cachedProviders));
      } catch(e) {}
      console.log("[CACHE] Successfully loaded providers directly from Firestore!");
      return cachedProviders;
    }
  } catch (fsErr) {
    console.warn("[CACHE] Direct Firestore fetch for providers failed:", fsErr);
  }
  
  return cachedProviders || [];
};

import axios from "axios";
import { DEFAULT_SERVICES, DEFAULT_SETTINGS } from "@/data/defaultServices";
import { formatApiUrl } from "./apiConfig";

let cachedCourses: any = null;
let lastCoursesFetch = 0;
const CACHE_DURATION = 24 * 60 * 60 * 1000;

// Clear cache (useful for admin when they update something)
export const clearCache = () => {
    cachedCourses = null;
    lastCoursesFetch = 0;
    cachedSettings = null;
    lastSettingsFetch = 0;
    cachedProviders = null;
    lastProvidersFetch = 0;
    
    // Concurrently clear server-side cache so visitors fetch fresh data immediately
    axios.post(formatApiUrl("/api/clear-cache")).catch(() => {});
};

export const getServiceTimestamp = (item: any): number => {
  if (!item) return 0;
  const val = item.updatedAt || item.updated_at || item.createdAt || item.created_at;
  if (!val) return 0;
  if (typeof val.toDate === "function") return val.toDate().getTime();
  if (typeof val.seconds === "number") return val.seconds * 1000;
  if (val._seconds !== undefined) return val._seconds * 1000;
  const t = new Date(val).getTime();
  return isNaN(t) ? 0 : t;
};

export const sortServicesList = (list: any[]): any[] => {
  const categoryOrder = ["Instagram", "YouTube", "Facebook", "TikTok", "Telegram", "Twitter", "X", "Other"];
  return [...list].sort((a: any, b: any) => {
    const catA = a.category || "Other";
    const catB = b.category || "Other";

    if (catA.toLowerCase() === "instagram" && catB.toLowerCase() !== "instagram") return -1;
    if (catB.toLowerCase() === "instagram" && catA.toLowerCase() !== "instagram") return 1;

    const orderA = categoryOrder.findIndex(c => c.toLowerCase() === catA.toLowerCase());
    const orderB = categoryOrder.findIndex(c => c.toLowerCase() === catB.toLowerCase());
    const rankA = orderA === -1 ? 999 : orderA;
    const rankB = orderB === -1 ? 999 : orderB;
    if (rankA !== rankB) return rankA - rankB;

    // Within each category: Latest updated / added service on TOP
    const timeA = getServiceTimestamp(a);
    const timeB = getServiceTimestamp(b);
    return timeB - timeA;
  });
};

export const getCachedCourses = async (forceRefresh = false) => {
  const now = Date.now();
  
  if (forceRefresh) {
    cachedCourses = null;
    lastCoursesFetch = 0;
  } else {
    if (cachedCourses && (now - lastCoursesFetch < CACHE_DURATION)) {
      return cachedCourses;
    }

    // Immediately load from localStorage on page refresh
    try {
      const lsData = localStorage.getItem("cached_courses");
      if (lsData) {
        const parsed = JSON.parse(lsData);
        if (Array.isArray(parsed) && parsed.length > 0) {
          cachedCourses = sortServicesList(parsed);
          lastCoursesFetch = now;
          return cachedCourses;
        }
      }
    } catch (e) {}
  }

  // Helper mapper
  const mapServiceList = (list: any[]) => {
    return list.map((data: any) => ({
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
      package_price: data.packagePrice !== undefined ? Number(data.packagePrice) : (data.package_price !== undefined ? Number(data.packagePrice) : 0),
      packageQuantity: data.packageQuantity !== undefined ? Number(data.packageQuantity) : (data.package_quantity !== undefined ? Number(data.packageQuantity) : 1000),
      package_quantity: data.packageQuantity !== undefined ? Number(data.packageQuantity) : (data.package_quantity !== undefined ? Number(data.packageQuantity) : 1000),
      iconUrl: data.iconUrl || data.icon_url || null,
      icon_url: data.iconUrl || data.icon_url || null,
    }));
  };

  // 1. Primary path: Fetch from API Gateway
  try {
    const res = await axios.get(formatApiUrl(`/api/courses?force=${forceRefresh}&t=${now}`), { timeout: 4000 });
    if (Array.isArray(res.data) && res.data.length > 0) {
      cachedCourses = sortServicesList(mapServiceList(res.data));
      lastCoursesFetch = now;
      try {
        localStorage.setItem("cached_courses_time", now.toString());
        localStorage.setItem("cached_courses", JSON.stringify(cachedCourses));
      } catch(e) {}
      return cachedCourses;
    }
  } catch (apiErr) {
    console.warn("[CACHE] API /api/courses call failed:", apiErr);
  }

  // 2. Direct Firestore SDK fallback
  try {
    const { collection, getDocs } = await import("firebase/firestore");
    const { db } = await import("@/lib/firebase");
    const snap = await getDocs(collection(db, "courses"));
    if (snap && !snap.empty) {
      const fsServices = snap.docs.map((d: any) => ({ id: d.id, ...d.data() }));
      if (Array.isArray(fsServices) && fsServices.length > 0) {
        cachedCourses = sortServicesList(mapServiceList(fsServices));
        lastCoursesFetch = now;
        try {
          localStorage.setItem("cached_courses_time", now.toString());
          localStorage.setItem("cached_courses", JSON.stringify(cachedCourses));
        } catch(e) {}
        return cachedCourses;
      }
    }
  } catch (fsErr) {}

  // 3. Fallback to existing localStorage safety net (NEVER RETURN EMPTY IF LOCALSTORAGE HAS DATA)
  try {
    const lsData = localStorage.getItem("cached_courses");
    if (lsData) {
      const parsed = JSON.parse(lsData);
      if (Array.isArray(parsed) && parsed.length > 0) {
        cachedCourses = sortServicesList(parsed);
        return cachedCourses;
      }
    }
  } catch(e) {}

  return cachedCourses || [];
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
  }

  // 1. Primary path: Fetch from SQLite backend API proxy
  try {
    const url = formatApiUrl(forceRefresh ? `/api/settings?fresh=1&t=${now}` : `/api/settings?t=${now}`);
    const res = await axios.get(url);
    if (res.data && typeof res.data === "object" && Object.keys(res.data).length > 0) {
      const settingsData = {
        ...DEFAULT_SETTINGS,
        ...res.data,
        upiId: (res.data.upiId && String(res.data.upiId).trim()) ? String(res.data.upiId).trim() : DEFAULT_SETTINGS.upiId,
        paymentQrUrl: res.data.paymentQrUrl || "",
        merchantName: res.data.merchantName !== undefined ? res.data.merchantName : DEFAULT_SETTINGS.merchantName,
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
        instantQrEnabled: res.data.instantQrEnabled !== undefined ? !!res.data.instantQrEnabled : true,
        manualQrEnabled: res.data.manualQrEnabled !== undefined ? !!res.data.manualQrEnabled : true,
        selectedTheme: (res.data.selectedTheme === "charcoal" || !res.data.selectedTheme) ? "amber" : res.data.selectedTheme,
        selectedFestivalTheme: res.data.selectedFestivalTheme || "none",
      };

      cachedSettings = settingsData;
      lastSettingsFetch = now;
      try {
        localStorage.setItem("cached_settings_time", now.toString());
        localStorage.setItem("cached_settings", JSON.stringify(cachedSettings));
        if (settingsData.selectedTheme) {
          localStorage.setItem("cached_theme", settingsData.selectedTheme);
          document.documentElement.setAttribute("data-theme", settingsData.selectedTheme);
        }
      } catch(e) {}
      return cachedSettings;
    }
  } catch (apiErr) {
    console.warn("[CACHE] API /api/settings call failed:", apiErr);
  }

  // 2. Direct Firestore fallback (ensures theme and settings persist even during serverless cold starts)
  try {
    const { doc, getDoc } = await import("firebase/firestore");
    const { db } = await import("@/lib/firebase");
    const snap = await getDoc(doc(db, "settings", "payment"));
    if (snap.exists()) {
      const fsData = snap.data();
      if (fsData && typeof fsData === "object") {
        const settingsData = {
          ...DEFAULT_SETTINGS,
          ...fsData,
          upiId: (fsData.upiId && String(fsData.upiId).trim()) ? String(fsData.upiId).trim() : DEFAULT_SETTINGS.upiId,
          merchantName: fsData.merchantName !== undefined ? fsData.merchantName : DEFAULT_SETTINGS.merchantName,
          selectedTheme: (fsData.selectedTheme === "charcoal" || !fsData.selectedTheme) ? "amber" : fsData.selectedTheme,
          selectedFestivalTheme: fsData.selectedFestivalTheme || "none",
        };
        cachedSettings = settingsData;
        lastSettingsFetch = now;
        try {
          localStorage.setItem("cached_settings_time", now.toString());
          localStorage.setItem("cached_settings", JSON.stringify(cachedSettings));
          if (settingsData.selectedTheme) {
            localStorage.setItem("cached_theme", settingsData.selectedTheme);
            document.documentElement.setAttribute("data-theme", settingsData.selectedTheme);
          }
        } catch(e) {}
        return cachedSettings;
      }
    }
  } catch (fsErr) {}

  // Use localStorage cache if API proxy failed temporarily
  try {
    const lsData = localStorage.getItem("cached_settings");
    if (lsData) {
      const parsed = JSON.parse(lsData);
      if (parsed && typeof parsed === "object") {
        cachedSettings = parsed;
        if (parsed.selectedTheme) {
          localStorage.setItem("cached_theme", parsed.selectedTheme);
          document.documentElement.setAttribute("data-theme", parsed.selectedTheme);
        }
        return cachedSettings;
      }
    }
  } catch(e) {}

  const existingTheme = typeof window !== "undefined" ? localStorage.getItem("cached_theme") : null;
  return {
    ...DEFAULT_SETTINGS,
    selectedTheme: (existingTheme === "charcoal" || !existingTheme) ? "amber" : existingTheme
  };
};

let cachedProviders: any = null;
let lastProvidersFetch = 0;

export const getCachedProviders = async (forceRefresh = false) => {
  const now = Date.now();
  
  if (!forceRefresh && cachedProviders && (now - lastProvidersFetch < CACHE_DURATION)) {
    return cachedProviders;
  }

  // Check localStorage first
  let localBackup: any[] = [];
  try {
    const lsData = localStorage.getItem("cached_providers");
    if (lsData) {
      const parsed = JSON.parse(lsData);
      if (Array.isArray(parsed) && parsed.length > 0) {
        localBackup = parsed;
        if (!forceRefresh) {
          cachedProviders = parsed;
          lastProvidersFetch = now;
          return cachedProviders;
        }
      }
    }
  } catch(e) {}

  // 1. Primary path: Fetch from API Gateway
  try {
    const res = await axios.get(formatApiUrl(`/api/providers?force=${forceRefresh}&t=${now}`), { timeout: 5000 });
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

  // 2. Direct Firestore SDK fallback
  try {
    const { collection, getDocs } = await import("firebase/firestore");
    const { db } = await import("@/lib/firebase");
    const snap = await getDocs(collection(db, "providers"));
    if (snap && !snap.empty) {
      const fsProviders = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      if (Array.isArray(fsProviders) && fsProviders.length > 0) {
        cachedProviders = fsProviders;
        lastProvidersFetch = now;
        try {
          localStorage.setItem("cached_providers_time", now.toString());
          localStorage.setItem("cached_providers", JSON.stringify(cachedProviders));
        } catch(e) {}
        return cachedProviders;
      }
    }
  } catch (fsErr) {}

  // 3. Fallback to local backup (NEVER RETURN EMPTY IF LOCAL STORAGE HAD DATA)
  if (localBackup.length > 0) {
    cachedProviders = localBackup;
    return cachedProviders;
  }
  
  return cachedProviders || [];
};

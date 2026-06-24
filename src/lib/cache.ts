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
          parsed.sort((a: any, b: any) => {
            const orderA = categoryOrder.indexOf(a.category) === -1 ? 99 : categoryOrder.indexOf(a.category);
            const orderB = categoryOrder.indexOf(b.category) === -1 ? 99 : categoryOrder.indexOf(b.category);
            if (orderA !== orderB) return orderA - orderB;
            
            // Secondary sort by updatedAt preferred, fallback to createdAt (latest first)
            const timeA = a.updatedAt?.seconds || a.createdAt?.seconds || 0;
            const timeB = b.updatedAt?.seconds || b.createdAt?.seconds || 0;
            return timeB - timeA;
          });
          cachedCourses = parsed;
          lastCoursesFetch = parseInt(lsTime);
          return cachedCourses;
        }
      }
    } catch(e) {}
  }
  
  try {
    // Fetch directly from Firestore Client SDK to bypass backend IAM permissions issues
    const querySnapshot = await getDocs(collection(db, "courses"));
    const fetchedCourses = querySnapshot.docs.map(gdoc => {
      const data = gdoc.data();
      return {
        id: gdoc.id,
        ...data,
        // Guarantee uniform field resolution for both server-side patterns & client expectations
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
    activeServices.sort((a: any, b: any) => {
      const orderA = categoryOrder.indexOf(a.category) === -1 ? 99 : categoryOrder.indexOf(a.category);
      const orderB = categoryOrder.indexOf(b.category) === -1 ? 99 : categoryOrder.indexOf(b.category);
      if (orderA !== orderB) return orderA - orderB;
      
      const timeA = new Date(a.updatedAt || a.createdAt || 0).getTime();
      const timeB = new Date(b.updatedAt || b.createdAt || 0).getTime();
      return timeB - timeA;
    });

    cachedCourses = activeServices;
    lastCoursesFetch = now;
    try {
      localStorage.setItem("cached_courses_time", now.toString());
      localStorage.setItem("cached_courses", JSON.stringify(cachedCourses));
    } catch(e) {}
  } catch (err) {
    console.error("Failed to fetch courses directly via client Firestore, trying backend fallback", err);
    try {
      const res = await axios.get("/api/courses");
      cachedCourses = res.data;
      lastCoursesFetch = now;
      try {
        localStorage.setItem("cached_courses_time", now.toString());
        localStorage.setItem("cached_courses", JSON.stringify(cachedCourses));
      } catch(e) {}
    } catch (fallbackErr) {
      console.error("Failed to fetch courses via API proxy fallback", fallbackErr);
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
  
  try {
    // Fetch directly from client Firestore Web SDK
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
    };

    cachedSettings = settingsData;
    lastSettingsFetch = now;
    try {
      localStorage.setItem("cached_settings_time", now.toString());
      localStorage.setItem("cached_settings", JSON.stringify(cachedSettings));
    } catch(e) {}
  } catch (err) {
    console.error("Failed to fetch settings directly, attempting backend fallback", err);
    try {
      const res = await axios.get("/api/settings");
      cachedSettings = res.data;
      lastSettingsFetch = now;
      try {
        localStorage.setItem("cached_settings_time", now.toString());
        localStorage.setItem("cached_settings", JSON.stringify(cachedSettings));
      } catch(e) {}
    } catch (fallbackErr) {
      console.error("Failed to fetch settings via API proxy fallback", fallbackErr);
      if (!cachedSettings) cachedSettings = {};
    }
  }
  return cachedSettings || {};
};

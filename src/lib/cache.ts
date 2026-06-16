import { collection, query, where, getDocs, doc, getDoc, limit } from "firebase/firestore";
import { db } from "./firebase";
import axios from "axios";

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
            
            // Secondary sort by createdAt (latest first)
            const timeA = a.createdAt?.seconds || 0;
            const timeB = b.createdAt?.seconds || 0;
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
    const res = await axios.get("/api/courses");
    cachedCourses = res.data;
    lastCoursesFetch = now;
    try {
      localStorage.setItem("cached_courses_time", now.toString());
      localStorage.setItem("cached_courses", JSON.stringify(cachedCourses));
    } catch(e) {}
  } catch (err) {
    console.error("Failed to fetch courses via API proxy", err);
    if (!cachedCourses) cachedCourses = [];
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
    const res = await axios.get("/api/settings");
    cachedSettings = res.data;
    lastSettingsFetch = now;
    try {
      localStorage.setItem("cached_settings_time", now.toString());
      localStorage.setItem("cached_settings", JSON.stringify(cachedSettings));
    } catch(e) {}
  } catch (err) {
    console.error("Failed to fetch settings via API proxy", err);
    if (!cachedSettings) cachedSettings = {};
  }
  return cachedSettings || {};
};

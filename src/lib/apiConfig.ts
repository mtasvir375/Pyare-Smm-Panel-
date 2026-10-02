import axios from "axios";

export const STABLE_CLOUD_RUN_BACKEND = "https://ais-pre-n2umeaxvo6qnc7chsbm27z-523409699457.asia-southeast1.run.app";

export const getApiBaseUrl = (): string => {
  if (typeof window === "undefined") {
    return STABLE_CLOUD_RUN_BACKEND;
  }
  
  // Check if custom backend URL is saved in localStorage
  try {
    const customBackend = localStorage.getItem("custom_backend_api_url");
    if (customBackend && customBackend.trim().startsWith("http")) {
      return customBackend.trim().replace(/\/+$/, "");
    }
  } catch (e) {}

  const hostname = window.location.hostname;
  
  // If running on local machine, use relative paths
  if (hostname === "localhost" || hostname === "127.0.0.1") {
    return "";
  }
  
  // If already running directly on Cloud Run host, use relative paths
  if (hostname.includes("run.app") || hostname.includes("ais-dev") || hostname.includes("ais-pre")) {
    return "";
  }
  
  // If accessed from custom domain (e.g., pyaresmmpanel.online, vercel.app, etc.),
  // always forward all API/Database calls to the live Cloud Run backend!
  return STABLE_CLOUD_RUN_BACKEND;
};

export const formatApiUrl = (endpoint: string): string => {
  if (endpoint.startsWith("http://") || endpoint.startsWith("https://")) {
    return endpoint;
  }
  const cleanEndpoint = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
  const baseUrl = getApiBaseUrl();
  if (baseUrl) {
    return `${baseUrl}${cleanEndpoint}`;
  }
  return cleanEndpoint;
};

// Configure global Axios base URL
if (typeof window !== "undefined") {
  const initialBase = getApiBaseUrl();
  axios.defaults.baseURL = initialBase;
}

import axios from "axios";

export const STABLE_CLOUD_RUN_BACKEND = "https://ais-dev-n2umeaxvo6qnc7chsbm27z-523409699457.asia-southeast1.run.app";

export const getApiBaseUrl = (): string => {
  if (typeof window === "undefined") {
    return "";
  }
  
  // Check if custom backend URL is saved in localStorage
  try {
    const customBackend = localStorage.getItem("custom_backend_api_url");
    if (customBackend && customBackend.trim().startsWith("http")) {
      return customBackend.trim().replace(/\/+$/, "");
    }
  } catch (e) {}

  const hostname = window.location.hostname;
  // If running on a custom domain (like pyaresmmpanel.online), static hosting only serves
  // frontend HTML/JS. We MUST route all API requests directly to the live Cloud Run backend!
  if (hostname !== "localhost" && hostname !== "127.0.0.1" && !hostname.includes("run.app") && !hostname.includes("webcontainer.io") && !hostname.includes("aistudio")) {
    return STABLE_CLOUD_RUN_BACKEND;
  }

  // Same-origin relative paths for preview/localhost
  return "";
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
  axios.defaults.baseURL = initialBase || undefined;
}

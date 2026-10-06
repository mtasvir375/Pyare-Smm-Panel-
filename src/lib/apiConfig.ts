import axios from "axios";

export const STABLE_CLOUD_RUN_BACKEND = "https://ais-pre-n2umeaxvo6qnc7chsbm27z-523409699457.asia-southeast1.run.app";

/**
 * Returns the base API URL.
 * Defaults to empty string ("") so that relative paths (e.g. /api/proxy-provider)
 * always execute on the same origin where the app is deployed (Custom domain/Vercel, Localhost, or AI Studio).
 */
export const getApiBaseUrl = (): string => {
  if (typeof window === "undefined") {
    return "";
  }
  
  // 1. Check if custom backend URL is explicitly saved in localStorage by Admin
  try {
    const customBackend = localStorage.getItem("custom_backend_api_url");
    if (customBackend && customBackend.trim().startsWith("http")) {
      return customBackend.trim().replace(/\/+$/, "");
    }
  } catch (e) {}

  // 2. Default to same-origin relative URLs (/api/...)
  // This allows Vercel serverless functions (/api/proxy-provider.ts) and Express (server.ts) to work natively same-origin
  return "";
};

export const formatApiUrl = (endpoint: string): string => {
  if (!endpoint) return "";
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

// Safe Axios and Fetch configuration
if (typeof window !== "undefined") {
  // Only intercept if an explicit custom backend URL is configured
  axios.interceptors.request.use((config) => {
    const base = getApiBaseUrl();
    if (base && config.url && !config.url.startsWith("http")) {
      const clean = config.url.startsWith("/") ? config.url : `/${config.url}`;
      config.url = `${base}${clean}`;
    }
    return config;
  }, (error) => {
    return Promise.reject(error);
  });
}

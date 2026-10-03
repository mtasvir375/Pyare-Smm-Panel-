import axios from "axios";

export const STABLE_CLOUD_RUN_BACKEND = "https://ais-dev-n2umeaxvo6qnc7chsbm27z-523409699457.asia-southeast1.run.app";

export const getApiBaseUrl = (): string => {
  if (typeof window === "undefined") {
    return "";
  }
  
  // Check if custom backend URL is explicitly saved in localStorage
  try {
    const customBackend = localStorage.getItem("custom_backend_api_url");
    if (customBackend && customBackend.trim().startsWith("http")) {
      return customBackend.trim().replace(/\/+$/, "");
    }
  } catch (e) {}

  // Use same-origin relative paths for all domains (localhost, run.app, custom domains like pyaresmmpanel.online)
  // This ensures 100% native same-origin routing with zero CORS or Network Errors!
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

// Configure global Axios base URL and Interceptor
if (typeof window !== "undefined") {
  // Intercept all Axios requests to ensure relative /api endpoints point to the live backend on custom domain
  axios.interceptors.request.use((config) => {
    const base = getApiBaseUrl();
    if (base && config.url && config.url.startsWith("/api/")) {
      config.url = `${base}${config.url}`;
    }
    return config;
  }, (error) => {
    return Promise.reject(error);
  });
}

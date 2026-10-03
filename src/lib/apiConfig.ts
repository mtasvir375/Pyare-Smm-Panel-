import axios from "axios";

export const STABLE_CLOUD_RUN_BACKEND = "https://ais-pre-n2umeaxvo6qnc7chsbm27z-523409699457.asia-southeast1.run.app";

export const getApiBaseUrl = (): string => {
  if (typeof window === "undefined") {
    return "";
  }
  
  // 1. Check if custom backend URL is explicitly saved in localStorage
  try {
    const customBackend = localStorage.getItem("custom_backend_api_url");
    if (customBackend && customBackend.trim().startsWith("http")) {
      return customBackend.trim().replace(/\/+$/, "");
    }
  } catch (e) {}

  const host = (window.location.hostname || "").toLowerCase();

  // 2. If running directly on Cloud Run or in local development, use relative paths ("")
  if (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host.endsWith(".run.app") ||
    host.includes("localhost")
  ) {
    return "";
  }

  // 3. For custom domains (e.g. pyaresmmpanel.online, smmpanel.online, etc.),
  // the static host (Firebase Hosting / CDN) does NOT execute Express /api routes directly.
  // We MUST route all API requests to the live Cloud Run backend to avoid "A server error has occurred" static rewrite failures.
  return STABLE_CLOUD_RUN_BACKEND;
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

// Configure global Axios base URL and Interceptor
if (typeof window !== "undefined") {
  // Intercept all Axios requests to ensure relative /api endpoints point to the live backend on custom domains
  axios.interceptors.request.use((config) => {
    const base = getApiBaseUrl();
    if (base && config.url) {
      if (config.url.startsWith("/api/")) {
        config.url = `${base}${config.url}`;
      } else if (config.url.startsWith("api/")) {
        config.url = `${base}/${config.url}`;
      }
    }
    return config;
  }, (error) => {
    return Promise.reject(error);
  });
}

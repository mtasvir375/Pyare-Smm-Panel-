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
  // This allows Vercel serverless functions (/api/test-provider, /api/proxy-provider, /api/index) and Express (server.ts) to work natively same-origin
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
  // 1. Request Interceptor: Only rewrite if an explicit custom backend URL is configured
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

  // 2. Response Interceptor: Automatic failover for custom domains
  // If an API call fails with 5xx or Network Error on a custom domain, seamlessly retry with Cloud Run backend
  axios.interceptors.response.use(
    (response) => response,
    async (error) => {
      const originalRequest = error.config;
      if (
        originalRequest &&
        !originalRequest._retryWithCloudRun &&
        (error.response?.status >= 500 || error.code === "ERR_NETWORK" || !error.response) &&
        typeof window !== "undefined" &&
        window.location.hostname !== "localhost" &&
        !window.location.hostname.includes("run.app")
      ) {
        originalRequest._retryWithCloudRun = true;
        const currentUrl = originalRequest.url || "";
        let newUrl = currentUrl;
        if (!newUrl.startsWith("http")) {
          const clean = newUrl.startsWith("/") ? newUrl : `/${newUrl}`;
          newUrl = `${STABLE_CLOUD_RUN_BACKEND}${clean}`;
        } else if (newUrl.includes(window.location.hostname)) {
          newUrl = newUrl.replace(/https?:\/\/[^\/]+/, STABLE_CLOUD_RUN_BACKEND);
        }
        originalRequest.url = newUrl;
        console.warn(`[API-FAILOVER] Retrying ${currentUrl} via Cloud Run backend: ${newUrl}`);
        return axios(originalRequest);
      }
      return Promise.reject(error);
    }
  );
}

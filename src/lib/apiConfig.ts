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

  // 2. If running on default Google Studio host or local development, use same origin
  const hostname = window.location.hostname || "";
  const isDefaultHost = 
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname.endsWith(".run.app") ||
    hostname.includes("ais-dev-") ||
    hostname.includes("ais-pre-");

  if (isDefaultHost) {
    return "";
  }

  // 3. On custom domain (e.g. pyaresmmpanel.in, vercel, mobile app):
  // Automatically connect to the live Cloud Run backend for provider orders, bank webhooks, & Turso sync
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

  // Intercept window.fetch as well for any native fetch calls
  const originalFetch = window.fetch;
  window.fetch = async function (input: RequestInfo | URL, init?: RequestInit) {
    if (typeof input === "string") {
      input = formatApiUrl(input);
    } else if (input instanceof URL) {
      input = new URL(formatApiUrl(input.pathname + input.search), input.origin);
    } else if (input instanceof Request) {
      const formattedUrl = formatApiUrl(input.url);
      if (formattedUrl !== input.url) {
        input = new Request(formattedUrl, input);
      }
    }
    return originalFetch.call(this, input, init);
  };
}

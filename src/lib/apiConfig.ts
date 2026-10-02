import axios from "axios";

export const STABLE_CLOUD_RUN_BACKEND = "";

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

  // Always use same-origin relative paths ("") so all API requests
  // on custom domain (pyaresmmpanel.online), localhost, and preview
  // go directly to their own live API gateway without cross-origin or redirect blocks.
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

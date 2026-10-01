import axios from "axios";

export const getApiBaseUrl = (): string => {
  if (typeof window !== "undefined") {
    try {
      const saved = localStorage.getItem("backend_api_url") || localStorage.getItem("cached_settings");
      if (saved) {
        const parsed = typeof saved === "string" && saved.startsWith("{") ? JSON.parse(saved) : null;
        const url = parsed?.backendApiUrl || (typeof saved === "string" && saved.startsWith("http") ? saved : null);
        if (url && url.startsWith("http")) return url.replace(/\/$/, "");
      }
    } catch (e) {}

    const hostname = window.location.hostname;
    // If accessed via custom domain (pyaresmmpanel.online, www.pyaresmmpanel.online, etc.)
    if (
      hostname !== "localhost" &&
      hostname !== "127.0.0.1" &&
      !hostname.includes("run.app") &&
      !hostname.includes("ais-dev") &&
      !hostname.includes("ais-pre")
    ) {
      return "https://ais-pre-n2umeaxvo6qnc7chsbm27z-523409699457.asia-southeast1.run.app";
    }
  }
  return "";
};

export const formatApiUrl = (endpoint: string): string => {
  const base = getApiBaseUrl();
  const cleanEndpoint = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
  return base ? `${base}${cleanEndpoint}` : cleanEndpoint;
};

// Configure global Axios base URL
const baseUrl = getApiBaseUrl();
if (baseUrl) {
  axios.defaults.baseURL = baseUrl;
}

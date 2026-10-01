import axios from "axios";

export const getApiBaseUrl = (): string => {
  return "";
};

export const formatApiUrl = (endpoint: string): string => {
  return endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
};

// Configure global Axios base URL
axios.defaults.baseURL = "";

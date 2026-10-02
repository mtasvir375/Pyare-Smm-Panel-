export interface ServiceItem {
  id: string;
  title: string;
  category: string;
  pricePerThousand: number;
  price: number;
  minLimit: number;
  min_limit: number;
  maxLimit: number;
  max_limit: number;
  description: string;
  status: string;
  providerId?: string;
  providerServiceId?: string;
  provider_service_id?: string;
  isPackage?: boolean;
  is_package?: boolean;
  packagePrice?: number;
  package_price?: number;
  packageQuantity?: number;
  package_quantity?: number;
  iconUrl?: string | null;
  icon_url?: string | null;
}

export const DEFAULT_SERVICES: ServiceItem[] = [];

export const DEFAULT_SETTINGS = {
  upiId: "mdsaudalam621@okicici",
  merchantName: "Pyare SMM Panel",
  paymentQrUrl: "",
  qrAutoEnabled: false,
  instantQrEnabled: true,
  manualQrEnabled: true,
  selectedTheme: "charcoal",
  selectedFestivalTheme: "none",
  whatsappLink: "https://wa.me/919999999999",
  whatsappChatNumber: "+919999999999",
  razorpayEnabled: false,
  phonepeEnabled: false,
  paytmEnabled: false
};

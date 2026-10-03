export interface ServiceItem {
  id: string;
  title: string;
  category: string;
  pricePerThousand: number;
  price: number;
  minLimit: number;
  min_limit?: number;
  maxLimit?: number;
  max_limit?: number;
  description?: string;
  status: string;
  providerId?: string;
  providerServiceId?: string;
  provider_service_id?: string;
  isPackage?: boolean;
  is_package?: boolean;
  packagePrice?: number | null;
  package_price?: number | null;
  packageQuantity?: number | null;
  package_quantity?: number | null;
  iconUrl?: string | null;
  icon_url?: string | null;
  isCombo?: boolean;
  comboItems?: any[];
  serviceType?: string;
  preventDuplicateLink?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export const DEFAULT_SERVICES: ServiceItem[] = [];

export const DEFAULT_SETTINGS = {
  upiId: "",
  merchantName: "SMM Panel",
  whatsappLink: "",
  whatsappChatNumber: "",
  paymentQrUrl: "",
  manualQrEnabled: true,
  instantQrEnabled: true,
  qrAutoEnabled: false,
  selectedTheme: "amber",
  selectedFestivalTheme: "none"
};

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

export const DEFAULT_SERVICES: ServiceItem[] = [
  // Instagram Services
  {
    id: "srv_ig_followers_nondrop",
    title: "Instagram Followers [Non-Drop] [Lifetime Guarantee] [Super Fast]",
    category: "Instagram",
    pricePerThousand: 65,
    price: 65,
    minLimit: 100,
    min_limit: 100,
    maxLimit: 100000,
    max_limit: 100000,
    description: "High Quality Instagram Non-Drop Followers with lifetime refill guarantee. Instant start.",
    status: "active",
    providerServiceId: "101",
    provider_service_id: "101",
    isPackage: false,
    is_package: false,
  },
  {
    id: "srv_ig_likes_hq",
    title: "Instagram Real Likes [HQ] [Fast Start] [Non-Drop]",
    category: "Instagram",
    pricePerThousand: 18,
    price: 18,
    minLimit: 50,
    min_limit: 50,
    maxLimit: 50000,
    max_limit: 50000,
    description: "Instant delivery Instagram Likes from active looking profiles. 100% safe.",
    status: "active",
    providerServiceId: "102",
    provider_service_id: "102",
    isPackage: false,
    is_package: false,
  },
  {
    id: "srv_ig_reels_views",
    title: "Instagram Reels Views [Explore Viral Boost] [Instant 1M/Day]",
    category: "Instagram",
    pricePerThousand: 5,
    price: 5,
    minLimit: 500,
    min_limit: 500,
    maxLimit: 1000000,
    max_limit: 1000000,
    description: "Instant high-speed Instagram Reels views to push your reel into Instagram Explore algorithm.",
    status: "active",
    providerServiceId: "103",
    provider_service_id: "103",
    isPackage: false,
    is_package: false,
  },
  {
    id: "srv_ig_story_views",
    title: "Instagram Story Views + Impressions [All Stories]",
    category: "Instagram",
    pricePerThousand: 12,
    price: 12,
    minLimit: 100,
    min_limit: 100,
    maxLimit: 50000,
    max_limit: 50000,
    description: "Delivers views to all active stories within 5 minutes.",
    status: "active",
    providerServiceId: "104",
    provider_service_id: "104",
    isPackage: false,
    is_package: false,
  },

  // YouTube Services
  {
    id: "srv_yt_views_retention",
    title: "YouTube Video Views [High Retention] [Monetizable & Safe]",
    category: "YouTube",
    pricePerThousand: 120,
    price: 120,
    minLimit: 500,
    min_limit: 500,
    maxLimit: 500000,
    max_limit: 500000,
    description: "Non-drop High Retention YouTube Views from real external search traffic. 100% Adsense safe.",
    status: "active",
    providerServiceId: "201",
    provider_service_id: "201",
    isPackage: false,
    is_package: false,
  },
  {
    id: "srv_yt_subscribers",
    title: "YouTube Real Subscribers [Non-Drop] [30 Days Refill]",
    category: "YouTube",
    pricePerThousand: 490,
    price: 490,
    minLimit: 50,
    min_limit: 50,
    maxLimit: 10000,
    max_limit: 10000,
    description: "Authentic YouTube subscribers to help you cross monetization thresholds safely.",
    status: "active",
    providerServiceId: "202",
    provider_service_id: "202",
    isPackage: false,
    is_package: false,
  },
  {
    id: "srv_yt_likes",
    title: "YouTube Video Likes [Instant Start] [Organic Profiles]",
    category: "YouTube",
    pricePerThousand: 45,
    price: 45,
    minLimit: 50,
    min_limit: 50,
    maxLimit: 20000,
    max_limit: 20000,
    description: "Fast start YouTube likes to build video social proof.",
    status: "active",
    providerServiceId: "203",
    provider_service_id: "203",
    isPackage: false,
    is_package: false,
  },

  // Facebook Services
  {
    id: "srv_fb_followers",
    title: "Facebook Page Followers / Likes [Global Real Profiles]",
    category: "Facebook",
    pricePerThousand: 95,
    price: 95,
    minLimit: 100,
    min_limit: 100,
    maxLimit: 50000,
    max_limit: 50000,
    description: "Organic looking Facebook page followers and likes to boost page credibility.",
    status: "active",
    providerServiceId: "301",
    provider_service_id: "301",
    isPackage: false,
    is_package: false,
  },
  {
    id: "srv_fb_post_likes",
    title: "Facebook Post Likes / Reactions [Super Fast]",
    category: "Facebook",
    pricePerThousand: 35,
    price: 35,
    minLimit: 50,
    min_limit: 50,
    maxLimit: 25000,
    max_limit: 25000,
    description: "Instant post likes and thumbs-up reactions for Facebook public posts.",
    status: "active",
    providerServiceId: "302",
    provider_service_id: "302",
    isPackage: false,
    is_package: false,
  },

  // Telegram Services
  {
    id: "srv_tg_members",
    title: "Telegram Channel / Group Members [Non-Drop] [0% Drop]",
    category: "Telegram",
    pricePerThousand: 75,
    price: 75,
    minLimit: 100,
    min_limit: 100,
    maxLimit: 100000,
    max_limit: 100000,
    description: "High quality Telegram members with low/zero drop rate. Instant delivery.",
    status: "active",
    providerServiceId: "401",
    provider_service_id: "401",
    isPackage: false,
    is_package: false,
  },
  {
    id: "srv_tg_post_views",
    title: "Telegram Post Views [Last 5 Posts Automatic]",
    category: "Telegram",
    pricePerThousand: 8,
    price: 8,
    minLimit: 100,
    min_limit: 100,
    maxLimit: 500000,
    max_limit: 500000,
    description: "Instant post view delivery to your Telegram channel posts.",
    status: "active",
    providerServiceId: "402",
    provider_service_id: "402",
    isPackage: false,
    is_package: false,
  },

  // TikTok Services
  {
    id: "srv_tt_followers",
    title: "TikTok Followers [Global HQ] [Instant Delivery]",
    category: "TikTok",
    pricePerThousand: 85,
    price: 85,
    minLimit: 100,
    min_limit: 100,
    maxLimit: 20000,
    max_limit: 20000,
    description: "Premium TikTok followers to boost your profile presence.",
    status: "active",
    providerServiceId: "501",
    provider_service_id: "501",
    isPackage: false,
    is_package: false,
  },
  {
    id: "srv_tt_likes",
    title: "TikTok Video Likes [Fast] [High Retention]",
    category: "TikTok",
    pricePerThousand: 25,
    price: 25,
    minLimit: 100,
    min_limit: 100,
    maxLimit: 50000,
    max_limit: 50000,
    description: "High speed TikTok likes on any public video URL.",
    status: "active",
    providerServiceId: "502",
    provider_service_id: "502",
    isPackage: false,
    is_package: false,
  }
];

export const DEFAULT_SETTINGS = {
  upiId: "paytmqr281005050101111956557626@paytm",
  merchantName: "Pyare SMM Panel",
  paymentQrUrl: "",
  qrAutoEnabled: false,
  selectedTheme: "charcoal",
  selectedFestivalTheme: "none",
  whatsappLink: "https://wa.me/919999999999",
  whatsappChatNumber: "+919999999999",
  razorpayEnabled: false,
  phonepeEnabled: false,
  paytmEnabled: false
};

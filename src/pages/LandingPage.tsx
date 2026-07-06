import { useEffect, useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { landingPages, generateLandingPageSEOContent } from "@/data/landingPages";
import { 
  CheckCircle, 
  ShieldCheck, 
  Zap, 
  HelpCircle, 
  ArrowRight, 
  MessageSquare, 
  TrendingUp, 
  Users, 
  Heart, 
  Play,
  CreditCard
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export default function LandingPage() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const [pageConfig, setPageConfig] = useState<any>(null);
  
  // Find landing page config based on slug
  useEffect(() => {
    const found = landingPages.find(p => p.slug === slug);
    if (found) {
      setPageConfig(generateLandingPageSEOContent(found));
    } else {
      // Fallback to first page if not found
      setPageConfig(generateLandingPageSEOContent(landingPages[0]));
    }
  }, [slug]);

  // Update document head for SEO bots dynamically without extra library dependencies
  useEffect(() => {
    if (!pageConfig) return;

    // Update Title
    document.title = pageConfig.title;

    // Update Meta Description
    let metaDesc = document.querySelector('meta[name="description"]');
    if (!metaDesc) {
      metaDesc = document.createElement('meta');
      metaDesc.setAttribute('name', 'description');
      document.head.appendChild(metaDesc);
    }
    metaDesc.setAttribute('content', pageConfig.metaDesc);

    // Update Meta Keywords
    let metaKeywords = document.querySelector('meta[name="keywords"]');
    if (!metaKeywords) {
      metaKeywords = document.createElement('meta');
      metaKeywords.setAttribute('name', 'keywords');
      document.head.appendChild(metaKeywords);
    }
    metaKeywords.setAttribute('content', pageConfig.keywords.join(', '));

    // Scroll to top of the page
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [pageConfig]);

  if (!pageConfig) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-4">
        <div className="animate-pulse space-y-4">
          <div className="h-8 w-64 bg-gray-200 rounded mx-auto" />
          <div className="h-4 w-48 bg-gray-200 rounded mx-auto" />
        </div>
      </div>
    );
  }

  // Interactive Pricing Simulator (Strictly Client-side, no DB reads/writes!)
  const [simQuantity, setSimQuantity] = useState(1000);
  const getEstimatedPrice = () => {
    const baseRatePerThousand = pageConfig.category === "Instagram" ? 18 
                             : pageConfig.category === "YouTube" ? 95 
                             : pageConfig.category === "Telegram" ? 35 
                             : 25;
    return ((simQuantity / 1000) * baseRatePerThousand).toFixed(2);
  };

  return (
    <div id="seo-landing-root" className="bg-white min-h-screen text-gray-800 selection:bg-primary/20">
      
      {/* 1. HERO SECTION (Designed for High SEO Weight + Modern Visuals) */}
      <section className="relative overflow-hidden bg-gradient-to-br from-slate-950 via-slate-900 to-primary/20 text-white pt-16 pb-20 px-4 rounded-3xl mb-12 shadow-xl border border-slate-800">
        <div className="absolute top-0 right-0 w-96 h-96 bg-primary/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute bottom-0 left-0 w-80 h-80 bg-blue-500/10 rounded-full blur-3xl pointer-events-none" />

        <div className="max-w-4xl mx-auto text-center relative z-10 space-y-6">
          <div className="inline-flex items-center gap-2 bg-white/10 backdrop-blur-md px-4 py-1.5 rounded-full text-xs font-semibold text-primary border border-white/10 tracking-wide">
            <Zap className="w-3.5 h-3.5 fill-primary" /> Verified Original SMM Services Node
          </div>
          
          <h1 className="text-3xl sm:text-5xl font-black tracking-tight text-white leading-tight">
            {pageConfig.h1}
          </h1>

          <p className="text-sm sm:text-lg text-slate-300 font-medium max-w-2xl mx-auto leading-relaxed">
            {pageConfig.introText}
          </p>

          <div className="flex flex-col sm:flex-row gap-4 justify-center items-center pt-4">
            <Link to="/courses" className="w-full sm:w-auto">
              <Button size="lg" className="w-full sm:w-auto bg-primary text-white hover:bg-primary/95 text-sm font-bold h-12 px-8 rounded-full shadow-lg shadow-primary/20 gap-2">
                Place Order Now <ArrowRight className="w-4 h-4" />
              </Button>
            </Link>
            <Link to="/login" className="w-full sm:w-auto">
              <Button size="lg" variant="outline" className="w-full sm:w-auto bg-white/5 border-white/20 text-white hover:bg-white/10 text-sm font-bold h-12 px-8 rounded-full">
                Create Free Account
              </Button>
            </Link>
          </div>

          {/* Quick trust highlights */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-10 border-t border-white/10 text-slate-300 text-xs font-medium">
            <div className="flex items-center justify-center gap-2">
              <CheckCircle className="w-4 h-4 text-emerald-400" /> Start: 0-5 Minutes
            </div>
            <div className="flex items-center justify-center gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-400" /> Refill Guaranteed
            </div>
            <div className="flex items-center justify-center gap-2">
              <CreditCard className="w-4 h-4 text-emerald-400" /> Automated UPI QR
            </div>
            <div className="flex items-center justify-center gap-2">
              <MessageSquare className="w-4 h-4 text-emerald-400" /> WhatsApp Support
            </div>
          </div>
        </div>
      </section>

      {/* 2. CORE MARKETING & RICH KEYWORD DENSE CONTENT (For high-retention bot indexing) */}
      <section className="max-w-4xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-8 mb-16 px-2">
        
        {/* Main Content Body */}
        <div className="md:col-span-2 space-y-8">
          <div className="prose prose-slate max-w-none">
            <h2 className="text-2xl font-bold text-slate-900 mb-4">{pageConfig.section1_title}</h2>
            <p className="text-gray-600 leading-relaxed text-sm sm:text-base">
              {pageConfig.section1_text}
            </p>
          </div>

          <div className="prose prose-slate max-w-none pt-4">
            <h2 className="text-2xl font-bold text-slate-900 mb-4">{pageConfig.section2_title}</h2>
            <p className="text-gray-600 leading-relaxed text-sm sm:text-base">
              {pageConfig.section2_text}
            </p>
          </div>

          {/* Features Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-6">
            {pageConfig.features.map((feat: any, idx: number) => (
              <Card key={idx} className="border border-gray-100 shadow-sm hover:shadow-md transition">
                <CardContent className="p-5 space-y-2">
                  <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
                    {idx === 0 && <TrendingUp className="w-4 h-4" />}
                    {idx === 1 && <CreditCard className="w-4 h-4" />}
                    {idx === 2 && <ShieldCheck className="w-4 h-4" />}
                    {idx === 3 && <MessageSquare className="w-4 h-4" />}
                  </div>
                  <h4 className="font-bold text-sm text-slate-900">{feat.title}</h4>
                  <p className="text-xs text-gray-500 leading-relaxed">{feat.desc}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>

        {/* Sidebar Calculator / Pricing Simulator Widget */}
        <div className="space-y-6">
          <Card className="border border-gray-200 bg-slate-50/50 sticky top-24">
            <CardContent className="p-6 space-y-6">
              <div className="space-y-1">
                <h3 className="font-bold text-slate-900 text-base">Cost Calculator</h3>
                <p className="text-xs text-gray-500">Estimate pricing instantly for this service</p>
              </div>

              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-700 flex justify-between">
                    <span>Select Service Category</span>
                    <span className="text-primary font-extrabold">{pageConfig.category}</span>
                  </label>
                  <div className="text-xs bg-white border border-gray-200 p-2.5 rounded-lg font-semibold text-gray-600">
                    Premium {pageConfig.category} Booster Node
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-700 flex justify-between">
                    <span>Quantity</span>
                    <span className="text-gray-900 font-extrabold">{simQuantity.toLocaleString()}</span>
                  </label>
                  <input 
                    type="range" 
                    min="100" 
                    max="10000" 
                    step="100"
                    value={simQuantity} 
                    onChange={(e) => setSimQuantity(Number(e.target.value))}
                    className="w-full h-1.5 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-primary"
                  />
                  <div className="flex justify-between text-[10px] text-gray-400 font-semibold">
                    <span>100 Min</span>
                    <span>10,000 Max</span>
                  </div>
                </div>

                <div className="pt-4 border-t border-gray-200 flex justify-between items-center">
                  <div>
                    <p className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Estimated Price</p>
                    <p className="text-2xl font-black text-slate-900">₹{getEstimatedPrice()}</p>
                  </div>
                  <Link to="/courses">
                    <Button size="sm" className="bg-primary text-white hover:bg-primary/95 text-xs font-bold px-4 rounded-full">
                      Buy Now
                    </Button>
                  </Link>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Social Proof Stats */}
          <div className="bg-slate-900 text-white p-5 rounded-2xl space-y-4 shadow-md">
            <h4 className="text-xs font-extrabold text-primary tracking-wider uppercase">Live Platform Network</h4>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-lg font-black text-white">4.8M+</p>
                <p className="text-[10px] text-slate-400">Completed Orders</p>
              </div>
              <div>
                <p className="text-lg font-black text-white">0.05s</p>
                <p className="text-[10px] text-slate-400">Avg. API Response</p>
              </div>
              <div>
                <p className="text-lg font-black text-white">99.98%</p>
                <p className="text-[10px] text-slate-400">Server Uptime</p>
              </div>
              <div>
                <p className="text-lg font-black text-white">24/7</p>
                <p className="text-[10px] text-slate-400">Auto Payments</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 3. DYNAMIC FAQS ACCORDION (Provides deep, high-CTR content for Google Answer Box rankings) */}
      <section className="bg-slate-50 rounded-3xl py-12 px-6 max-w-4xl mx-auto mb-16 border border-slate-100">
        <div className="max-w-2xl mx-auto text-center mb-8 space-y-2">
          <HelpCircle className="w-8 h-8 text-primary mx-auto mb-2" />
          <h2 className="text-2xl font-black text-slate-900">Frequently Asked Questions</h2>
          <p className="text-xs sm:text-sm text-gray-500">Everything you need to know about our {pageConfig.mainKeyword} solutions</p>
        </div>

        <div className="space-y-4 max-w-3xl mx-auto">
          {pageConfig.faq.map((faq: any, idx: number) => (
            <div key={idx} className="bg-white p-5 rounded-xl border border-gray-100 shadow-sm space-y-2">
              <h3 className="font-bold text-sm sm:text-base text-slate-900 flex gap-2 items-start">
                <span className="text-primary font-black">Q.</span>
                {faq.q}
              </h3>
              <p className="text-xs sm:text-sm text-gray-500 pl-5 leading-relaxed">
                {faq.a}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* 4. STATIC INTERNAL LINKING GRID FOR ALL 50 PAGES (Ensures massive page-juice flowing to all landing pages for SEO bots) */}
      <section className="max-w-5xl mx-auto px-4 mb-20">
        <div className="border-t border-gray-100 pt-12 text-center mb-8 space-y-2">
          <h2 className="text-xl font-bold text-slate-900">Other SMM Services & Landing Pages</h2>
          <p className="text-xs text-gray-400">Explore our comprehensive, high-speed wholesale networks across all networks</p>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
          {landingPages.map((lp) => (
            <Link 
              key={lp.slug} 
              to={`/p/${lp.slug}`} 
              className={`p-2.5 rounded-lg border text-center transition text-[10px] font-semibold tracking-tight truncate ${
                lp.slug === slug 
                  ? "bg-primary/5 border-primary text-primary" 
                  : "bg-white border-gray-100 hover:border-gray-300 text-gray-500 hover:text-slate-900"
              }`}
            >
              {lp.title.split(" - ")[0]}
            </Link>
          ))}
        </div>
      </section>

    </div>
  );
}

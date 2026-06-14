import { useParams, Link, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { seoLandingPages } from "../data/seoLandingPages";
import { 
  Shield, 
  Sparkles, 
  Clock, 
  ArrowRight, 
  ChevronDown, 
  CheckCircle, 
  Star, 
  TrendingUp, 
  Layers, 
  Check, 
  ShoppingCart, 
  HelpCircle,
  Zap,
  Globe,
  DollarSign
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import CategoryIcon from "../components/CategoryIcon";

export default function SEOLandingPage() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const [openFaqIndex, setOpenFaqIndex] = useState<number | null>(null);
  


  // Lookup the specific dynamic SEO page
  const seoPage = seoLandingPages.find((p) => p.slug === slug);

  useEffect(() => {
    if (!seoPage) return;

    // 1. Core Browser Document Title Update
    document.title = `${seoPage.title} | Pyare SMM Panel`;

    // 2. Head Meta Description Update (Crucial for Google SEO Indexing)
    let metaDesc = document.querySelector('meta[name="description"]');
    if (metaDesc) {
      metaDesc.setAttribute("content", seoPage.metaDescription);
    } else {
      metaDesc = document.createElement("meta");
      metaDesc.setAttribute("name", "description");
      metaDesc.setAttribute("content", seoPage.metaDescription);
      document.head.appendChild(metaDesc);
    }

    // 3. Head Meta Keywords Update
    let metaKeywords = document.querySelector('meta[name="keywords"]');
    if (metaKeywords) {
      metaKeywords.setAttribute("content", `${seoPage.keyword}, search engine smm, real ${seoPage.keyword}, buy ${seoPage.keyword} cheap, sitemap panels, ${seoPage.heading}`);
    }

    // 4. Ingest Google Search Schema JSON-LD (FAQ & Service Structured Data markup)
    const schemaJSON = {
      "@context": "https://schema.org",
      "@type": "Service",
      "name": seoPage.title,
      "serviceType": "Social Media Marketing",
      "provider": {
        "@type": "LocalBusiness",
        "name": "Pyare SMM Panel",
        "url": window.location.origin
      },
      "description": seoPage.metaDescription,
      "offers": {
        "@type": "Offer",
        "priceCurrency": "INR",
        "price": "1.00",
        "priceValidUntil": "2030-12-31"
      },
      "mainEntity": {
        "@type": "FAQPage",
        "mainEntity": seoPage.faqs.map((faq) => ({
          "@type": "Question",
          "name": faq.q,
          "acceptedAnswer": {
            "@type": "Answer",
            "text": faq.a
          }
        }))
      }
    };

    // Remove stale script tag if it exists
    const existingScript = document.getElementById("seo-schema-script");
    if (existingScript) {
      existingScript.remove();
    }

    // Inject fresh structured data script
    const script = document.createElement("script");
    script.id = "seo-schema-script";
    script.type = "application/ld+json";
    script.innerHTML = JSON.stringify(schemaJSON);
    document.head.appendChild(script);

    // Scroll to top upon navigation
    window.scrollTo({ top: 0, behavior: "smooth" });

    return () => {
      // Cleanup script on unmount
      const scriptToRemove = document.getElementById("seo-schema-script");
      if (scriptToRemove) scriptToRemove.remove();
    };
  }, [seoPage]);

  if (!seoPage) {
    return (
      <div id="seo-not-found" className="min-h-[80vh] flex flex-col items-center justify-center text-center px-4 py-12">
        <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center text-red-600 mb-4 animate-pulse">
          <Layers className="w-8 h-8" />
        </div>
        <h1 className="text-3xl font-extrabold text-gray-900 tracking-tight mb-2">Service Route Pending</h1>
        <p className="text-gray-600 max-w-md mb-6">
          The requested search-engine landing page slug does not exist or has been redirected to our central catalog index.
        </p>
        <div className="flex flex-col sm:flex-row gap-3">
          <Link to="/courses" className="px-6 py-3 bg-indigo-600 text-white rounded-xl shadow-lg shadow-indigo-100 hover:bg-indigo-700 transition font-semibold">
            Place New Order
          </Link>
          <Link to="/seo-services" className="px-6 py-3 bg-gray-100 text-gray-700 rounded-xl hover:bg-gray-250 transition font-semibold">
            View All SEO Pages
          </Link>
        </div>
      </div>
    );
  }



  const handleCreateOrderRedirect = () => {
    navigate(`/courses?category=${encodeURIComponent(seoPage.category)}`);
  };

  return (
    <div id={`seo-landing-${seoPage.slug}`} className="space-y-16">
      
      {/* 1. Hero Showcase Section */}
      <section className="relative overflow-hidden rounded-3xl bg-slate-900 text-white px-6 py-12 md:px-12 md:py-20 shadow-2xl transition">
        {/* Subtle decorative glowing background layers */}
        <div className="absolute top-0 right-0 -mr-24 -mt-24 w-80 h-80 rounded-full bg-indigo-600/30 blur-3xl pointer-events-none" />
        <div className="absolute bottom-0 left-0 -ml-24 -mb-24 w-8 w-80 h-80 rounded-full bg-purple-600/20 blur-3xl pointer-events-none" />

        <div className="max-w-4xl mx-auto relative z-10 space-y-6">
          
          {/* Target category badge */}
          <div className="inline-flex items-center gap-2 bg-indigo-500/20 border border-indigo-500/30 text-indigo-300 px-4 py-1.5 rounded-full text-xs font-semibold uppercase tracking-wider">
            <Sparkles className="w-4.5 h-4.5 text-indigo-400" />
            <span>Target SMM Keyword: "{seoPage.keyword}"</span>
          </div>

          <h1 className="text-3xl sm:text-4xl md:text-5xl font-black tracking-tight leading-tight md:leading-none text-white max-w-3xl">
            {seoPage.heading}
          </h1>

          <p className="text-lg text-slate-300 max-w-2xl font-light">
            {seoPage.subheading}
          </p>

          <div className="flex flex-wrap items-center gap-4 pt-4">
            <button
              onClick={handleCreateOrderRedirect}
              className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white transition-all px-8 py-4 rounded-xl font-bold shadow-xl shadow-indigo-950/50 hover:scale-[1.02] active:scale-[0.98]"
            >
              <ShoppingCart className="w-5 h-5" />
              <span>Order Now (Starts ₹1)</span>
              <ArrowRight className="w-4 h-4 ml-1" />
            </button>
            <Link
              to="/seo-services"
              className="flex items-center gap-1 text-slate-300 hover:text-white transition px-5 py-3 rounded-lg border border-slate-700 hover:border-slate-500 font-semibold"
            >
              Browse Sitemap
            </Link>
          </div>

          {/* Social Proof Counters row */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-6 pt-8 border-t border-slate-800/80">
            <div>
              <div className="text-2xl font-black text-indigo-400">100% Secure</div>
              <div className="text-xs text-slate-400">No Password Needed</div>
            </div>
            <div>
              <div className="text-2xl font-black text-indigo-400">Instant Start</div>
              <div className="text-xs text-slate-400">Computerized Processing</div>
            </div>
            <div>
              <div className="text-2xl font-black text-indigo-400">Refill Protected</div>
              <div className="text-xs text-slate-400">Lifetime Refill Guaranteed</div>
            </div>
            <div>
              <div className="text-2xl font-black text-indigo-400">₹ INR / UPI</div>
              <div className="text-xs text-slate-400">Payment Gateway Support</div>
            </div>
          </div>

        </div>
      </section>



      {/* 3. Narrative & Contextual SEO Article with Highlights */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        
        <div className="lg:col-span-8 space-y-6">
          <h2 className="text-2xl md:text-3xl font-black text-gray-900 tracking-tight">
            Comprehensive Guide: Best Way to Obtain Real {seoPage.keyword} Reach
          </h2>
          <div className="text-gray-700 leading-relaxed space-y-4">
            <p className="font-semibold text-lg text-slate-800">
              {seoPage.intro}
            </p>
            <p>
              In modern digital marketing networks, social proof acts as the strongest psychological trigger. When users discover a new commercial page, music album, online service or creative account, they look directly at public indicators (likes, subscribers, views, followers). If these numbers are neglected, they leave immediately. Utilizing an automated SMM panel allows you to establish a secure, professional foundation instantly.
            </p>
            <p>
              Our panels process transactions seamlessly without asking for passwords. This guarantees that your account meets ranking requirements safely. Simply provide your public URL handle, and let our computer servers manage delivery in the background.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-4">
            {seoPage.highlights.map((highlight, idx) => (
              <div key={idx} className="flex items-start gap-3 p-4 bg-indigo-50/40 rounded-xl border border-indigo-100/30">
                <div className="p-1 bg-indigo-100 text-indigo-700 rounded-lg mt-0.5">
                  <Check className="w-4.5 h-4.5" />
                </div>
                <div>
                  <h4 className="font-bold text-slate-900 text-sm sm:text-base">{highlight}</h4>
                  <p className="text-xs text-slate-500">Premium verified SMM indicator service</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="lg:col-span-4 bg-slate-950 text-white rounded-2xl p-6 border border-slate-800 space-y-6">
          <h3 className="text-xl font-bold tracking-tight text-white flex items-center gap-2">
            <Shield className="w-5 h-5 text-indigo-400" />
            <span>Why Pyare SMM?</span>
          </h3>
          
          <div className="space-y-4">
            <div className="flex gap-3">
              <Clock className="w-5 h-5 text-indigo-400 shrink-0 mt-1" />
              <div>
                <h4 className="font-bold text-sm">24/7 Live Monitoring</h4>
                <p className="text-xs text-slate-400">Our background server observation loops scan every pending order constantly to guarantee automated starts.</p>
              </div>
            </div>

            <div className="flex gap-3">
              <Globe className="w-5 h-5 text-indigo-400 shrink-0 mt-1" />
              <div>
                <h4 className="font-bold text-sm">Direct API Wholesale</h4>
                <p className="text-xs text-slate-400">No reseller margins. We route directly to the core developers, ensuring India's lowest price points.</p>
              </div>
            </div>

            <div className="flex gap-3">
              <DollarSign className="w-5 h-5 text-indigo-400 shrink-0 mt-1" />
              <div>
                <h4 className="font-bold text-sm">UPI Autocredit Gatway</h4>
                <p className="text-xs text-slate-400">Scan and pay instantly from any mobile payment app. Balance updates occur in milliseconds automatically.</p>
              </div>
            </div>
          </div>

          <div className="p-4 bg-indigo-500/10 border border-indigo-500/20 rounded-xl text-center">
            <span className="text-xs text-indigo-300 block mb-1 font-medium">Ready to boost your ratings?</span>
            <button
              onClick={handleCreateOrderRedirect}
              className="text-white text-xs font-bold uppercase tracking-wider bg-indigo-600 hover:bg-indigo-500 transition px-4 py-2.5 rounded-lg w-full"
            >
              Get Started Now
            </button>
          </div>
        </div>

      </section>

      {/* 4. Complete Step-by-Step Order Guide */}
      <section className="bg-slate-50 rounded-2xl border border-slate-100 p-6 md:p-8 space-y-8">
        <div className="text-center max-w-2xl mx-auto space-y-2">
          <h2 className="text-2xl md:text-3xl font-black text-gray-900 tracking-tight">
            How to Buy {seoPage.keyword} Services in 3 Simple Steps
          </h2>
          <p className="text-gray-600">
            Our checkout pipeline is designed for absolute simplicity. No technical knowledge required.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 relative">
          {/* Visual indicator connect line for widescreen */}
          <div className="hidden md:block absolute top-10 left-[15%] right-[15%] h-0.5 bg-indigo-100 z-0 pointer-events-none" />

          {/* Step 1 */}
          <div className="bg-white p-6 rounded-xl border border-slate-200/60 shadow-sm relative z-10 text-center space-y-3">
            <div className="w-10 h-10 bg-indigo-600 text-white rounded-full flex items-center justify-center font-bold font-mono mx-auto text-lg">
              1
            </div>
            <h3 className="font-bold text-gray-900 text-lg">Create Free Account</h3>
            <p className="text-xs text-gray-500">
              Click the login button, enter your email and setup your credentials instantly in seconds. Free forever!
            </p>
          </div>

          {/* Step 2 */}
          <div className="bg-white p-6 rounded-xl border border-slate-200/60 shadow-sm relative z-10 text-center space-y-3">
            <div className="w-10 h-10 bg-indigo-600 text-white rounded-full flex items-center justify-center font-bold font-mono mx-auto text-lg">
              2
            </div>
            <h3 className="font-bold text-gray-900 text-lg">Add Wallet Funds</h3>
            <p className="text-xs text-gray-500">
              Load funds using any secure UPI Mobile Wallet QR Scanner (Paytm, GPay, PhonePe). Starting just ₹10.
            </p>
          </div>

          {/* Step 3 */}
          <div className="bg-white p-6 rounded-xl border border-slate-200/60 shadow-sm relative z-10 text-center space-y-3">
            <div className="w-10 h-10 bg-indigo-600 text-white rounded-full flex items-center justify-center font-bold font-mono mx-auto text-lg">
              3
            </div>
            <h3 className="font-bold text-gray-900 text-lg">Place SMM Order</h3>
            <p className="text-xs text-gray-500">
              Select {seoPage.category} platform pack, paste your public video/profile URL check-link, order, and watch metrics rise!
            </p>
          </div>
        </div>
      </section>

      {/* 5. Frequently Asked Questions Accordion (FAQ Page markup structure) */}
      <section className="space-y-6">
        <div className="text-center max-w-xl mx-auto space-y-2">
          <HelpCircle className="w-8 h-8 text-indigo-500 mx-auto" />
          <h2 className="text-2xl sm:text-3xl font-black text-gray-900 tracking-tight">
            Targeted FAQ: {seoPage.keyword} Solutions
          </h2>
          <p className="text-gray-500 text-sm">
            Answers to most queried terms under the "{seoPage.keyword}" bracket on Google Search.
          </p>
        </div>

        <div className="max-w-3xl mx-auto space-y-3">
          {seoPage.faqs.map((faq, idx) => {
            const isOpen = openFaqIndex === idx;
            return (
              <div 
                key={idx} 
                className="bg-white rounded-xl border border-gray-150 overflow-hidden shadow-sm transition"
              >
                <button
                  onClick={() => setOpenFaqIndex(isOpen ? null : idx)}
                  className="w-full flex items-center justify-between text-left p-5 font-bold text-gray-800 hover:bg-slate-50 transition text-sm sm:text-base gap-3"
                >
                  <span>{faq.q}</span>
                  <ChevronDown className={`w-5 h-5 text-gray-400 transition-transform duration-250 ${isOpen ? "rotate-180 text-indigo-600" : ""}`} />
                </button>
                
                <AnimatePresence initial={false}>
                  {isOpen && (
                    <motion.div
                      initial={{ height: 0 }}
                      animate={{ height: "auto" }}
                      exit={{ height: 0 }}
                      transition={{ duration: 0.2 }}
                      className="border-t border-gray-100"
                    >
                      <div className="p-5 text-slate-600 leading-relaxed text-sm">
                        {faq.a}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </div>
      </section>

      {/* 6. High Conversion Bottom Banner CTA */}
      <section className="bg-gradient-to-r from-indigo-900 to-indigo-950 text-white rounded-3xl p-8 md:p-12 text-center shadow-xl relative overflow-hidden">
        {/* Abstract design vector bubbles */}
        <div className="absolute top-0 left-0 w-32 h-32 rounded-full bg-white/5 -ml-10 -mt-10 blur-xl" />
        <div className="absolute bottom-0 right-0 w-48 h-48 rounded-full bg-white/5 -mr-16 -mb-16 blur-2xl" />

        <div className="max-w-2xl mx-auto relative z-10 space-y-6">
          <h2 className="text-2xl md:text-3xl font-extrabold tracking-tight">
            Ready to secure real {seoPage.keyword} results now?
          </h2>
          <p className="text-indigo-200 text-sm sm:text-base max-w-lg mx-auto">
            Create an SMM panel account on Pyare SMM for free. Load funds starting from only ₹10, and dispatch orders instantly.
          </p>

          <div className="pt-2">
            <button
              onClick={handleCreateOrderRedirect}
              className="px-8 py-4 bg-white hover:bg-indigo-50 text-indigo-900 font-bold rounded-xl transition shadow-lg inline-flex items-center gap-2 uppercase tracking-wide text-xs sm:text-sm hover:scale-[1.02] active:scale-[0.98]"
            >
              <span>Activate Your Free Account</span>
              <ArrowRight className="w-4 h-4 text-indigo-900" />
            </button>
          </div>
          <span className="block text-xs text-indigo-300 font-medium font-mono">
            Direct Developer Rates • Refill Protected • Automatic UPI Checkout Enabled
          </span>
        </div>
      </section>

    </div>
  );
}

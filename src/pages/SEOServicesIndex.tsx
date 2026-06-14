import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { seoLandingPages } from "../data/seoLandingPages";
import { 
  BookOpen, 
  Search, 
  MapPin, 
  ArrowRight, 
  Globe, 
  Tag, 
  Layers, 
  Flame, 
  Sparkles,
  Instagram,
  Youtube,
  Facebook,
  Send,
  Zap,
  CheckCircle
} from "lucide-react";
import CategoryIcon from "../components/CategoryIcon";

export default function SEOServicesIndex() {
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("All");
  const [visibleLimit, setVisibleLimit] = useState(24);

  // Filter list based on search bar text or category selection
  const filteredPages = seoLandingPages.filter((page) => {
    const matchesSearch = 
      page.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      page.keyword.toLowerCase().includes(searchTerm.toLowerCase()) ||
      page.metaDescription.toLowerCase().includes(searchTerm.toLowerCase());
      
    const matchesCategory = 
      selectedCategory === "All" || 
      page.category.toLowerCase() === selectedCategory.toLowerCase();

    return matchesSearch && matchesCategory;
  });

  const handleSearchChange = (val: string) => {
    setSearchTerm(val);
    setVisibleLimit(24);
  };

  const handleCategoryChange = (cat: string) => {
    setSelectedCategory(cat);
    setVisibleLimit(24);
  };

  // Limit grid displays for enhanced performance while keeping search active
  const visiblePages = filteredPages.slice(0, visibleLimit);

  // Unique categories for filtering
  const categories = ["All", "Instagram", "YouTube", "Facebook", "Telegram", "TikTok", "Twitter", "Spotify"];

  // Helper to render platform badge colors
  const getCategoryTheme = (cat: string) => {
    switch (cat.toLowerCase()) {
      case "instagram": return "bg-pink-50 text-pink-700 border-pink-100 ring-pink-500/10";
      case "youtube": return "bg-red-50 text-red-700 border-red-100 ring-red-500/10";
      case "facebook": return "bg-blue-50 text-blue-700 border-blue-100 ring-blue-500/10";
      case "telegram": return "bg-sky-50 text-sky-700 border-sky-100 ring-sky-500/10";
      case "tiktok": return "bg-teal-50 text-teal-700 border-teal-100 ring-teal-500/10";
      case "twitter": return "bg-indigo-50 text-indigo-700 border-indigo-100 ring-indigo-500/10";
      case "spotify": return "bg-emerald-50 text-emerald-700 border-emerald-100 ring-emerald-500/10";
      default: return "bg-slate-50 text-slate-700 border-slate-100 ring-slate-500/10";
    }
  };

  return (
    <div id="seo-services-index-container" className="space-y-10 py-6">
      
      {/* Visual Header / Welcome Section */}
      <div className="text-center max-w-3xl mx-auto space-y-4">
        <div className="inline-flex items-center gap-2 px-3 py-1 bg-indigo-50 border border-indigo-100 text-indigo-700 rounded-full text-xs font-semibold uppercase tracking-wider">
          <BookOpen className="w-3.5 h-3.5 text-indigo-500 animate-pulse" />
          <span>SEO Target Catalog & Sitemap</span>
        </div>
        <h1 className="text-3xl sm:text-4xl font-extrabold text-gray-900 tracking-tight leading-none">
          Explore Pyare SMM Services Dictionary
        </h1>
        <p className="text-gray-600 text-sm sm:text-base max-w-xl mx-auto leading-relaxed">
          Search over 480+ specialized SMM growth target categories. Tap any entry to unlock customized, cheap direct developer rate pricing and lifetime drop refills.
        </p>
      </div>

      {/* Control Panel: Categories + Search Bar */}
      <div className="bg-white rounded-2xl border border-gray-150 p-5 shadow-sm space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          
          {/* Active Search Box */}
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4.5 h-4.5 text-gray-400" />
            <input 
              type="text" 
              placeholder="Query e.g., 'Instagram follower', 'Cheapest smm panel'..." 
              value={searchTerm}
              onChange={(e) => handleSearchChange(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 text-sm text-gray-808 placeholder:text-gray-400"
            />
          </div>

          {/* Quick-filter Category Selector Grid */}
          <div className="flex flex-wrap items-center gap-2">
            {categories.map((cat) => (
              <button
                key={cat}
                onClick={() => handleCategoryChange(cat)}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition border ${
                  selectedCategory === cat
                    ? "border-indigo-600 bg-indigo-600 text-white"
                    : "border-gray-200 hover:bg-gray-50 text-gray-600 bg-white"
                }`}
              >
                {cat}
              </button>
            ))}
          </div>

        </div>
      </div>

      {/* Structured SMM Services Sitemap List */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold text-gray-400 uppercase tracking-wider block">
            Featured Target areas ({visiblePages.length} of {filteredPages.length} displayed)
          </span>
          <span className="text-[10px] sm:text-xs font-semibold text-indigo-600 bg-indigo-50/50 px-2 py-0.5 rounded-md border border-indigo-100">
            Google Crawlable Index Uptime Active
          </span>
        </div>

        {visiblePages.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {visiblePages.map((page) => (
              <Link 
                key={page.slug}
                to={`/services/${page.slug}`}
                className="group flex flex-col justify-between bg-white hover:bg-slate-50/50 rounded-2xl border border-gray-150 p-5 shadow-sm hover:shadow transition-all duration-200"
              >
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md text-[10px] font-bold border ${getCategoryTheme(page.category)}`}>
                      <CategoryIcon category={page.category} className="w-3 h-3" />
                      <span>{page.category} Package</span>
                    </span>
                    <span className="text-[10px] font-mono text-gray-400 flex items-center gap-0.5">
                      <Zap className="w-3 h-3 text-amber-500" />
                      <span>Instant API</span>
                    </span>
                  </div>

                  <h3 className="font-bold text-gray-900 group-hover:text-indigo-600 transition text-sm sm:text-base leading-snug">
                    {page.title.split(" - ")[0]}
                  </h3>

                  <p className="text-xs text-gray-500 line-clamp-2 leading-relaxed h-8">
                    {page.metaDescription}
                  </p>
                </div>

                <div className="flex items-center justify-between pt-3 mt-4 border-t border-gray-100 text-xs font-bold text-gray-450 group-hover:text-indigo-600 transition">
                  <span className="font-mono text-[9px] text-gray-400 truncate max-w-[150px]">{"keyword: " + page.keyword}</span>
                  <div className="flex items-center gap-1 shrink-0 text-indigo-500">
                    <span>Unlock Deal</span>
                    <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
                  </div>
                </div>

              </Link>
            ))}
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-gray-150 p-12 text-center space-y-4 max-w-sm mx-auto">
            <Layers className="w-10 h-10 text-gray-300 mx-auto animate-pulse" />
            <h3 className="font-bold text-gray-800">No Target Services Found</h3>
            <p className="text-xs text-gray-500">
              We couldn't match your search criteria. Try using simpler terms like 'followers', 'views', or 'cheap'.
            </p>
            <button
              onClick={() => { handleSearchChange(""); handleCategoryChange("All"); }}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold transition"
            >
              Reset Filters
            </button>
          </div>
        )}

        {/* Load More Button for consumers */}
        {filteredPages.length > visibleLimit && (
          <div className="text-center pt-6">
            <button
              onClick={() => setVisibleLimit(prev => prev + 24)}
              className="px-6 py-3 bg-white hover:bg-slate-50 border border-gray-200 text-indigo-600 font-bold rounded-xl shadow-sm hover:shadow transition-all text-xs uppercase tracking-wider inline-flex items-center gap-2"
            >
              <span>Show More Services ({filteredPages.length - visibleLimit} Remaining)</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>

      {/* SEC Crawler Map Index (GoogleBot SEO Optimization) */}
      <div className="bg-white rounded-2xl border border-gray-200/80 p-6 md:p-8 space-y-6">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between border-b border-gray-100 pb-4 gap-4">
          <div className="space-y-1">
            <h3 className="font-extrabold text-gray-900 text-sm sm:text-base flex items-center gap-2">
              <Globe className="w-5 h-5 text-indigo-500" />
              <span>Full Google Crawl & Index Directory</span>
            </h3>
            <p className="text-xs text-gray-500 max-w-2xl">
              Complete index mapping of all {filteredPages.length} specialized SMM growth domains. Split into performance-optimized pages for direct search engine crawling.
            </p>
          </div>
          <span className="text-[10px] bg-emerald-50 border border-emerald-200 text-emerald-700 px-2.5 py-1 rounded-md font-bold uppercase tracking-wider shrink-0 select-none">
            Google sitemap sync
          </span>
        </div>

        {/* Directory Page Selector */}
        <div className="flex flex-wrap items-center gap-2 border-b border-gray-50 pb-4">
          <span className="text-xs font-bold text-gray-400 mr-2">Directory Page:</span>
          {Array.from({ length: Math.min(16, Math.ceil(filteredPages.length / 350)) }).map((_, idx) => {
            const pageNum = idx + 1;
            return (
              <button
                key={`sitemap-page-${pageNum}`}
                onClick={() => {
                  const el = document.getElementById("sitemap-page-view-indicator");
                  if (el) el.scrollIntoView({ behavior: "smooth" });
                  // We can local-state store page offset
                  (window as any)._sitemapPage = pageNum;
                  const forceUpdate = new CustomEvent("sitemapPageChange", { detail: pageNum });
                  window.dispatchEvent(forceUpdate);
                }}
                className="w-7 h-7 flex items-center justify-center text-[11px] font-bold rounded-lg border border-gray-200 hover:border-indigo-500 hover:bg-indigo-50/50 text-gray-600 transition"
                id={`btn-sitemap-page-${pageNum}`}
              >
                {pageNum}
              </button>
            );
          })}
          {Math.ceil(filteredPages.length / 350) > 16 && (
            <span className="text-xs font-bold text-gray-400">... up to {Math.ceil(filteredPages.length / 350)} pages</span>
          )}
        </div>

        <SitemapLinkGrid pages={filteredPages} />
      </div>

      {/* Interactive visual search engine index footer guidelines */}
      <div className="bg-slate-900 text-slate-300 rounded-3xl p-6 sm:p-8 flex flex-col sm:flex-row items-center justify-between gap-6 shadow-xl">
        <div className="space-y-1.5 text-center sm:text-left">
          <h3 className="text-white font-extrabold text-lg flex items-center justify-center sm:justify-start gap-2">
            <BookOpen className="w-5 h-5 text-indigo-400" />
            <span>Search Rankings & Indexing System</span>
          </h3>
          <p className="text-slate-400 text-xs max-w-xl">
            These dynamic landings represent high-frequency search keywords. Google and Bing parse this visual index, routing traffic looking for social reach services directly to your domain!
          </p>
        </div>
        <Link 
          to="/courses"
          className="px-5 py-3 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold transition-all uppercase tracking-wider block shrink-0 active:scale-95"
        >
          Check Core Service Catalog &rarr;
        </Link>
      </div>

    </div>
  );
}

function SitemapLinkGrid({ pages }: { pages: any[] }) {
  const [currentPage, setCurrentPage] = useState(1);

  useEffect(() => {
    const handlePageChange = (e: Event) => {
      const pageNum = (e as CustomEvent).detail;
      setCurrentPage(pageNum);
    };
    window.addEventListener("sitemapPageChange", handlePageChange);
    return () => window.removeEventListener("sitemapPageChange", handlePageChange);
  }, []);

  // Show 350 list entries per page
  const listOffset = (currentPage - 1) * 350;
  const activeChunk = pages.slice(listOffset, listOffset + 350);

  return (
    <div>
      <div id="sitemap-page-view-indicator" className="text-xs font-bold text-indigo-600 bg-indigo-50/70 inline-block px-3 py-1 rounded-lg mb-4">
        Viewing target entries {listOffset + 1} to {Math.min(pages.length, listOffset + 350)} (Page {currentPage})
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-x-4 gap-y-2.5 font-sans">
        {activeChunk.map((page) => (
          <Link
            key={`crawler-${page.slug}`}
            to={`/services/${page.slug}`}
            className="group text-[11px] text-gray-400 hover:text-indigo-600 font-semibold truncate hover:underline flex items-center gap-1.5 transition-all"
          >
            <div className="w-1.5 h-1.5 rounded-full bg-gray-200 group-hover:bg-indigo-500 shrink-0 transition-colors" />
            <span className="truncate">{page.keyword}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}

import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Search, TrendingUp, Star, Clock, PlusCircle, Share2 } from "lucide-react";
import { collection, query, where, limit, onSnapshot } from "firebase/firestore";
import { db, handleFirestoreError, OperationType } from "@/lib/firebase";
import { Skeleton } from "@/components/ui/skeleton";
import { useNavigate } from "react-router-dom";

export default function Home() {
  const navigate = useNavigate();
  const [featuredCourses, setFeaturedCourses] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const [isInstallable, setIsInstallable] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);

  useEffect(() => {
    window.addEventListener("beforeinstallprompt", (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
      setIsInstallable(true);
    });
  }, []);

  const handleInstall = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === "accepted") {
      setIsInstallable(false);
    }
    setDeferredPrompt(null);
  };

  useEffect(() => {
    const fetchCourses = async () => {
      try {
        const { getCachedCourses } = await import("@/lib/cache");
        const courses = await getCachedCourses();
        setFeaturedCourses(courses.slice(0, 3));
      } catch (error) {
        console.error(error);
      } finally {
        setLoading(false);
      }
    };
    fetchCourses();
  }, []);

  const handleShare = async () => {
    try {
      await navigator.share({
        title: 'SMM Panel Pro - Grow Social Media',
        text: 'Get high quality Instagram likes, followers and views!',
        url: window.location.href,
      });
    } catch (err) {
      console.log('Share failed', err);
    }
  };

  return (
    <div className="space-y-8">
      <div className="flex gap-2">
        {isInstallable && (
          <motion.div 
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            className="flex-1 bg-indigo-600 text-white p-4 rounded-2xl flex items-center justify-between shadow-lg"
          >
            <div className="flex items-center gap-3">
              <PlusCircle className="w-5 h-5" />
              <div>
                <p className="font-bold text-xs">Install SMM Panel Pro</p>
              </div>
            </div>
            <Button 
              size="sm" 
              className="bg-white text-indigo-600 hover:bg-indigo-50 rounded-full h-8 text-xs font-bold"
              onClick={handleInstall}
            >
              Install
            </Button>
          </motion.div>
        )}
        
        <motion.button
          whileTap={{ scale: 0.95 }}
          onClick={handleShare}
          className="bg-white border border-gray-200 p-4 rounded-2xl flex items-center gap-2 shadow-sm text-gray-700 font-medium text-sm"
        >
          <Share2 className="w-5 h-5 text-indigo-600" />
          Share App
        </motion.button>
      </div>

      <section className="relative overflow-hidden rounded-3xl bg-primary px-6 py-12 text-white">
        <div className="relative z-10 space-y-4">
          <motion.h1 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-3xl font-bold leading-tight md:text-5xl"
          >
            Grow your social media
          </motion.h1>
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-5 h-5" />
            <input 
              type="text" 
              placeholder="Search for services..." 
              className="w-full rounded-full bg-white/10 border border-white/20 py-3 pl-10 pr-4 text-white placeholder:text-white/50 focus:outline-none focus:ring-2 focus:ring-white/30"
              onClick={() => navigate('/courses')}
            />
          </div>
        </div>
        <div className="absolute -right-20 -top-20 h-64 w-64 rounded-full bg-white/10 blur-3xl" />
        <div className="absolute -left-20 -bottom-20 h-64 w-64 rounded-full bg-white/10 blur-3xl" />
      </section>

      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-primary" />
            Featured Services
          </h2>
          <Button variant="ghost" className="text-primary" onClick={() => navigate('/courses')}>See all</Button>
        </div>
        
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {loading ? (
            [1, 2, 3].map((i) => (
              <Card key={i} className="overflow-hidden border-none shadow-lg">
                <Skeleton className="aspect-video w-full" />
                <CardContent className="p-4 space-y-3">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-3 w-1/2" />
                  <div className="flex justify-between pt-2">
                    <Skeleton className="h-6 w-16" />
                    <Skeleton className="h-8 w-24" />
                  </div>
                </CardContent>
              </Card>
            ))
          ) : featuredCourses.length > 0 ? (
            featuredCourses.map((course) => (
              <motion.div
                key={course.id}
                whileHover={{ y: -5 }}
                transition={{ type: "spring", stiffness: 300 }}
              >
                <Card className="overflow-hidden border-none shadow-lg">
                  <img 
                    src={course.image || "https://picsum.photos/seed/course/800/450"} 
                    alt={course.title}
                    className="aspect-video w-full object-cover"
                    referrerPolicy="no-referrer"
                  />
                  <CardContent className="p-4 space-y-3">
                    <div className="flex items-center justify-between text-xs text-gray-500">
                      <span className="flex items-center gap-1">
                        <TrendingUp className="w-3 h-3 text-primary" />
                        Min: {course.minLimit}
                      </span>
                      <Badge variant="secondary" className="text-[10px] bg-blue-50 text-blue-600 border-none">
                        {course.serviceType}
                      </Badge>
                    </div>
                    <h3 className="font-bold line-clamp-2 leading-tight h-10">{course.title}</h3>
                    <div className="flex items-center justify-between pt-2">
                      <div className="flex flex-col">
                        <span className="text-lg font-bold text-primary">₹{Number(course.pricePerThousand || 0).toFixed(2)}</span>
                        <span className="text-[10px] text-gray-400">per 1000</span>
                      </div>
                      <Button size="sm" onClick={() => navigate(`/courses?order=${course.id}`)}>Order Now</Button>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            ))
          ) : (
            <div className="col-span-full text-center py-12 text-gray-500 italic">
              No featured services available at the moment.
            </div>
          )}
        </div>
      </section>
    </div>
  );
}


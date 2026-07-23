  const [apiKey, setApiKey] = useState<string | null>(null);
  const [generatingApiKey, setGeneratingApiKey] = useState(false);

  useEffect(() => {
    if (user) {
      dbClient.getDocs("api_keys", [where("userId", "==", user.uid)]).then(docs => {
        if (docs && docs.length > 0) {
          setApiKey(docs[0].id);
        }
      }).catch(console.warn);
    }
  }, [user]);

  const generateApiKey = async () => {
    if (!user) return;
    setGeneratingApiKey(true);
    try {
      if (apiKey) {
        await dbClient.deleteDoc("api_keys", apiKey).catch(() => {});
      }
      const newKey = "ak_" + Math.random().toString(36).substring(2) + Date.now().toString(36);
      await dbClient.saveDoc("api_keys", newKey, { userId: user.uid, createdAt: new Date().toISOString() });
      setApiKey(newKey);
      toast.success("New API Key generated successfully!");
    } catch (e: any) {
      toast.error(e.message || "Failed to generate API Key");
    } finally {
      setGeneratingApiKey(false);
    }
  };

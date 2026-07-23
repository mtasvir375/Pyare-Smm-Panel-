      <div className="bg-white rounded-3xl shadow-sm border border-gray-50 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Key className="w-5 h-5 text-purple-600" />
            <span className="font-semibold text-gray-800">API Key</span>
          </div>
          <Button 
            variant="outline" 
            size="sm" 
            className="rounded-full text-xs h-8"
            onClick={generateApiKey}
            disabled={generatingApiKey}
          >
            {apiKey ? "Regenerate" : "Generate"}
          </Button>
        </div>
        {apiKey ? (
          <div className="flex items-center justify-between bg-gray-50 rounded-2xl px-4 py-3">
            <code className="text-xs font-mono text-gray-600 truncate mr-2">{apiKey}</code>
            <Button
              variant="ghost"
              size="icon"
              className="shrink-0 w-8 h-8 rounded-full text-primary hover:bg-primary/10"
              onClick={() => {
                navigator.clipboard.writeText(apiKey);
                toast.success("API Key copied to clipboard!");
              }}
            >
              <Copy className="w-4 h-4" />
            </Button>
          </div>
        ) : (
          <p className="text-xs text-gray-500">No API key generated yet.</p>
        )}
      </div>

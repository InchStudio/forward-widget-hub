"use client";

import { useEffect, useState, useCallback, use } from "react";
import { CollectionCard } from "@/components/collection-card";
import { APP_NAME } from "@/lib/constants";

interface ManagePageProps {
  params: Promise<{ token: string }>;
}

export default function ManagePage({ params }: ManagePageProps) {
  const { token } = use(params);
  const [collections, setCollections] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchCollections = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(`/api/manage?token=${token}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setCollections(data.collections);
      localStorage.setItem("fwh_token", token);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { fetchCollections(); }, [fetchCollections]);

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center"><p className="text-muted-foreground">Loading...</p></div>;
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center space-y-2">
          <p className="text-destructive font-medium">Error: {error}</p>
          <p className="text-sm text-muted-foreground">Make sure your management link is correct.</p>
        </div>
      </div>
    );
  }

  return (
    <main className="min-h-screen">
      <div className="mx-auto max-w-2xl px-4 py-16">
        <div className="mb-8">
          <a href="/" className="text-sm text-muted-foreground hover:text-foreground">&larr; {APP_NAME}</a>
          <h1 className="text-3xl font-bold tracking-tight mt-2">My Collections</h1>
        </div>
        <div className="space-y-6">
          {collections.map((col) => (
            <CollectionCard key={col.id} collection={col} token={token} onModuleDeleted={fetchCollections} onModulesUploaded={fetchCollections} />
          ))}
          {collections.length === 0 && (
            <p className="text-center text-muted-foreground py-8">No collections yet. <a href="/" className="underline">Upload some modules</a>.</p>
          )}
        </div>
      </div>
    </main>
  );
}

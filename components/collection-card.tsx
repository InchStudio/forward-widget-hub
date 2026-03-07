"use client";

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface Module {
  id: string; filename: string; title: string; description: string;
  version: string; author: string; file_size: number; is_encrypted: number;
}

interface Collection {
  id: string; slug: string; title: string; description: string;
  fwdUrl: string; pageUrl: string; modules: Module[];
}

interface CollectionCardProps {
  collection: Collection;
  token: string;
  onModuleDeleted: () => void;
  onModulesUploaded: () => void;
}

export function CollectionCard({ collection, token, onModuleDeleted, onModulesUploaded }: CollectionCardProps) {
  const [copied, setCopied] = useState(false);
  const [isUploading, setIsUploading] = useState(false);

  const copy = async (text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDelete = async (moduleId: string) => {
    if (!confirm("Delete this module?")) return;
    const res = await fetch(`/api/modules/${moduleId}?token=${token}`, { method: "DELETE" });
    if (res.ok) onModuleDeleted();
  };

  const handleUploadMore = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    setIsUploading(true);
    try {
      const formData = new FormData();
      files.forEach((file) => formData.append("files", file));
      formData.append("token", token);
      formData.append("collection_id", collection.id);
      const res = await fetch("/api/upload", { method: "POST", body: formData });
      if (res.ok) onModulesUploaded();
    } finally {
      setIsUploading(false);
    }
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    return `${(bytes / 1024).toFixed(1)} KB`;
  };

  return (
    <Card className="p-6 space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <h3 className="text-lg font-semibold">{collection.title}</h3>
          {collection.description && <p className="text-sm text-muted-foreground">{collection.description}</p>}
        </div>
        <Badge variant="outline">{collection.modules.length} modules</Badge>
      </div>

      <div className="rounded-md bg-muted px-3 py-2 text-sm">
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">FWD Link:</span>
          <Button variant="ghost" size="sm" onClick={() => copy(collection.fwdUrl)}>
            {copied ? "Copied!" : "Copy"}
          </Button>
        </div>
        <code className="break-all text-xs">{collection.fwdUrl}</code>
      </div>

      <div className="divide-y">
        {collection.modules.map((mod) => (
          <div key={mod.id} className="flex items-center justify-between py-2">
            <div className="space-y-0.5">
              <div className="flex items-center gap-2">
                <span className="font-medium text-sm">{mod.title}</span>
                {mod.version && <Badge variant="secondary" className="text-xs">{mod.version}</Badge>}
                {mod.is_encrypted ? <Badge variant="outline" className="text-xs">Encrypted</Badge> : null}
              </div>
              <p className="text-xs text-muted-foreground">{mod.filename} &middot; {formatSize(mod.file_size)}</p>
            </div>
            <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => handleDelete(mod.id)}>Delete</Button>
          </div>
        ))}
      </div>

      <div>
        <input type="file" accept=".js" multiple className="hidden" id={`upload-${collection.id}`} onChange={handleUploadMore} />
        <Button variant="outline" size="sm" disabled={isUploading} onClick={() => document.getElementById(`upload-${collection.id}`)?.click()}>
          {isUploading ? "Uploading..." : "Add Modules"}
        </Button>
      </div>
    </Card>
  );
}

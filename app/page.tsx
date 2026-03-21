"use client";

import React, { useState, useRef, useCallback, useEffect } from "react";
import {
  UploadCloud,
  FileCode,
  FileJson,
  CheckCircle2,
  Loader2,
  Copy,
  Check,
  AlertCircle,
  X,
  Link as LinkIcon,
  Key,
  Globe,
  ArrowRight,
  ExternalLink,
  Trash2,
  RefreshCw,
  Lock,
  Pencil,
  ImagePlus,
} from "lucide-react";

interface FileItem {
  id: string;
  name: string;
  size: string;
  type: "js" | "fwd" | "url";
  status: "uploading" | "processing" | "success" | "error";
  progress: number;
  url: string | null;
  fwdUrl?: string | null;
  file: File | null;
  errorMsg?: string;
  processingDetail?: string;
}

interface Module {
  id: string; filename: string; title: string; description: string;
  version: string; author: string; file_size: number; is_encrypted: number;
  source_url: string | null;
}

interface Collection {
  id: string; slug: string; title: string; description: string; icon_url: string;
  fwdUrl: string; pageUrl: string; modules: Module[]; source_url: string | null;
}

async function fetchWithProxy(url: string): Promise<Response> {
  // 1. Try direct browser fetch
  try {
    const res = await fetch(url);
    if (res.ok) return res;
    // Non-ok but reachable — don't retry via proxy, throw directly
    throw new Error(`HTTP ${res.status}`);
  } catch (e) {
    // Network/CORS error (TypeError) — fall through to proxy
    if (!(e instanceof TypeError)) throw e;
  }

  // 2. Fallback: server-side proxy
  const proxyRes = await fetch(`/api/proxy?url=${encodeURIComponent(url)}`);
  if (proxyRes.ok) return proxyRes;

  // 3. Both failed — build informative error
  const errBody = await proxyRes.json().catch(() => null);
  const proxyDetail = errBody?.error || `HTTP ${proxyRes.status}`;
  throw new Error(`跨域下载失败，服务端代理也无法访问 (${proxyDetail})。请手动下载文件后拖拽上传`);
}

async function readNdjsonStream(
  res: Response,
  onProgress: (detail: string) => void,
): Promise<{ ok: boolean; data: Record<string, unknown> }> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let result: Record<string, unknown> = {};
  let errorMsg: string | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop()!;
    for (const line of lines) {
      if (!line.trim()) continue;
      const evt = JSON.parse(line);
      if (evt.type === "progress") {
        onProgress(`正在下载 (${evt.current}/${evt.total}): ${evt.filename}`);
      } else if (evt.type === "result") {
        result = evt;
      } else if (evt.type === "error") {
        errorMsg = evt.error;
      }
    }
  }
  if (errorMsg) return { ok: false, data: { error: errorMsg } };
  return { ok: true, data: result };
}

export default function Home() {
  const [authState, setAuthState] = useState<"loading" | "need-password" | "authenticated">("loading");
  const [passwordInput, setPasswordInput] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [passwordLoading, setPasswordLoading] = useState(false);

  const [isDragging, setIsDragging] = useState(false);
  const [files, setFiles] = useState<FileItem[]>([]);
  const [token, setToken] = useState<string | null>(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("fwh_token");
    }
    return null;
  });
  const [urlInput, setUrlInput] = useState("");
  const [urlLoading, setUrlLoading] = useState(false);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [collectionsLoading, setCollectionsLoading] = useState(false);
  const [showTokenBanner, setShowTokenBanner] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const savedToken = localStorage.getItem("fwh_token");
    fetch("/api/auth").then((r) => r.json()).then(async (data) => {
      if (!data.required || data.authenticated) {
        setAuthState("authenticated");
      } else if (savedToken) {
        // Has token — verify it; if valid, skip password
        const res = await fetch(`/api/manage?token=${savedToken}`);
        if (res.ok) {
          setAuthState("authenticated");
        } else {
          localStorage.removeItem("fwh_token");
          setToken(null);
          setAuthState("need-password");
        }
      } else {
        setAuthState("need-password");
      }
    }).catch(() => setAuthState("authenticated"));
  }, []);

  const handlePasswordSubmit = async () => {
    if (!passwordInput.trim()) return;
    setPasswordLoading(true);
    setPasswordError("");
    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: passwordInput }),
      });
      if (res.ok) {
        setAuthState("authenticated");
      } else {
        setPasswordError("密码错误");
      }
    } catch {
      setPasswordError("网络错误");
    } finally {
      setPasswordLoading(false);
    }
  };

  const fetchCollections = useCallback(async (t?: string) => {
    const currentToken = t || token;
    if (!currentToken) return;
    setCollectionsLoading(true);
    try {
      const res = await fetch(`/api/manage?token=${currentToken}`);
      if (res.ok) {
        const data = await res.json();
        setCollections(data.collections);
      }
    } finally {
      setCollectionsLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (token) fetchCollections();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const onUploadSuccess = useCallback((data: Record<string, unknown>) => {
    let newToken = token;
    if (data.token) {
      newToken = data.token as string;
      setToken(newToken);
      localStorage.setItem("fwh_token", newToken);
      setShowTokenBanner(true);
    }
    // Refresh collections list
    setTimeout(() => fetchCollections(newToken || undefined), 300);
  }, [token, fetchCollections]);

  const processFwdInBrowser = useCallback(async (
    fwdContent: string,
    itemId: string,
    currentToken: string | null,
    fwdSourceUrl?: string,
    syncCollectionId?: string,
  ) => {
    interface FwdData {
      title?: string;
      description?: string;
      icon?: string;
      widgets: Array<{
        id?: string; title?: string; description?: string;
        version?: string; author?: string; requiredVersion?: string;
        url: string;
      }>;
    }

    let fwd: FwdData;
    try {
      fwd = JSON.parse(fwdContent);
      if (!fwd.widgets || !Array.isArray(fwd.widgets)) {
        throw new Error("missing widgets array");
      }
    } catch (e) {
      setFiles((prev) => prev.map((f) =>
        f.id === itemId ? { ...f, status: "error" as const, progress: 100, errorMsg: `解析失败: ${(e as Error).message}` } : f
      ));
      return;
    }

    const downloadedFiles: File[] = [];
    const widgetMetas: Array<{
      id?: string; title?: string; description?: string;
      version?: string; author?: string; requiredVersion?: string;
      source_url?: string;
    }> = [];

    for (let i = 0; i < fwd.widgets.length; i++) {
      const widget = fwd.widgets[i];
      let fname = widget.url.split("/").pop() || "widget.js";
      if (!fname.endsWith(".js")) fname += ".js";

      setFiles((prev) => prev.map((f) =>
        f.id === itemId ? {
          ...f,
          status: "processing" as const,
          progress: Math.round((i / fwd.widgets.length) * 80) + 10,
          processingDetail: `正在下载 (${i + 1}/${fwd.widgets.length}): ${fname}`,
        } : f
      ));

      try {
        const res = await fetchWithProxy(widget.url);
        const blob = await res.blob();
        downloadedFiles.push(new File([blob], fname, { type: "application/javascript" }));
        widgetMetas.push({
          id: widget.id, title: widget.title, description: widget.description,
          version: widget.version, author: widget.author, requiredVersion: widget.requiredVersion,
          source_url: widget.url,
        });
      } catch (e) {
        const errorMsg = `下载 ${fname} 失败: ${(e as Error).message}`;
        setFiles((prev) => prev.map((f) =>
          f.id === itemId ? { ...f, status: "error" as const, progress: 100, errorMsg } : f
        ));
        return;
      }
    }

    setFiles((prev) => prev.map((f) =>
      f.id === itemId ? { ...f, processingDetail: "正在上传到服务器...", progress: 90 } : f
    ));

    const formData = new FormData();
    downloadedFiles.forEach((file) => formData.append("files", file));
    if (currentToken) formData.append("token", currentToken);
    if (fwd.title) formData.append("title", fwd.title);
    if (fwd.description) formData.append("description", fwd.description);
    if (fwd.icon) formData.append("icon", fwd.icon);
    formData.append("widget_meta", JSON.stringify(widgetMetas));
    if (fwdSourceUrl) formData.append("source_url", fwdSourceUrl);
    if (syncCollectionId) {
      formData.append("sync", "true");
      formData.append("collection_id", syncCollectionId);
    }

    try {
      const res = await fetch("/api/upload", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) {
        setFiles((prev) => prev.map((f) =>
          f.id === itemId ? { ...f, status: "error" as const, progress: 100, errorMsg: data.error || "上传失败" } : f
        ));
        return;
      }

      onUploadSuccess(data);

      setFiles((prev) => prev.map((f) =>
        f.id === itemId ? {
          ...f,
          status: "success" as const,
          progress: 100,
          url: data.fwdUrl || null,
          fwdUrl: data.fwdUrl || null,
          type: "fwd" as const,
        } : f
      ));
    } catch {
      setFiles((prev) => prev.map((f) =>
        f.id === itemId ? { ...f, status: "error" as const, progress: 100, errorMsg: "网络错误" } : f
      ));
    }
  }, [onUploadSuccess]);

  const handleFiles = useCallback(async (newFiles: File[], currentToken: string | null) => {
    const validFiles = newFiles.filter(
      (f) => f.name.endsWith(".js") || f.name.endsWith(".fwd")
    );

    if (validFiles.length !== newFiles.length) {
      alert("仅支持 .js 和 .fwd 格式的文件");
    }
    if (validFiles.length === 0) return;

    const fwdFiles = validFiles.filter((f) => f.name.endsWith(".fwd"));
    const jsFiles = validFiles.filter((f) => f.name.endsWith(".js"));

    // Process .fwd files client-side
    for (const fwdFile of fwdFiles) {
      const itemId = Math.random().toString(36).substring(7);
      setFiles((prev) => [{
        id: itemId,
        name: fwdFile.name,
        size: (fwdFile.size / 1024).toFixed(2) + " KB",
        type: "fwd" as const,
        status: "processing" as const,
        progress: 5,
        url: null,
        file: fwdFile,
        processingDetail: "正在解析...",
      }, ...prev]);
      const content = await fwdFile.text();
      await processFwdInBrowser(content, itemId, currentToken);
    }

    // Upload .js files normally
    if (jsFiles.length === 0) return;

    const fileObjects: FileItem[] = jsFiles.map((file) => ({
      id: Math.random().toString(36).substring(7),
      name: file.name,
      size: (file.size / 1024).toFixed(2) + " KB",
      type: "js" as const,
      status: "uploading" as const,
      progress: 0,
      url: null,
      file,
    }));

    setFiles((prev) => [...fileObjects, ...prev]);

    const formData = new FormData();
    jsFiles.forEach((file) => formData.append("files", file));
    if (currentToken) formData.append("token", currentToken);

    const progressInterval = setInterval(() => {
      setFiles((prev) =>
        prev.map((f) => {
          if (fileObjects.some((fo) => fo.id === f.id) && f.status === "uploading") {
            return { ...f, progress: Math.min(f.progress + Math.floor(Math.random() * 15) + 5, 90) };
          }
          return f;
        })
      );
    }, 200);

    try {
      const res = await fetch("/api/upload", { method: "POST", body: formData });
      clearInterval(progressInterval);
      const data = await res.json();
      if (!res.ok) {
        setFiles((prev) => prev.map((f) =>
          fileObjects.some((fo) => fo.id === f.id)
            ? { ...f, status: "error" as const, progress: 100, errorMsg: data.error as string }
            : f
        ));
        return;
      }

      onUploadSuccess(data);

      const siteUrl = window.location.origin;
      const modules = data.modules as { id: string; filename: string }[] | undefined;
      setFiles((prev) =>
        prev.map((f) => {
          const idx = fileObjects.findIndex((fo) => fo.id === f.id);
          if (idx !== -1 && modules?.[idx]) {
            return { ...f, status: "success" as const, progress: 100, url: `${siteUrl}/api/modules/${modules[idx].id}/raw` };
          }
          return f;
        })
      );
    } catch {
      clearInterval(progressInterval);
      setFiles((prev) =>
        prev.map((f) =>
          fileObjects.some((fo) => fo.id === f.id)
            ? { ...f, status: "error" as const, progress: 100, errorMsg: "网络错误" }
            : f
        )
      );
    }
  }, [onUploadSuccess, processFwdInBrowser]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const currentToken = localStorage.getItem("fwh_token");
      handleFiles(Array.from(e.dataTransfer.files), currentToken);
    }
  }, [handleFiles]);

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      handleFiles(Array.from(e.target.files), token);
      e.target.value = "";
    }
  };

  const handleUrl = useCallback(async () => {
    const url = urlInput.trim();
    if (!url) return;
    try { new URL(url); } catch { alert("请输入有效的 URL"); return; }

    setUrlLoading(true);
    const itemId = Math.random().toString(36).substring(7);
    const filename = url.split("/").pop() || "remote";
    const fileItem: FileItem = {
      id: itemId, name: filename, size: "远程文件",
      type: "url", status: "uploading", progress: 10, url: null, file: null,
    };
    setFiles((prev) => [fileItem, ...prev]);
    setUrlInput("");

    try {
      // Download file in browser
      setFiles((prev) => prev.map((f) =>
        f.id === itemId ? { ...f, progress: 20, processingDetail: "正在下载文件..." } : f
      ));

      const res = await fetchWithProxy(url);
      const arrayBuffer = await res.arrayBuffer();
      const text = new TextDecoder().decode(arrayBuffer);

      // Detect .fwd
      let isFwd = filename.endsWith(".fwd");
      if (!isFwd) {
        try {
          const parsed = JSON.parse(text);
          isFwd = Array.isArray(parsed.widgets);
        } catch { /* not JSON, treat as .js */ }
      }

      if (isFwd) {
        setFiles((prev) => prev.map((f) =>
          f.id === itemId ? { ...f, type: "fwd" as const, status: "processing" as const } : f
        ));
        await processFwdInBrowser(text, itemId, localStorage.getItem("fwh_token"), url);
      } else {
        // Single .js file - upload to server
        setFiles((prev) => prev.map((f) =>
          f.id === itemId ? { ...f, progress: 50, processingDetail: "正在上传..." } : f
        ));
        const blob = new Blob([arrayBuffer], { type: "application/javascript" });
        const jsFilename = filename.endsWith(".js") ? filename : filename + ".js";
        const file = new File([blob], jsFilename);
        const formData = new FormData();
        formData.append("files", file);
        const currentToken = localStorage.getItem("fwh_token");
        if (currentToken) formData.append("token", currentToken);
        formData.append("source_url", url);

        const uploadRes = await fetch("/api/upload", { method: "POST", body: formData });
        const data = await uploadRes.json();
        if (!uploadRes.ok) {
          setFiles((prev) => prev.map((f) =>
            f.id === itemId ? { ...f, status: "error" as const, progress: 100, errorMsg: data.error } : f
          ));
          return;
        }

        onUploadSuccess(data);

        const siteUrl = window.location.origin;
        const modules = data.modules as { id: string; filename: string }[] | undefined;
        if (modules?.length) {
          setFiles((prev) => prev.map((f) =>
            f.id === itemId ? {
              ...f, status: "success" as const, progress: 100,
              name: modules[0].filename,
              url: `${siteUrl}/api/modules/${modules[0].id}/raw`,
            } : f
          ));
        }
      }
    } catch (e) {
      setFiles((prev) => prev.map((f) =>
        f.id === itemId ? { ...f, status: "error" as const, progress: 100, errorMsg: (e as Error).message || "下载失败" } : f
      ));
    } finally {
      setUrlLoading(false);
    }
  }, [urlInput, processFwdInBrowser, onUploadSuccess]);

  const removeFile = (id: string) => {
    setFiles((prev) => prev.filter((f) => f.id !== id));
  };

  const handleDeleteModule = async (moduleId: string) => {
    if (!confirm("确定删除此模块？")) return;
    const res = await fetch(`/api/modules/${moduleId}?token=${token}`, { method: "DELETE" });
    if (res.ok) fetchCollections();
  };

  const handleDeleteCollection = async (slug: string, title: string) => {
    if (!confirm(`确定删除整个合集「${title}」及其所有模块？`)) return;
    const res = await fetch(`/api/collections/${slug}?token=${token}`, { method: "DELETE" });
    if (res.ok) fetchCollections();
  };

  const handleLogout = () => {
    const url = `${window.location.origin}/manage/${token}`;
    if (!confirm(`退出后需通过管理链接恢复访问，请确认已保存：\n\n${url}`)) return;
    setToken(null);
    setCollections([]);
    localStorage.removeItem("fwh_token");
  };

  const manageUrl = token ? `${typeof window !== "undefined" ? window.location.origin : ""}/manage/${token}` : null;

  if (authState === "loading") {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-slate-400" />
      </div>
    );
  }

  if (authState === "need-password") {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="w-full max-w-sm bg-white rounded-2xl shadow-sm border border-slate-200 p-8 space-y-6">
          <div className="text-center space-y-2">
            <div className="mx-auto w-12 h-12 bg-indigo-50 rounded-full flex items-center justify-center">
              <Lock className="w-6 h-6 text-indigo-600" />
            </div>
            <h1 className="text-xl font-bold text-slate-900">访问密码</h1>
            <p className="text-sm text-slate-500">请输入密码以继续</p>
          </div>
          <div className="space-y-3">
            <input
              type="password"
              value={passwordInput}
              onChange={(e) => setPasswordInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handlePasswordSubmit(); }}
              placeholder="请输入密码"
              className="w-full px-4 py-3 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              autoFocus
            />
            {passwordError && (
              <p className="text-sm text-red-500 flex items-center gap-1">
                <AlertCircle className="w-3.5 h-3.5" />
                {passwordError}
              </p>
            )}
            <button
              onClick={handlePasswordSubmit}
              disabled={passwordLoading || !passwordInput.trim()}
              className="w-full py-3 bg-indigo-600 text-white text-sm font-medium rounded-xl hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
            >
              {passwordLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
              确认
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 p-4 md:p-8 font-sans">
      <div className="max-w-4xl mx-auto space-y-8">
        {/* Header */}
        <div className="text-center space-y-2">
          <h1 className="text-3xl md:text-4xl font-bold text-slate-900 tracking-tight">
            模块托管工具
          </h1>
          <p className="text-slate-500 max-w-lg mx-auto">
            上传您的{" "}
            <code className="bg-slate-200 px-1.5 py-0.5 rounded text-sm text-slate-700">.js</code>{" "}
            或{" "}
            <code className="bg-slate-200 px-1.5 py-0.5 rounded text-sm text-indigo-600">.fwd</code>{" "}
            文件以获取云端托管地址。系统会自动解析 .fwd 文件并替换其内部引用的依赖链接。
          </p>
        </div>

        {/* Upload Area */}
        <div
          className={`relative border-2 border-dashed rounded-2xl p-10 md:p-16 text-center transition-all duration-200 ease-in-out cursor-pointer bg-white
            ${isDragging ? "border-indigo-500 bg-indigo-50 shadow-inner" : "border-slate-300 hover:border-indigo-400 hover:bg-slate-50"}
          `}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
        >
          <input type="file" ref={fileInputRef} onChange={handleFileInput} className="hidden" multiple accept=".js,.fwd" />
          <div className="flex flex-col items-center justify-center space-y-4">
            <div className={`p-4 rounded-full ${isDragging ? "bg-indigo-100" : "bg-slate-100"}`}>
              <UploadCloud className={`w-10 h-10 ${isDragging ? "text-indigo-600" : "text-slate-400"}`} />
            </div>
            <div>
              <p className="text-lg font-medium text-slate-700">点击或将文件拖拽至此处</p>
              <p className="text-sm text-slate-400 mt-1">支持 .js, .fwd 文件 (最大 5MB)</p>
            </div>
          </div>
        </div>

        {/* URL Input */}
        <div className="flex items-center gap-3 bg-white border border-slate-200 rounded-xl p-3 shadow-sm">
          <Globe className="w-5 h-5 text-slate-400 flex-shrink-0" />
          <input
            type="text"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleUrl(); }}
            placeholder="输入 Widget URL 直接转存"
            className="flex-1 text-sm text-slate-700 placeholder:text-slate-400 focus:outline-none bg-transparent"
          />
          <button
            onClick={handleUrl}
            disabled={urlLoading || !urlInput.trim()}
            className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex-shrink-0"
          >
            {urlLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
            转存
          </button>
        </div>

        {/* Upload Progress List */}
        {files.length > 0 && (
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 bg-slate-50/50 flex justify-between items-center">
              <h2 className="text-lg font-semibold text-slate-800">上传列表 ({files.length})</h2>
              <button onClick={() => setFiles([])} className="text-sm text-slate-500 hover:text-slate-700 transition-colors">清空</button>
            </div>
            <div className="divide-y divide-slate-100 max-h-[400px] overflow-y-auto">
              {files.map((file) => (
                <FileItemRow key={file.id} file={file} onRemove={() => removeFile(file.id)} />
              ))}
            </div>
          </div>
        )}

        {/* Token Banner */}
        {showTokenBanner && manageUrl && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-5 relative">
            <button onClick={() => setShowTokenBanner(false)} className="absolute top-3 right-3 p-1 text-amber-400 hover:text-amber-600 rounded transition-colors">
              <X className="w-4 h-4" />
            </button>
            <div className="flex items-start gap-3">
              <div className="p-2 bg-amber-100 rounded-lg flex-shrink-0">
                <Key className="w-5 h-5 text-amber-600" />
              </div>
              <div className="space-y-2 min-w-0">
                <h3 className="text-sm font-semibold text-amber-900">请保存您的管理链接</h3>
                <p className="text-xs text-amber-700">这是您管理已上传模块的唯一凭证。丢失后将无法找回，请务必妥善保存。</p>
                <div className="flex items-center bg-white border border-amber-200 rounded-md p-0.5">
                  <input type="text" readOnly value={manageUrl} className="bg-transparent text-xs font-mono text-amber-800 w-full focus:outline-none truncate px-2" />
                  <CopyButton text={manageUrl} label="复制" />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Collections Management */}
        {token && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-bold text-slate-900">我的合集</h2>
              <div className="flex items-center gap-2">
                {manageUrl && <CopyButton text={manageUrl} label="复制管理链接" />}
                <button onClick={handleLogout} className="text-xs flex items-center gap-1 px-2 py-1 rounded-md bg-slate-100 text-slate-500 hover:bg-red-50 hover:text-red-600 transition-colors">
                  退出登录
                </button>
              </div>
            </div>

            {collectionsLoading && collections.length === 0 && (
              <div className="text-center py-8">
                <Loader2 className="w-5 h-5 animate-spin text-slate-400 mx-auto" />
              </div>
            )}

            {!collectionsLoading && collections.length === 0 && (
              <div className="text-center py-8 text-slate-400 text-sm">暂无内容</div>
            )}

            {(() => {
              const standaloneCollections = collections.filter((c) => c.modules.length <= 1 && !c.source_url);
              const multiCollections = collections.filter((c) => c.modules.length > 1 || !!c.source_url);
              return (
                <>
                  {multiCollections.map((col) => (
                    <CollectionSection
                      key={col.id}
                      collection={col}
                      token={token!}
                      onDeleteModule={handleDeleteModule}
                      onDeleteCollection={() => handleDeleteCollection(col.slug, col.title)}
                      onRefresh={fetchCollections}
                    />
                  ))}
                  {standaloneCollections.length > 0 && (
                    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                      <div className="px-6 py-4 border-b border-slate-100 bg-slate-50/50">
                        <h3 className="font-semibold text-slate-800">独立模块</h3>
                      </div>
                      <div className="divide-y divide-slate-100">
                        {standaloneCollections.map((col) => {
                          const mod = col.modules[0];
                          if (!mod) return (
                            <div key={col.id} className="px-6 py-3 flex items-center justify-between gap-4 hover:bg-slate-50 transition-colors group">
                              <div className="flex items-center gap-3 min-w-0">
                                <span className="text-sm text-slate-400">空合集: {col.title}</span>
                              </div>
                              <button onClick={() => handleDeleteCollection(col.slug, col.title)} className="text-xs text-slate-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all">删除</button>
                            </div>
                          );
                          return (
                            <StandaloneModuleRow
                              key={mod.id}
                              module={mod}
                              collection={col}
                              token={token!}
                              onDeleteModule={handleDeleteModule}
                              onDeleteCollection={() => handleDeleteCollection(col.slug, col.title)}
                              onRefresh={fetchCollections}
                            />
                          );
                        })}
                      </div>
                    </div>
                  )}
                </>
              );
            })()}
          </div>
        )}
      </div>
    </div>
  );
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };
  return (
    <button
      onClick={handleCopy}
      className={`text-xs flex items-center gap-1 px-2 py-1 rounded-md transition-all ${copied ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
      title={label}
    >
      {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
      {copied ? "已复制" : label}
    </button>
  );
}

function StandaloneModuleRow({ module: mod, collection, token, onDeleteModule, onDeleteCollection, onRefresh }: {
  module: Module;
  collection: Collection;
  token: string;
  onDeleteModule: (id: string) => void;
  onDeleteCollection: () => void;
  onRefresh: () => void;
}) {
  const [replacingId, setReplacingId] = useState<string | null>(null);
  const [syncingModule, setSyncingModule] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);
  const rawUrl = `${typeof window !== "undefined" ? window.location.origin : ""}/api/modules/${mod.id}/raw`;

  const handleReplace = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setReplacingId(mod.id);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch(`/api/modules/${mod.id}?token=${token}`, { method: "PUT", body: formData });
      if (res.ok) onRefresh();
    } finally {
      setReplacingId(null);
      e.target.value = "";
    }
  };

  const handleSyncModule = async () => {
    if (!mod.source_url) return;
    if (!confirm("确定从原地址重新同步此模块？")) return;
    setSyncingModule(true);
    try {
      const res = await fetchWithProxy(mod.source_url);
      const blob = await res.blob();
      const fname = mod.source_url.split("/").pop() || "widget.js";
      const file = new File([blob], fname, { type: "application/javascript" });
      const formData = new FormData();
      formData.append("file", file);
      const putRes = await fetch(`/api/modules/${mod.id}?token=${token}`, { method: "PUT", body: formData });
      if (putRes.ok) onRefresh();
    } catch (e) {
      alert(`同步失败: ${(e as Error).message}`);
    } finally {
      setSyncingModule(false);
    }
  };

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 border-b border-slate-100 bg-slate-50/50">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-lg bg-amber-50 flex items-center justify-center flex-shrink-0">
              <FileCode className="w-4.5 h-4.5 text-amber-600" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="font-semibold text-slate-800">{mod.title}</h3>
                {mod.version && <span className="text-xs bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded">{mod.version}</span>}
                {mod.is_encrypted && <span className="text-xs bg-purple-50 text-purple-600 px-1.5 py-0.5 rounded border border-purple-100">加密</span>}
              </div>
              <p className="text-xs text-slate-400 mt-0.5">{mod.filename} · {mod.file_size < 1024 ? `${mod.file_size} B` : `${(mod.file_size / 1024).toFixed(1)} KB`}</p>
            </div>
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            <input type="file" accept=".js" className="hidden" id={`replace-s-${mod.id}`} onChange={handleReplace} />
            <button
              disabled={replacingId === mod.id}
              onClick={() => document.getElementById(`replace-s-${mod.id}`)?.click()}
              className="p-1.5 text-slate-300 hover:text-indigo-500 hover:bg-indigo-50 rounded-lg transition-colors disabled:opacity-50"
              title="更新文件"
            >
              {replacingId === mod.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <UploadCloud className="w-4 h-4" />}
            </button>
            {mod.source_url && (
              <button
                disabled={syncingModule}
                onClick={handleSyncModule}
                className="p-1.5 text-slate-300 hover:text-emerald-500 hover:bg-emerald-50 rounded-lg transition-colors disabled:opacity-50"
                title="从源地址同步"
              >
                <RefreshCw className={`w-4 h-4 ${syncingModule ? "animate-spin" : ""}`} />
              </button>
            )}
            <button
              onClick={() => { onDeleteModule(mod.id); onDeleteCollection(); }}
              className="p-1.5 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
              title="删除模块"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
      {/* Raw URL */}
      <div className="px-6 py-2.5 bg-amber-50/40 flex items-center gap-2">
        <Key className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />
        <span className="text-xs text-amber-700 font-medium flex-shrink-0">模块链接</span>
        <div className="flex items-center bg-white border border-amber-200 rounded-md p-0.5 flex-1 min-w-0">
          <input type="text" readOnly value={rawUrl} className="bg-transparent text-xs font-mono text-amber-600 w-full focus:outline-none truncate px-2" />
          <button
            onClick={() => { navigator.clipboard.writeText(rawUrl); setCopiedUrl(true); setTimeout(() => setCopiedUrl(false), 2000); }}
            className={`p-1 rounded transition-all flex-shrink-0 ${copiedUrl ? "bg-green-500 text-white" : "bg-amber-50 text-amber-600 hover:bg-amber-100"}`}
          >
            {copiedUrl ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>
    </div>
  );
}

function CollectionSection({ collection, token, onDeleteModule, onDeleteCollection, onRefresh }: {
  collection: Collection;
  token: string;
  onDeleteModule: (id: string) => void;
  onDeleteCollection: () => void;
  onRefresh: () => void;
}) {
  const [copiedFwd, setCopiedFwd] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [replacingId, setReplacingId] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncingModuleId, setSyncingModuleId] = useState<string | null>(null);
  const [moduleUrlInput, setModuleUrlInput] = useState("");
  const [addingByUrl, setAddingByUrl] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(collection.title);
  const [editDesc, setEditDesc] = useState(collection.description || "");
  const [editIcon, setEditIcon] = useState<File | null>(null);
  const [editIconPreview, setEditIconPreview] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const iconInputRef = useRef<HTMLInputElement>(null);

  const handleSaveEdit = async () => {
    if (!editTitle.trim()) return;
    setSaving(true);
    try {
      const formData = new FormData();
      formData.append("title", editTitle.trim());
      formData.append("description", editDesc.trim());
      if (editIcon) formData.append("icon", editIcon);
      const res = await fetch(`/api/collections/${collection.slug}?token=${token}`, { method: "PUT", body: formData });
      if (!res.ok) {
        const data = await res.json();
        alert(data.error || "保存失败");
        return;
      }
      setEditing(false);
      setEditIcon(null);
      setEditIconPreview(null);
      onRefresh();
    } catch {
      alert("保存失败");
    } finally {
      setSaving(false);
    }
  };

  const handleIconSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setEditIcon(file);
    setEditIconPreview(URL.createObjectURL(file));
  };

  const handleReplace = async (moduleId: string, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setReplacingId(moduleId);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch(`/api/modules/${moduleId}?token=${token}`, { method: "PUT", body: formData });
      if (res.ok) onRefresh();
    } finally {
      setReplacingId(null);
      e.target.value = "";
    }
  };

  const handleSyncCollection = async () => {
    if (!collection.source_url) return;
    if (!confirm("确定从原地址重新同步此合集？")) return;
    setSyncing(true);
    try {
      const res = await fetchWithProxy(collection.source_url);
      const text = await res.text();
      const fwd = JSON.parse(text);
      if (!fwd.widgets || !Array.isArray(fwd.widgets)) throw new Error("Invalid .fwd format");

      const downloadedFiles: File[] = [];
      const widgetMetas: Array<{ id?: string; title?: string; description?: string; version?: string; author?: string; requiredVersion?: string; source_url?: string }> = [];

      for (const widget of fwd.widgets) {
        let fname = widget.url.split("/").pop() || "widget.js";
        if (!fname.endsWith(".js")) fname += ".js";
        const dlRes = await fetchWithProxy(widget.url);
        const blob = await dlRes.blob();
        downloadedFiles.push(new File([blob], fname, { type: "application/javascript" }));
        widgetMetas.push({
          id: widget.id, title: widget.title, description: widget.description,
          version: widget.version, author: widget.author, requiredVersion: widget.requiredVersion,
          source_url: widget.url,
        });
      }

      const formData = new FormData();
      downloadedFiles.forEach((file) => formData.append("files", file));
      formData.append("token", token);
      formData.append("collection_id", collection.id);
      formData.append("sync", "true");
      formData.append("source_url", collection.source_url);
      formData.append("widget_meta", JSON.stringify(widgetMetas));
      if (fwd.title) formData.append("title", fwd.title);
      if (fwd.description) formData.append("description", fwd.description);
      if (fwd.icon) formData.append("icon", fwd.icon);

      const uploadRes = await fetch("/api/upload", { method: "POST", body: formData });
      if (!uploadRes.ok) {
        const data = await uploadRes.json();
        alert(data.error || "同步失败");
        return;
      }
      onRefresh();
    } catch (e) {
      alert(`同步失败: ${(e as Error).message}`);
    } finally {
      setSyncing(false);
    }
  };

  const handleSyncModule = async (mod: Module) => {
    if (!mod.source_url) return;
    if (!confirm("确定从原地址重新同步此模块？")) return;
    setSyncingModuleId(mod.id);
    try {
      const res = await fetchWithProxy(mod.source_url);
      const blob = await res.blob();
      const fname = mod.source_url.split("/").pop() || "widget.js";
      const file = new File([blob], fname, { type: "application/javascript" });
      const formData = new FormData();
      formData.append("file", file);
      const putRes = await fetch(`/api/modules/${mod.id}?token=${token}`, { method: "PUT", body: formData });
      if (!putRes.ok) {
        const data = await putRes.json();
        alert(data.error || "同步失败");
        return;
      }
      onRefresh();
    } catch (e) {
      alert(`同步失败: ${(e as Error).message}`);
    } finally {
      setSyncingModuleId(null);
    }
  };

  const handleAddModuleByUrl = async () => {
    const url = moduleUrlInput.trim();
    if (!url) return;
    try { new URL(url); } catch { alert("请输入有效的 URL"); return; }
    setAddingByUrl(true);
    try {
      const res = await fetchWithProxy(url);
      const blob = await res.blob();
      const fname = url.split("/").pop() || "widget.js";
      const file = new File([blob], fname, { type: "application/javascript" });
      const formData = new FormData();
      formData.append("files", file);
      formData.append("token", token);
      formData.append("collection_id", collection.id);
      formData.append("source_url", url);
      const uploadRes = await fetch("/api/upload", { method: "POST", body: formData });
      if (uploadRes.ok) {
        setModuleUrlInput("");
        onRefresh();
      }
    } catch (e) {
      alert(`添加失败: ${(e as Error).message}`);
    } finally {
      setAddingByUrl(false);
    }
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
      if (res.ok) onRefresh();
    } finally {
      setIsUploading(false);
      e.target.value = "";
    }
  };

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 border-b border-slate-100 bg-slate-50/50">
        {editing ? (
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-3">
              <input ref={iconInputRef} type="file" accept="image/*" className="hidden" onChange={handleIconSelect} />
              <button
                onClick={() => iconInputRef.current?.click()}
                className="w-9 h-9 rounded-lg border-2 border-dashed border-slate-300 hover:border-indigo-400 flex items-center justify-center flex-shrink-0 overflow-hidden transition-colors"
                title="更换图标"
              >
                {editIconPreview ? (
                  <img src={editIconPreview} alt="" className="w-full h-full object-cover" />
                ) : collection.icon_url ? (
                  <img src={collection.icon_url} alt="" className="w-full h-full object-cover opacity-60" />
                ) : (
                  <ImagePlus className="w-4 h-4 text-slate-400" />
                )}
              </button>
              <div className="flex-1 space-y-2">
                <input
                  type="text"
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  className="w-full text-sm font-semibold text-slate-800 border border-slate-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                  placeholder="合集标题"
                />
                <input
                  type="text"
                  value={editDesc}
                  onChange={(e) => setEditDesc(e.target.value)}
                  className="w-full text-xs text-slate-500 border border-slate-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                  placeholder="合集描述（可选）"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => { setEditing(false); setEditTitle(collection.title); setEditDesc(collection.description || ""); setEditIcon(null); setEditIconPreview(null); }}
                className="px-3 py-1.5 text-xs text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
              >取消</button>
              <button
                onClick={handleSaveEdit}
                disabled={saving || !editTitle.trim()}
                className="px-3 py-1.5 text-xs text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors disabled:opacity-50"
              >{saving ? "保存中..." : "保存"}</button>
            </div>
          </div>
        ) : (
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              {collection.icon_url ? (
                <img src={collection.icon_url} alt="" className="w-9 h-9 rounded-lg object-cover" />
              ) : (
                <div className="w-9 h-9 rounded-lg bg-indigo-50 flex items-center justify-center">
                  <FileJson className="w-4.5 h-4.5 text-indigo-600" />
                </div>
              )}
              <div>
                <h3 className="font-semibold text-slate-800">{collection.title}</h3>
                {collection.description && <p className="text-xs text-slate-500">{collection.description}</p>}
              </div>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <span className="text-xs text-slate-500 bg-slate-100 px-2 py-1 rounded-md">{collection.modules.length} 个模块</span>
              <button onClick={() => { setEditTitle(collection.title); setEditDesc(collection.description || ""); setEditing(true); }} className="p-1.5 text-slate-300 hover:text-indigo-500 hover:bg-indigo-50 rounded-lg transition-colors" title="编辑合集">
                <Pencil className="w-4 h-4" />
              </button>
              {collection.source_url && (
                <button onClick={handleSyncCollection} disabled={syncing} className="p-1.5 text-slate-300 hover:text-indigo-500 hover:bg-indigo-50 rounded-lg transition-colors disabled:opacity-50" title="从源地址同步">
                  <RefreshCw className={`w-4 h-4 ${syncing ? "animate-spin" : ""}`} />
                </button>
              )}
              <button onClick={onDeleteCollection} className="p-1.5 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors" title="删除合集">
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* FWD Link */}
      <div className="px-6 py-2.5 bg-indigo-50/50 border-b border-slate-100 flex items-center gap-2">
        <Key className="w-3.5 h-3.5 text-indigo-500 flex-shrink-0" />
        <span className="text-xs text-indigo-700 font-medium flex-shrink-0">订阅链接</span>
        <div className="flex items-center bg-white border border-indigo-200 rounded-md p-0.5 flex-1 min-w-0">
          <input type="text" readOnly value={collection.fwdUrl} className="bg-transparent text-xs font-mono text-indigo-600 w-full focus:outline-none truncate px-2" />
          <button
            onClick={() => { navigator.clipboard.writeText(collection.fwdUrl); setCopiedFwd(true); setTimeout(() => setCopiedFwd(false), 2000); }}
            className={`p-1 rounded transition-all flex-shrink-0 ${copiedFwd ? "bg-green-500 text-white" : "bg-indigo-50 text-indigo-600 hover:bg-indigo-100"}`}
          >
            {copiedFwd ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {/* Modules */}
      <div className="divide-y divide-slate-100">
        {collection.modules.map((mod) => (
          <div key={mod.id} className="px-6 py-3 flex items-center justify-between gap-4 hover:bg-slate-50 transition-colors group">
            <div className="flex items-center gap-3 min-w-0">
              <div className="p-2 rounded-lg bg-amber-50 text-amber-600 flex-shrink-0">
                <FileCode className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm text-slate-800 truncate">{mod.title}</span>
                  {mod.version && <span className="text-xs bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded">{mod.version}</span>}
                  {mod.is_encrypted ? <span className="text-xs bg-purple-50 text-purple-600 px-1.5 py-0.5 rounded border border-purple-100">加密</span> : null}
                </div>
                <p className="text-xs text-slate-400">{mod.filename} · {mod.file_size < 1024 ? `${mod.file_size} B` : `${(mod.file_size / 1024).toFixed(1)} KB`}</p>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <input type="file" accept=".js" className="hidden" id={`replace-${mod.id}`} onChange={(e) => handleReplace(mod.id, e)} />
              <button
                disabled={replacingId === mod.id}
                onClick={() => document.getElementById(`replace-${mod.id}`)?.click()}
                className="text-xs text-indigo-600 hover:text-indigo-800 transition-colors disabled:opacity-50"
              >
                {replacingId === mod.id ? "上传中..." : "更新版本"}
              </button>
              {mod.source_url && (
                <button
                  disabled={syncingModuleId === mod.id}
                  onClick={() => handleSyncModule(mod)}
                  className="text-xs text-emerald-600 hover:text-emerald-800 transition-colors disabled:opacity-50"
                >
                  {syncingModuleId === mod.id ? "同步中..." : "同步"}
                </button>
              )}
              <button
                onClick={() => onDeleteModule(mod.id)}
                className="text-xs text-slate-400 hover:text-red-500 transition-colors"
              >
                删除
              </button>
            </div>
          </div>
        ))}
        {collection.modules.length === 0 && (
          <div className="px-6 py-4 text-center text-sm text-slate-400">暂无模块</div>
        )}
      </div>

      {/* Add more modules */}
      <div className="px-6 py-3 border-t border-slate-100 bg-slate-50/30 flex items-center gap-3">
        <input type="file" accept=".js" multiple className="hidden" id={`upload-${collection.id}`} onChange={handleUploadMore} />
        <button
          disabled={isUploading}
          onClick={() => document.getElementById(`upload-${collection.id}`)?.click()}
          className="flex items-center gap-2 text-sm text-slate-500 hover:text-indigo-600 transition-colors disabled:opacity-50 flex-shrink-0"
        >
          {isUploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <UploadCloud className="w-4 h-4" />}
          {isUploading ? "上传中..." : "添加模块"}
        </button>
        <div className="flex items-center gap-1.5 flex-1 min-w-0">
          <input
            type="text"
            value={moduleUrlInput}
            onChange={(e) => setModuleUrlInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleAddModuleByUrl(); }}
            placeholder="或输入 .js URL 添加"
            className="flex-1 min-w-0 text-xs text-slate-600 placeholder:text-slate-400 bg-transparent border border-slate-200 rounded-md px-2 py-1.5 focus:outline-none focus:border-indigo-400"
          />
          {moduleUrlInput.trim() && (
            <button
              onClick={handleAddModuleByUrl}
              disabled={addingByUrl}
              className="text-xs text-white bg-indigo-600 hover:bg-indigo-700 px-2.5 py-1.5 rounded-md disabled:opacity-50 flex-shrink-0"
            >
              {addingByUrl ? "添加中..." : "添加"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function FileItemRow({ file, onRemove }: { file: FileItem; onRemove: () => void }) {
  const [copiedUrl, setCopiedUrl] = useState(false);

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedUrl(true);
      setTimeout(() => setCopiedUrl(false), 2000);
    });
  };

  return (
    <div className="p-4 sm:p-6 hover:bg-slate-50 transition-colors group">
      <div className="flex items-start sm:items-center justify-between gap-4 flex-col sm:flex-row">
        <div className="flex items-center gap-4 w-full sm:w-auto">
          <div className={`p-3 rounded-xl flex-shrink-0 ${file.type === "fwd" ? "bg-indigo-50 text-indigo-600" : file.type === "url" ? "bg-emerald-50 text-emerald-600" : "bg-amber-50 text-amber-600"}`}>
            {file.type === "fwd" ? <FileJson className="w-6 h-6" /> : file.type === "url" ? <Globe className="w-6 h-6" /> : <FileCode className="w-6 h-6" />}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p className="font-medium text-slate-800 truncate" title={file.name}>{file.name}</p>
              {file.type === "fwd" && <span className="px-2 py-0.5 rounded text-xs font-medium bg-indigo-100 text-indigo-700 border border-indigo-200">自动解析</span>}
            </div>
            <p className="text-xs text-slate-400 mt-0.5">{file.size}</p>
          </div>
        </div>

        <div className="flex items-center gap-4 w-full sm:w-auto justify-between sm:justify-end">
          {file.status === "uploading" && (
            <div className="flex items-center gap-3 w-full sm:w-48">
              <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                <div className="h-full bg-blue-500 transition-all duration-200 ease-out rounded-full" style={{ width: `${file.progress}%` }} />
              </div>
              <span className="text-sm text-slate-500 w-10 text-right">{file.progress}%</span>
            </div>
          )}

          {file.status === "processing" && (
            <div className="flex items-center gap-2 text-indigo-600">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span className="text-sm font-medium truncate max-w-[300px]">
                {file.processingDetail || "正在处理..."}
              </span>
            </div>
          )}

          {file.status === "error" && (
            <div className="flex items-center gap-2 text-red-500">
              <AlertCircle className="w-4 h-4" />
              <span className="text-sm font-medium">{file.errorMsg || "上传失败"}</span>
            </div>
          )}

          {file.status === "success" && file.url && (
            <div className="flex items-center gap-2 justify-between sm:justify-end">
              <div className={`hidden sm:flex items-center gap-1.5 px-2 py-1 rounded border ${file.fwdUrl ? "bg-indigo-50 text-indigo-700 border-indigo-100" : "bg-green-50 text-green-700 border-green-100"}`}>
                {file.fwdUrl ? <FileJson className="w-3.5 h-3.5" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                <span className="text-xs font-medium">{file.fwdUrl ? "订阅链接" : "托管成功"}</span>
              </div>
              <div className="flex items-center bg-slate-100 rounded-md p-1 w-full sm:w-[220px]">
                <div className="p-1 text-slate-400"><LinkIcon className="w-3.5 h-3.5" /></div>
                <input type="text" readOnly value={file.url} className="bg-transparent text-xs text-slate-600 w-full focus:outline-none truncate px-1" />
                <button
                  onClick={() => handleCopy(file.url!)}
                  className={`p-1.5 rounded transition-all flex-shrink-0 ${copiedUrl ? "bg-green-500 text-white" : "bg-white text-slate-600 hover:bg-slate-200 shadow-sm"}`}
                  title="复制链接"
                >
                  {copiedUrl ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>
          )}

          <button onClick={onRemove} className="p-2 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors opacity-0 group-hover:opacity-100" title="移除记录">
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

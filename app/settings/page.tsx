"use client";

import { useCallback, useEffect, useState } from "react";
import { Database, Loader2, RefreshCw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useTTS } from "@/components/tts-provider";
import {
  deleteModelCaches,
  estimateStorage,
  formatBytes,
  listModelCaches,
  type CacheInfo,
} from "@/lib/model-store";

export default function SettingsPage() {
  const { device, kokoroLoaded, unloadModel } = useTTS();
  const [caches, setCaches] = useState<CacheInfo[]>([]);
  const [storage, setStorage] = useState<{ usage: number; quota: number } | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [webgpu, setWebgpu] = useState<boolean | null>(null);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const [c, s] = await Promise.all([listModelCaches(), estimateStorage()]);
      setCaches(c);
      setStorage(s);
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    setWebgpu(typeof navigator !== "undefined" && "gpu" in navigator);
  }, [refresh, kokoroLoaded]);

  const onDelete = async () => {
    if (!confirm("Delete all downloaded voice models? They will re-download on next use.")) return;
    setDeleting(true);
    try {
      await unloadModel();
      await refresh();
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="space-y-1">
        <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground">
          Device, models, and storage. Everything stays on your machine.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">This device</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">WebGPU</span>
            <Badge variant={webgpu ? "default" : "secondary"}>
              {webgpu === null ? "checking…" : webgpu ? "available" : "not available"}
            </Badge>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Active inference path</span>
            <Badge variant="outline">{device ?? "not loaded yet"}</Badge>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Model in memory</span>
            <Badge variant="outline">{kokoroLoaded ? "yes" : "no"}</Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            WebGPU uses the full-precision model (~326 MB download, fastest).
            Without it, the app uses the quantized model (~92 MB) on the CPU —
            slower than real time, but fully offline after download.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Downloaded models</CardTitle>
            <Button variant="ghost" size="sm" onClick={refresh} disabled={refreshing}>
              <RefreshCw className={`mr-1 h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {caches.length === 0 && (
            <p className="text-muted-foreground">
              No model files downloaded yet. Generate speech once in the Studio
              and the model will be cached here.
            </p>
          )}
          {caches.map((c) => (
            <div key={c.name} className="flex items-center justify-between rounded-lg border p-3">
              <div className="flex items-center gap-3">
                <Database className="h-4 w-4 text-muted-foreground" />
                <div>
                  <p className="font-mono text-xs">{c.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {c.entries} file{c.entries === 1 ? "" : "s"} · {formatBytes(c.bytes)}
                  </p>
                </div>
              </div>
            </div>
          ))}
          {caches.some((c) => c.entries > 0) && (
            <Button variant="destructive" size="sm" onClick={onDelete} disabled={deleting}>
              {deleting ? (
                <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Trash2 className="mr-1 h-3.5 w-3.5" />
              )}
              Delete downloaded models
            </Button>
          )}
          {storage && (
            <p className="text-xs text-muted-foreground">
              Browser storage: {formatBytes(storage.usage)} used of{" "}
              {formatBytes(storage.quota)} available. Browsers may evict cached
              data under storage pressure — the app will simply re-download the
              model when needed.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">About</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-sm text-muted-foreground">
          <p>FreeTTS v1 — free, local-first AI text-to-speech.</p>
          <p>Engine: Kokoro-82M (Apache-2.0) via kokoro-js, ONNX Runtime Web.</p>
          <p>App license: GPL-3.0-or-later (see THIRD-PARTY-NOTICES.md).</p>
        </CardContent>
      </Card>
    </div>
  );
}

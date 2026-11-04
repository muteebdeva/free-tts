"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Database,
  History,
  Loader2,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "@/components/ui/toast";
import { useTTS } from "@/components/tts-provider";
import {
  deleteModelCaches,
  estimateStorage,
  formatBytes,
  listModelCaches,
  type CacheInfo,
} from "@/lib/model-store";
import {
  clearHistory,
  getHistory,
} from "@/lib/history";
import { classifyDevice, type DeviceProfile } from "@/lib/device-profile";

export default function SettingsPage() {
  const { device, kokoroLoaded, unloadModel } = useTTS();
  const [caches, setCaches] = useState<CacheInfo[]>([]);
  const [storage, setStorage] = useState<{ usage: number; quota: number } | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [clearHistoryOpen, setClearHistoryOpen] = useState(false);
  const [historyCount, setHistoryCount] = useState(0);
  const [profile, setProfile] = useState<DeviceProfile | null>(null);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const [c, s] = await Promise.all([listModelCaches(), estimateStorage()]);
      setCaches(c);
      setStorage(s);
      setHistoryCount(getHistory().length);
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    // Device profile (adapter-verified, not a `"gpu" in navigator` guess) +
    // the engine's actual active device path come from the ladder, not from
    // API presence.
    classifyDevice()
      .then(setProfile)
      .catch(() => undefined);
  }, [refresh, kokoroLoaded]);

  const onDelete = async () => {
    setDeleteOpen(false);
    setDeleting(true);
    try {
      await deleteModelCaches();
      await unloadModel();
      await refresh();
      toast.success("Model cache cleared", "Models will re-download on next use.");
    } catch (e) {
      toast.error(
        "Couldn’t clear the model cache",
        e instanceof Error ? e.message : "Unknown error",
      );
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
            <span className="text-muted-foreground">Device profile</span>
            <Badge variant={profile ? "default" : "secondary"}>
              {profile ? profile.label : "checking…"}
            </Badge>
          </div>
          {profile && (
            <p className="text-xs text-muted-foreground">{profile.blurb}</p>
          )}
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Active inference path</span>
            <Badge variant="outline">{device ?? "not loaded yet"}</Badge>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Model in memory</span>
            <Badge variant="outline">{kokoroLoaded ? "yes" : "no"}</Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            The profile is verified, not guessed: a working WebGPU adapter
            means the full-precision Kokoro model (~326 MB download,
            fastest). Without one, the app defaults to the quantized Kokoro
            model (~92 MB) on the CPU — slower
            than real time, but fully offline after download. On
            compatibility devices (including phones), system voices are the default.
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
            <Button
              variant="destructive"
              size="sm"
              onClick={() => setDeleteOpen(true)}
              disabled={deleting}
            >
              {deleting ? (
                <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Trash2 className="mr-1 h-3.5 w-3.5" />
              )}
              Delete downloaded models
            </Button>
          )}
          <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Delete downloaded models?</DialogTitle>
                <DialogDescription>
                  All cached voice model files will be removed from this
                  device. They will download again on next use.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="outline" onClick={() => setDeleteOpen(false)}>
                  Cancel
                </Button>
                <Button variant="destructive" onClick={onDelete}>
                  Delete models
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
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
          <CardTitle className="text-base">History</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <History className="h-4 w-4 text-muted-foreground" />
              <p className="text-muted-foreground">
                {historyCount} saved {historyCount === 1 ? "entry" : "entries"} —
                text and settings only, stored in this browser.
              </p>
            </div>
            <Link href="/history">
              <Button variant="outline" size="sm">
                View history
                <ArrowRight className="ml-1 h-3.5 w-3.5" />
              </Button>
            </Link>
          </div>
          {historyCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground hover:text-destructive"
              onClick={() => setClearHistoryOpen(true)}
            >
              <Trash2 className="mr-1 h-3.5 w-3.5" />
              Clear history
            </Button>
          )}
        </CardContent>
      </Card>

      <Dialog open={clearHistoryOpen} onOpenChange={setClearHistoryOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Clear all history?</DialogTitle>
            <DialogDescription>
              This deletes all {historyCount} saved{" "}
              {historyCount === 1 ? "entry" : "entries"} from this device.
              The action can&apos;t be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setClearHistoryOpen(false)}>
              Keep history
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                clearHistory();
                setClearHistoryOpen(false);
                setHistoryCount(0);
                toast.success("History cleared");
              }}
            >
              Clear all
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">About</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-sm text-muted-foreground">
          <p>FreeTTS v1 — free, local-first AI text-to-speech.</p>
          <p>
            Engines: Kokoro-82M (Apache-2.0) via kokoro-js, system voices via
            the Web Speech API.
          </p>
          <p>App license: GPL-3.0-or-later (see THIRD-PARTY-NOTICES.md).</p>
        </CardContent>
      </Card>
    </div>
  );
}

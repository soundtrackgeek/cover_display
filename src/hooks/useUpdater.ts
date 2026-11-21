import { useCallback, useEffect, useRef, useState } from "react";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { api } from "../api";

export interface UpdaterState {
  currentVersion: string;
  checking: boolean;
  available: boolean;
  newVersion: string | null;
  releaseNotes: string | null;
  downloading: boolean;
  installing: boolean;
  progressPct: number;
  lastCheckedAt: string | null;
  error: string | null;
  upToDateNotice: boolean;
}

const CHECK_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes

export function useUpdater(autoInstallUpdates: boolean) {
  const [state, setState] = useState<UpdaterState>({
    currentVersion: "0.1.0",
    checking: false,
    available: false,
    newVersion: null,
    releaseNotes: null,
    downloading: false,
    installing: false,
    progressPct: 0,
    lastCheckedAt: null,
    error: null,
    upToDateNotice: false,
  });

  const pendingUpdateRef = useRef<Update | null>(null);
  const autoInstallRef = useRef(autoInstallUpdates);
  autoInstallRef.current = autoInstallUpdates;
  const installingRef = useRef(false);

  useEffect(() => {
    api
      .getAppVersion()
      .then((v) => setState((s) => ({ ...s, currentVersion: v })))
      .catch(() => {});
  }, []);

  const installUpdate = useCallback(async (updateOverride?: Update | null) => {
    const update = updateOverride ?? pendingUpdateRef.current;
    if (!update || installingRef.current) return;
    installingRef.current = true;

    setState((s) => ({
      ...s,
      downloading: true,
      installing: false,
      progressPct: 0,
      error: null,
    }));

    try {
      let downloaded = 0;
      let contentLength = 0;

      await update.downloadAndInstall((event) => {
        if (event.event === "Started") {
          contentLength = event.data.contentLength ?? 0;
          setState((s) => ({ ...s, downloading: true, progressPct: 2 }));
        } else if (event.event === "Progress") {
          downloaded += event.data.chunkLength;
          const pct =
            contentLength > 0
              ? Math.min(99, Math.round((downloaded / contentLength) * 100))
              : 50;
          setState((s) => ({ ...s, progressPct: pct }));
        } else if (event.event === "Finished") {
          setState((s) => ({
            ...s,
            downloading: false,
            installing: true,
            progressPct: 100,
          }));
        }
      });

      // On Windows NSIS passive mode, installer closes & relaunches automatically,
      // and relaunch() ensures immediate restart on all platforms/modes.
      await relaunch();
    } catch (err) {
      installingRef.current = false;
      setState((s) => ({
        ...s,
        downloading: false,
        installing: false,
        error: err instanceof Error ? err.message : String(err),
      }));
    }
  }, []);

  const checkForUpdates = useCallback(
    async (manual = false) => {
      if (installingRef.current) return;
      setState((s) => ({
        ...s,
        checking: true,
        error: manual ? null : s.error,
        upToDateNotice: false,
      }));

      try {
        const update = await check();
        const checkedAt = new Date().toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        });

        if (update) {
          pendingUpdateRef.current = update;
          setState((s) => ({
            ...s,
            checking: false,
            available: true,
            newVersion: update.version,
            releaseNotes: update.body ?? null,
            lastCheckedAt: checkedAt,
            error: null,
            upToDateNotice: false,
          }));

          // If user enabled fully automatic background updates, install immediately!
          if (autoInstallRef.current && !manual) {
            void installUpdate(update);
          }
        } else {
          pendingUpdateRef.current = null;
          setState((s) => ({
            ...s,
            checking: false,
            available: false,
            newVersion: null,
            releaseNotes: null,
            lastCheckedAt: checkedAt,
            error: null,
            upToDateNotice: manual,
          }));
        }
      } catch (err) {
        const checkedAt = new Date().toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        });
        setState((s) => ({
          ...s,
          checking: false,
          lastCheckedAt: checkedAt,
          error: manual
            ? err instanceof Error
              ? err.message
              : String(err)
            : null,
        }));
      }
    },
    [installUpdate]
  );

  // Check on startup (short 3.5s delay so UI loads instantaneously) and every 30 minutes
  useEffect(() => {
    const startupTimer = window.setTimeout(() => {
      void checkForUpdates(false);
    }, 3500);

    const interval = window.setInterval(() => {
      void checkForUpdates(false);
    }, CHECK_INTERVAL_MS);

    return () => {
      window.clearTimeout(startupTimer);
      window.clearInterval(interval);
    };
  }, [checkForUpdates]);

  return {
    updater: state,
    checkForUpdates,
    installUpdate,
  };
}

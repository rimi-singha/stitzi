import type { FileFilter, OpenedFile, PlatformAdapter } from "./platform";

const DB_NAME = "embd-studio-v1";
const STORE_NAME = "autosave";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

type FsWindow = Window & {
  showOpenFilePicker?: (opts: unknown) => Promise<Array<{ getFile: () => Promise<File> }>>;
  showSaveFilePicker?: (opts: unknown) => Promise<{
    name: string;
    createWritable: () => Promise<{
      write: (data: BlobPart) => Promise<void>;
      close: () => Promise<void>;
    }>;
  }>;
};

function toFsTypes(filters: FileFilter[]) {
  return filters.map((f) => ({
    description: f.name,
    accept: {
      "application/octet-stream": f.extensions.map((ext) =>
        ext.startsWith(".") ? ext : `.${ext}`,
      ),
    },
  }));
}

export class WebPlatformAdapter implements PlatformAdapter {
  readonly kind = "web" as const;
  private memoryFallback = new Map<string, string>();

  async openFile(filters: FileFilter[]): Promise<OpenedFile | null> {
    // Use DOM-attached <input type="file"> directly: 100% reliable across Chrome/Edge/Firefox/Safari
    // without File System Access API MIME/extension rejections or lost user-activation gestures.
    return new Promise((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      input.style.position = "fixed";
      input.style.left = "-9999px";
      input.style.opacity = "0";
      const acceptExts = filters
        .flatMap((f) => f.extensions.map((e) => (e === "*" ? "*" : `.${e.replace(/^\./, "")}`)))
        .filter(Boolean);
      if (acceptExts.length > 0 && !acceptExts.includes("*")) {
        input.accept = acceptExts.join(",");
      }

      let settled = false;
      const finish = (val: OpenedFile | null) => {
        if (settled) return;
        settled = true;
        input.remove();
        resolve(val);
      };

      input.onchange = async () => {
        const file = input.files?.[0];
        if (!file) return finish(null);
        try {
          const bytes = new Uint8Array(await file.arrayBuffer());
          finish({ name: file.name, path: null, bytes });
        } catch {
          finish(null);
        }
      };
      input.oncancel = () => finish(null);
      document.body.appendChild(input);
      input.click();
    });
  }

  async saveFile(
    suggestedName: string,
    bytes: Uint8Array,
    filters: FileFilter[],
  ): Promise<string | null> {
    const w = window as FsWindow;
    if (w.showSaveFilePicker) {
      try {
        const handle = await w.showSaveFilePicker({
          suggestedName,
          types: toFsTypes(filters),
        });
        const writable = await handle.createWritable();
        await writable.write(bytes as unknown as BlobPart);
        await writable.close();
        return handle.name ?? suggestedName;
      } catch (err) {
        if ((err as Error).name === "AbortError") return null;
      }
    }

    const blob = new Blob([bytes as unknown as BlobPart], {
      type: "application/octet-stream",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = suggestedName;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
    return suggestedName;
  }

  async autosaveWrite(key: string, payload: string): Promise<void> {
    if (typeof indexedDB === "undefined") {
      this.memoryFallback.set(key, payload);
      return;
    }
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).put(payload, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  }

  async autosaveRead(key: string): Promise<string | null> {
    if (typeof indexedDB === "undefined") {
      return this.memoryFallback.get(key) ?? null;
    }
    const db = await openDb();
    const result = await new Promise<string | null>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const req = tx.objectStore(STORE_NAME).get(key);
      req.onsuccess = () => resolve((req.result as string | undefined) ?? null);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return result;
  }

  async autosaveClear(key: string): Promise<void> {
    if (typeof indexedDB === "undefined") {
      this.memoryFallback.delete(key);
      return;
    }
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  }
}

export const platform: PlatformAdapter = new WebPlatformAdapter();

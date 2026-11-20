// Abstract OS/Browser I/O adapter.
// Web V1 uses webPlatform.ts (IndexedDB + File System Access API / Blob fallback).
// Desktop V2 (Tauri 2) swaps ONLY this module for native dialogs, safe atomic writes & OS fonts.

export interface FileFilter {
  name: string;
  extensions: string[];
}

export interface OpenedFile {
  name: string;
  path: string | null;
  bytes: Uint8Array;
}

export interface PlatformAdapter {
  readonly kind: "web" | "tauri";
  openFile(filters: FileFilter[]): Promise<OpenedFile | null>;
  saveFile(
    suggestedName: string,
    bytes: Uint8Array,
    filters: FileFilter[],
    existingPath?: string | null,
  ): Promise<string | null>;
  autosaveWrite(key: string, payload: string): Promise<void>;
  autosaveRead(key: string): Promise<string | null>;
  autosaveClear(key: string): Promise<void>;
}

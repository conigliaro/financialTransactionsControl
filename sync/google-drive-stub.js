import { SyncProvider } from './provider.js';

export class GoogleDriveProvider extends SyncProvider {
  sync() {
    throw new Error("Google Drive sync is not implemented yet.");
  }
}

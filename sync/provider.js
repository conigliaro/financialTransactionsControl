export class SyncProvider {
  constructor() {
    if (this.constructor === SyncProvider) {
      throw new Error("Abstract classes can't be instantiated.");
    }
  }

  sync() {
    throw new Error("Method 'sync()' must be implemented.");
  }
}

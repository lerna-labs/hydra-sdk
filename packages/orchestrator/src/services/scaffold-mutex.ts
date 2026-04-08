/**
 * Per-network mutex to serialize scaffold operations.
 *
 * Prevents two concurrent `make create-instance` calls on the same network,
 * which could race on the flock-based port counter file.
 */
export class ScaffoldMutex {
  private locks = new Map<string, Promise<void>>();

  /**
   * Acquire an exclusive lock for the given network.
   * Returns a release function that MUST be called when done.
   */
  async acquire(network: string): Promise<() => void> {
    // Wait for any existing lock on this network
    while (this.locks.has(network)) {
      await this.locks.get(network);
    }

    let release!: () => void;
    const promise = new Promise<void>((resolve) => {
      release = () => {
        this.locks.delete(network);
        resolve();
      };
    });

    this.locks.set(network, promise);
    return release;
  }
}

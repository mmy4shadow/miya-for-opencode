/**
 * Invalidates the current package by removing its directory and dependency entries.
 * This forces a clean state before running a fresh install.
 * @param packageName The name of the package to invalidate.
 */
export declare function invalidatePackage(packageName?: string): boolean;

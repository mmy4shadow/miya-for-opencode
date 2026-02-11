declare const Bun: {
  spawn: (...args: unknown[]) => any
  file: (path: string) => {
    text: () => Promise<string>
    arrayBuffer?: () => Promise<ArrayBuffer>
  }
  write: (path: string, data: unknown) => Promise<unknown>
  mkdir?: (path: string, options?: { recursive?: boolean }) => Promise<unknown>
  $?: unknown
}

declare module "bun" {
  export const $: unknown
  export type Subprocess<Stdin = unknown, Stdout = unknown, Stderr = unknown> = any
  export function spawn(...args: unknown[]): any
  export function spawnSync(...args: unknown[]): any
  export function file(path: string): { text(): Promise<string>; arrayBuffer?(): Promise<ArrayBuffer> }
  export function write(path: string, data: unknown): Promise<unknown>
}

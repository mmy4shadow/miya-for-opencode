export interface SqliteStatement {
    run: (...args: unknown[]) => unknown;
    get: (...args: unknown[]) => unknown;
    all: (...args: unknown[]) => unknown[];
}
export interface SqliteDatabase {
    exec: (sql: string) => void;
    query: (sql: string) => SqliteStatement;
    transaction: (callback: () => void) => () => void;
    close: () => void;
}
export declare function openSqliteDatabase(file: string): SqliteDatabase | null;

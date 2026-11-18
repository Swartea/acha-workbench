export declare function parseFrontmatter(raw: string): Record<string, string>;
export declare function stripFrontmatter(raw: string): string;
export declare function extractBodySlice(raw: string): string | null;
export declare function isMetaBlock(firstLine: string): boolean;
export declare function stripMeta(body: string): { body: string; removed: number };
export declare function stripInlineMeta(body: string): string;
export declare function stampLocal(sep?: '-' | ''): string;
export declare function stampUtc(): string;
export declare function safeName(raw: string, max?: number, fallback?: string): string;

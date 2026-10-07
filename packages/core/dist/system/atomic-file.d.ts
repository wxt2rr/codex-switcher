export interface AtomicFileOptions {
    mode?: number;
    encoding?: BufferEncoding;
}
/** Replace a file through a same-directory rename and clean failed temp files. */
export declare function writeFileAtomically(path: string, content: string | Uint8Array, options?: AtomicFileOptions): Promise<void>;

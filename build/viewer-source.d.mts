/**
 * viewer-source.d.mts —— build/viewer-source.mjs 的类型声明。
 *
 * 供 TS 工程（tsconfig.node.json / tsconfig.cli.json）导入 .mjs 时使用，
 * 避免对构建脚本加 @ts-ignore。
 */
export declare function bundleViewerSource(): Promise<string>;

/**
 * 兼容入口 — 重导出 infrastructure 层的 DataStoreService
 *
 * 旧代码引用 src/data-store/data-store.service，
 * 统一实现已迁移到 src/infrastructure/data-store/data-store.service。
 */
export { DataStoreService } from '../infrastructure/data-store/data-store.service';

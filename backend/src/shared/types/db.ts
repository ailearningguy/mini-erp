export type AnyDb = Record<string, unknown>;

export interface PgColumn {
  name: string;
  type: string;
  notNull: boolean;
  default?: unknown;
}

export interface PaginationParams {
  cursor?: string;
  limit: number;
  orderBy?: string;
  orderDirection?: 'asc' | 'desc';
}

export interface PaginatedResult<T> {
  data: T[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface QueryOptions {
  filters?: Record<string, unknown>;
  pagination?: PaginationParams;
  include?: string[];
}

export interface Timestamped {
  createdAt: Date;
  updatedAt: Date;
}

export interface SoftDeletable {
  deletedAt: Date | null;
}
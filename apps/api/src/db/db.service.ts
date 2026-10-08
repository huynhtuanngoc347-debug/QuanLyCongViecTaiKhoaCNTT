import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import * as sql from 'mssql';
import { appConfig } from '../config';

/** Giá trị tham số có kiểu SQL chỉ định (khi suy luận tự động không phù hợp). */
export class Typed {
  constructor(public readonly type: sql.ISqlType | (() => sql.ISqlType), public readonly value: unknown) {}
}
export const typed = (type: sql.ISqlType | (() => sql.ISqlType), value: unknown): Typed => new Typed(type, value);

export type Params = Record<string, unknown>;

const DEADLOCK = 1205;
const MAX_ATTEMPTS = 3;

/** Mã lỗi SQL Server (THROW 51001…, 2601, 547…) của một lỗi mssql. */
export function sqlErrorNumber(error: unknown): number | null {
  const e = error as { number?: number; originalError?: { number?: number; info?: { number?: number } } } | null;
  return e?.number ?? e?.originalError?.info?.number ?? e?.originalError?.number ?? null;
}

export function sqlErrorMessage(error: unknown): string {
  const e = error as { message?: string; originalError?: { message?: string; info?: { message?: string } } } | null;
  return [e?.message, e?.originalError?.message, e?.originalError?.info?.message].filter(Boolean).join(' ');
}

function inferType(value: unknown): sql.ISqlType | (() => sql.ISqlType) {
  if (typeof value === 'boolean') return sql.Bit;
  if (typeof value === 'number') {
    if (Number.isInteger(value)) return Math.abs(value) <= 2147483647 ? sql.Int : sql.BigInt;
    return sql.Decimal(18, 4);
  }
  if (value instanceof Date) return sql.DateTime2(3);
  if (typeof value === 'string') return value.length > 4000 ? sql.NVarChar(sql.MAX) : sql.NVarChar(4000);
  return sql.NVarChar(4000);
}

/**
 * Chạy câu SQL viết tay với tham số đặt tên (@ten) như Dapper.
 * - Mảng dùng trong "IN @ds" được mở rộng thành "IN (@ds_0, @ds_1…)"; mảng rỗng → không khớp dòng nào.
 * - Kiểu tham số suy từ giá trị JS; dùng typed() khi cần chỉ định.
 */
export class SqlRunner {
  /** lib: thư viện mssql theo trình điều khiển (tedious hoặc msnodesqlv8) — Request phải cùng loại với pool. */
  constructor(private readonly source: sql.ConnectionPool | sql.Transaction, private readonly lib: typeof sql = sql) {}

  private prepare(text: string, params: Params = {}): { request: sql.Request; text: string } {
    const request = new this.lib.Request(this.source as sql.ConnectionPool);
    let query = text;
    for (const [name, raw] of Object.entries(params)) {
      if (Array.isArray(raw)) {
        const items = [...new Set(raw)];
        const pattern = new RegExp(`\\bIN\\s+@${name}(?![A-Za-z0-9_])`, 'gi');
        const replacement = items.length === 0 ? 'IN (SELECT NULL WHERE 1 = 0)' : `IN (${items.map((_, i) => `@${name}_${i}`).join(', ')})`;
        query = query.replace(pattern, replacement);
        items.forEach((v, i) => request.input(`${name}_${i}`, inferType(v), v));
        continue;
      }
      if (raw instanceof Typed) {
        request.input(name, raw.type, raw.value ?? null);
        continue;
      }
      const value = raw === undefined ? null : raw;
      request.input(name, inferType(value), value);
    }
    return { request, text: query };
  }

  async query<T = Record<string, unknown>>(text: string, params?: Params): Promise<T[]> {
    const { request, text: q } = this.prepare(text, params);
    const result = await request.query(q);
    return (result.recordset ?? []) as T[];
  }

  async one<T = Record<string, unknown>>(text: string, params?: Params): Promise<T | null> {
    const rows = await this.query<T>(text, params);
    return rows[0] ?? null;
  }

  /** Giá trị cột đầu của dòng đầu (ExecuteScalar). */
  async scalar<T = unknown>(text: string, params?: Params): Promise<T | null> {
    const { request, text: q } = this.prepare(text, params);
    const result = await request.query(q);
    const row = result.recordset?.[0] as Record<string, unknown> | undefined;
    if (!row) return null;
    const first = Object.values(row)[0];
    return (first === undefined ? null : first) as T | null;
  }

  /** Nhiều bảng kết quả (QueryMultiple). */
  async multi(text: string, params?: Params): Promise<Record<string, unknown>[][]> {
    const { request, text: q } = this.prepare(text, params);
    const result = await request.query(q);
    return (result.recordsets as unknown as Record<string, unknown>[][]) ?? [];
  }

  async exec(text: string, params?: Params): Promise<number> {
    const { request, text: q } = this.prepare(text, params);
    const result = await request.query(q);
    return (result.rowsAffected ?? []).reduce((s, n) => s + n, 0);
  }
}

/**
 * Kết nối SQL Server (thư viện mssql). Mỗi giao dịch đặt SESSION_CONTEXT(N'MaNguoiDung') = người thao tác,
 * để trigger dbo.TR_CongViec_GhiLichSu ghi lịch sử đúng người; giá trị không bao giờ lấy từ form.
 */
@Injectable()
export class DbService implements OnModuleDestroy {
  private readonly logger = new Logger('CSDL');
  private poolPromise: Promise<sql.ConnectionPool> | null = null;

  private lib: typeof sql = sql;

  private async createPool(): Promise<sql.ConnectionPool> {
    const c = appConfig.db;
    if (c.driver === 'msnodesqlv8') {
      // Đăng nhập Windows (Trusted_Connection) qua ODBC; chỉ nạp khi được chọn.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const v8 = require('mssql/msnodesqlv8') as typeof sql;
      this.lib = v8;
      const server = `${c.server || '(local)'}${c.instance ? '\\' + c.instance : ''}${c.port ? ',' + c.port : ''}`;
      // Có chuỗi kết nối thì dùng; không thì thử lần lượt ODBC Driver 18, 17 (cài kèm SQL Server/SSMS).
      const candidates = c.connectionString ? [c.connectionString] : ['ODBC Driver 18 for SQL Server', 'ODBC Driver 17 for SQL Server'].map(
        (d) => `Driver={${d}};Server=${server};Database=${c.database};Trusted_Connection=yes;TrustServerCertificate=yes;`);
      let last: unknown;
      for (const connectionString of candidates) {
        try {
          const pool = await new v8.ConnectionPool({ connectionString, pool: { max: 20, min: 0, idleTimeoutMillis: 30000 }, options: { useUTC: true } } as unknown as sql.config).connect();
          this.logger.log(`Kết nối SQL Server bằng tài khoản Windows (${/Driver=\{([^}]*)\}/.exec(connectionString)?.[1] ?? 'ODBC'}).`);
          return pool;
        } catch (e) {
          last = e;
        }
      }
      throw last;
    }
    const pool = new sql.ConnectionPool({
      server: c.server,
      port: c.port,
      database: c.database,
      user: c.user || undefined,
      password: c.password || undefined,
      pool: { max: 20, min: 0, idleTimeoutMillis: 30000 },
      options: {
        encrypt: c.encrypt,
        trustServerCertificate: c.trustServerCertificate,
        instanceName: c.instance || undefined,
        useUTC: true,
        appName: 'KhoaCNTT.Api.Nest',
      },
      requestTimeout: 30000,
      connectionTimeout: 15000,
    });
    pool.on('error', (e) => this.logger.error(`Lỗi kết nối: ${(e as Error).message}`));
    return pool.connect();
  }

  /** Pool dùng chung; kết nối lại nếu lần trước lỗi. */
  async pool(): Promise<sql.ConnectionPool> {
    if (!this.poolPromise) {
      this.poolPromise = this.createPool().catch((e) => {
        this.poolPromise = null;
        throw e;
      });
    }
    return this.poolPromise;
  }

  /** Truy vấn chỉ đọc. */
  async read<T>(work: (db: SqlRunner) => Promise<T>): Promise<T> {
    const pool = await this.pool();
    return work(new SqlRunner(pool, this.lib));
  }

  /**
   * Chạy một đơn vị công việc trong giao dịch (READ COMMITTED, XACT_ABORT). Tự thử lại khi deadlock (1205);
   * hàm work phải chạy lại được từ đầu. userId = null cho thao tác ẩn danh / tự động.
   */
  async tx<T>(userId: number | null, work: (db: SqlRunner) => Promise<T>): Promise<T> {
    const pool = await this.pool();
    for (let attempt = 1; ; attempt++) {
      const transaction = new this.lib.Transaction(pool);
      await transaction.begin(sql.ISOLATION_LEVEL.READ_COMMITTED);
      const runner = new SqlRunner(transaction, this.lib);
      try {
        await runner.exec(
          "SET ARITHABORT ON; SET XACT_ABORT ON; EXEC sys.sp_set_session_context @key = N'MaNguoiDung', @value = @uid;",
          { uid: typed(sql.Int, userId) },
        );
        const result = await work(runner);
        await transaction.commit();
        return result;
      } catch (error) {
        try {
          await transaction.rollback();
        } catch {
          // Giao dịch có thể đã bị SQL Server hủy (XACT_ABORT); bỏ qua lỗi rollback.
        }
        if (sqlErrorNumber(error) === DEADLOCK && attempt < MAX_ATTEMPTS) {
          await new Promise((r) => setTimeout(r, 100 * attempt));
          continue;
        }
        throw error;
      }
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (!this.poolPromise) return;
    try {
      (await this.poolPromise).close();
    } catch {
      /* đã đóng */
    }
  }
}

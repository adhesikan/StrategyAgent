import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "../../../db";
import { CANONICAL_EFFECTIVE_HOLDINGS_CTE } from "../institutional-effective-holdings";

describe("canonical effective holdings SQL", () => {
  it("executes the analyzer composition and supersedes an original filing", async () => {
    await db.transaction(async (tx) => {
      await tx.execute(sql`
        CREATE TEMP TABLE institutional_13f_filings (
          accession_number text NOT NULL,
          filer_cik text NOT NULL,
          period_of_report date NOT NULL,
          is_effective boolean NOT NULL,
          accepted_at timestamp,
          filing_date date NOT NULL
        ) ON COMMIT DROP
      `);
      await tx.execute(sql`
        CREATE TEMP TABLE institutional_13f_holdings (
          id text NOT NULL,
          accession_number text NOT NULL,
          filer_cik text NOT NULL,
          cusip text NOT NULL,
          reported_shares bigint,
          shares_prn_type text,
          put_call text,
          period_of_report date NOT NULL,
          mapped_symbol text,
          mapping_status text
        ) ON COMMIT DROP
      `);

      await tx.execute(sql`
        INSERT INTO institutional_13f_filings
          (accession_number, filer_cik, period_of_report, is_effective, accepted_at, filing_date)
        VALUES
          ('original', '0000000001', '2025-03-31', FALSE, '2025-05-01', '2025-05-01'),
          ('amendment', '0000000001', '2025-03-31', TRUE, '2025-06-01', '2025-06-01'),
          ('second-manager', '0000000002', '2025-03-31', TRUE, '2025-05-15', '2025-05-15')
      `);
      await tx.execute(sql`
        INSERT INTO institutional_13f_holdings
          (id, accession_number, filer_cik, cusip, reported_shares, shares_prn_type, put_call, period_of_report, mapped_symbol, mapping_status)
        VALUES
          ('original-row', 'original', '0000000001', '123456789', 999, 'SH', NULL, '2025-03-31', NULL, 'unmapped'),
          ('amendment-row-a', 'amendment', '0000000001', '123456789', 100, 'SH', NULL, '2025-03-31', NULL, 'unmapped'),
          ('amendment-row-b', 'amendment', '0000000001', '123456789', 200, 'SH', NULL, '2025-03-31', NULL, 'unmapped'),
          ('put-row', 'amendment', '0000000001', '123456789', 100, 'SH', 'PUT', '2025-03-31', NULL, 'unmapped'),
          ('prn-row', 'amendment', '0000000001', '123456789', 100, 'PRN', NULL, '2025-03-31', NULL, 'unmapped'),
          ('zero-row', 'amendment', '0000000001', '123456789', 0, 'SH', NULL, '2025-03-31', NULL, 'unmapped'),
          ('null-row', 'amendment', '0000000001', '123456789', NULL, 'SH', NULL, '2025-03-31', NULL, 'unmapped'),
          ('manager-row', 'second-manager', '0000000002', '123456789', 50, 'SH', NULL, '2025-03-31', NULL, 'unmapped')
      `);

      const result = await tx.execute(sql.raw(`
        ${CANONICAL_EFFECTIVE_HOLDINGS_CTE},
        eligible AS (
          SELECT h.*, h.canonical_period_of_report AS canonical_period
          FROM canonical_effective_holdings h
        )
        SELECT
          COUNT(*)::int AS eligible_count,
          COUNT(DISTINCT canonical_period)::int AS period_count,
          COUNT(DISTINCT canonical_filer_cik)::int AS manager_count
        FROM eligible
      `));
      const row = (result as { rows: Array<Record<string, unknown>> }).rows[0];
      expect(row).toMatchObject({
        eligible_count: 3,
        period_count: 1,
        manager_count: 2,
      });
    });
  });
});
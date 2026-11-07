import "server-only";

import type { PostgresQueryable } from "@/lib/db/postgres";

export interface ApprovedEvidenceRecord {
  evidenceId: string;
  tier: string;
  title: string;
  excerpt: string;
  sourceUrl: string;
  sourceDate: string | null;
  verifiedAt: string;
}

/** Lookup never promotes pending records; an empty registry returns no evidence. */
export function createPostgresEvidenceRegistry(database: PostgresQueryable) {
  return {
    async findApproved(evidenceIds: string[]): Promise<ApprovedEvidenceRecord[]> {
      if (evidenceIds.length === 0) return [];
      const result = await database.query<Record<string, unknown>>(
        "SELECT evidence_id, tier, title, excerpt, source_url, source_date, verified_at FROM app.get_approved_evidence($1::text[])",
        [evidenceIds],
      );
      return result.rows.map((row) => {
        if (
          typeof row.evidence_id !== "string" || typeof row.tier !== "string" ||
          typeof row.title !== "string" || typeof row.excerpt !== "string" ||
          typeof row.source_url !== "string" || row.verified_at == null
        ) {
          throw new Error("PostgreSQL evidence registry returned an invalid approved record.");
        }
        return {
          evidenceId: row.evidence_id,
          tier: row.tier,
          title: row.title,
          excerpt: row.excerpt,
          sourceUrl: row.source_url,
          sourceDate: row.source_date == null ? null : String(row.source_date),
          verifiedAt: row.verified_at instanceof Date
            ? row.verified_at.toISOString()
            : String(row.verified_at),
        };
      });
    },
  };
}

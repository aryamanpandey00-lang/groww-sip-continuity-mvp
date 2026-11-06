const BM25_K1 = 1.2;
const BM25_B = 0.75;

/**
 * A deliberately low default threshold: non-empty lexical matches should be
 * retrievable, while zero-overlap or very weak matches must fail.
 */
export const DEFAULT_MIN_RELEVANCE_SCORE = 0.2;

const STOP_WORDS = new Set([
  "a",
  "about",
  "am",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "been",
  "by",
  "can",
  "could",
  "did",
  "do",
  "does",
  "for",
  "from",
  "had",
  "has",
  "have",
  "how",
  "i",
  "if",
  "in",
  "into",
  "is",
  "it",
  "me",
  "my",
  "of",
  "on",
  "or",
  "our",
  "should",
  "that",
  "the",
  "their",
  "they",
  "this",
  "to",
  "was",
  "we",
  "were",
  "what",
  "when",
  "where",
  "which",
  "who",
  "why",
  "will",
  "with",
  "would",
  "you",
  "your",
]);

function stemToken(token: string): string {
  if (token.length > 4 && token.endsWith("ies")) {
    return `${token.slice(0, -3)}y`;
  }

  if (token.length > 4 && token.endsWith("ied")) {
    return `${token.slice(0, -3)}y`;
  }

  if (token.length > 5 && token.endsWith("eed")) {
    return token.slice(0, -1);
  }

  if (token.length > 5 && token.endsWith("ing")) {
    return token.slice(0, -3);
  }

  if (token.length > 4 && token.endsWith("ed")) {
    return token.slice(0, -2);
  }

  if (token.length > 3 && token.endsWith("s") && !token.endsWith("ss")) {
    return token.slice(0, -1);
  }

  return token;
}

export function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function tokenize(value: string): string[] {
  const tokens: string[] = [];

  for (const rawToken of normalizeText(value).split(" ")) {
    if (rawToken.length === 0 || STOP_WORDS.has(rawToken)) {
      continue;
    }

    const token = stemToken(rawToken);

    if (token.length > 1 && !STOP_WORDS.has(token)) {
      tokens.push(token);
    }
  }

  return tokens;
}

export interface ScoringDocument {
  id: string;
  title: string;
  text: string;
  keywords: string[];
}

export interface ScoringResult {
  id: string;
  score: number;
  matchedTerms: string[];
}

function countTerms(tokens: string[]): Map<string, number> {
  const counts = new Map<string, number>();

  for (const token of tokens) {
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }

  return counts;
}

/**
 * Deterministic BM25-style lexical ranking. No embeddings, random sampling or
 * external services are involved.
 */
export function rankDocuments(
  query: string,
  documents: ScoringDocument[],
): ScoringResult[] {
  const queryTerms = [...new Set(tokenize(query))];

  if (queryTerms.length === 0 || documents.length === 0) {
    return documents.map((document) => ({
      id: document.id,
      score: 0,
      matchedTerms: [],
    }));
  }

  const tokenizedDocuments = documents.map((document) => ({
    document,
    tokens: tokenize(
      `${document.title} ${document.text} ${document.keywords.join(" ")}`,
    ),
  }));
  const documentCount = tokenizedDocuments.length;
  const averageLength =
    tokenizedDocuments.reduce(
      (total, entry) => total + entry.tokens.length,
      0,
    ) / documentCount;
  const documentFrequencies = new Map<string, number>();

  for (const term of queryTerms) {
    let frequency = 0;

    for (const entry of tokenizedDocuments) {
      if (entry.tokens.includes(term)) {
        frequency += 1;
      }
    }

    documentFrequencies.set(term, frequency);
  }

  return tokenizedDocuments.map(({ document, tokens }) => {
    const termCounts = countTerms(tokens);
    const documentLength = tokens.length;
    let score = 0;
    const matchedTerms: string[] = [];

    for (const term of queryTerms) {
      const termFrequency = termCounts.get(term) ?? 0;

      if (termFrequency === 0) {
        continue;
      }

      matchedTerms.push(term);

      const documentFrequency = documentFrequencies.get(term) ?? 0;
      const inverseDocumentFrequency = Math.log(
        1 +
          (documentCount - documentFrequency + 0.5) /
            (documentFrequency + 0.5),
      );
      const lengthNormalization =
        1 - BM25_B + BM25_B * (documentLength / averageLength);
      const termFrequencyNormalization =
        (termFrequency * (BM25_K1 + 1)) /
        (termFrequency + BM25_K1 * lengthNormalization);

      score += inverseDocumentFrequency * termFrequencyNormalization;
    }

    return {
      id: document.id,
      score: Number(score.toFixed(6)),
      matchedTerms,
    };
  });
}

export function shortenAddress(value: string) {
  if (value.length < 14) {
    return value;
  }
  return `${value.slice(0, 8)}...${value.slice(-6)}`;
}

export function formatTimestamp(value: string | null) {
  if (!value) {
    return "Not set";
  }

  const millis = Number(value) * 1000;
  if (Number.isNaN(millis)) {
    return value;
  }

  return new Date(millis).toLocaleString();
}

export function parseInteger(value: string, field: string) {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    throw new Error(`Invalid ${field}.`);
  }
  return parsed;
}

export function parsePublicKey(value: string, field: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`Missing ${field}.`);
  }
  return trimmed;
}

export function normalizeActionError(error: unknown) {
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "Unknown error";

  const cleaned = raw
    .replace(/^Error:\s*/i, "")
    .replace(/failed to send transaction:\s*/i, "")
    .replace(/transaction simulation failed:\s*/i, "")
    .replace(/simulation failed:\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();

  if (cleaned.includes("User rejected")) {
    return "Wallet rejected the request.";
  }
  if (cleaned.includes("custom program error")) {
    return `Program rejected the transaction. ${cleaned}`;
  }

  return cleaned || "Unknown error";
}

export function getSignatureUrl(signature: string, clusterName: string) {
  const baseUrl = `https://explorer.solana.com/tx/${signature}`;
  const cluster = normalizeClusterName(clusterName);

  if (!cluster) {
    return baseUrl;
  }

  return `${baseUrl}?cluster=${cluster}`;
}

function normalizeClusterName(clusterName: string) {
  const normalized = clusterName.toLowerCase();

  if (normalized.includes("dev")) {
    return "devnet";
  }
  if (normalized.includes("test")) {
    return "testnet";
  }
  if (normalized.includes("local")) {
    return "custom";
  }

  return "";
}

export function lamportsToSol(value: string) {
  const lamports = Number(value);
  if (Number.isNaN(lamports)) {
    return value;
  }
  return (lamports / 1_000_000_000).toFixed(4);
}

import { keccak256, toBytes } from 'viem';

/** JSON with sorted keys so the same report always hashes the same way. */
export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().filter((k) => value[k] !== undefined).map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

export const hashReport = (content) => keccak256(toBytes(canonicalJson(content)));

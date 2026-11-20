// Integer money helpers. USDC has 6 decimals; everything is a BigInt in micro-units.
// Never use floating point for balances.
const DECIMALS = 6;
const ONE = 10n ** BigInt(DECIMALS);

function parseUnits(str) {
  const s = String(str).trim();
  if (!/^\d+(\.\d{1,6})?$/.test(s)) throw new Error('Invalid amount: ' + str);
  const [whole, frac = ''] = s.split('.');
  return BigInt(whole) * ONE + BigInt(frac.padEnd(DECIMALS, '0'));
}

function formatUnits(n, dp = 2) {
  n = BigInt(n);
  const neg = n < 0n;
  if (neg) n = -n;
  const whole = n / ONE;
  const frac = (n % ONE).toString().padStart(DECIMALS, '0').slice(0, dp);
  return (neg ? '-' : '') + whole.toString() + (dp > 0 ? '.' + frac : '');
}

// DB round trip (BIGINT columns come back as JS numbers; micro-USDC is far below 2^53).
const toDb = (b) => Number(b);
const fromDb = (n) => BigInt(Math.trunc(Number(n || 0)));

// split `amount` by percentages (integers summing to 100); remainder to the last bucket so no dust is lost
function splitByPercent(amount, pcts) {
  amount = BigInt(amount);
  const out = [];
  let used = 0n;
  pcts.forEach((p, i) => {
    if (i === pcts.length - 1) out.push(amount - used);
    else {
      const part = (amount * BigInt(p)) / 100n;
      out.push(part);
      used += part;
    }
  });
  return out;
}

module.exports = { DECIMALS, ONE, parseUnits, formatUnits, toDb, fromDb, splitByPercent };

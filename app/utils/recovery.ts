export type RecoveryOutcome = 'restored' | 'partial' | 'expired';

/**
 * What a recovery link produced. Nothing restored and nothing missing means the link led nowhere
 * (expired or unknown); any missing item, even with nothing restored, means the basket was found
 * but only partly available.
 */
export function recoveryOutcome({
  restored,
  missing,
}: {
  restored: number;
  missing: number;
}): RecoveryOutcome {
  if (missing > 0) return 'partial';
  return restored > 0 ? 'restored' : 'expired';
}

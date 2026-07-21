/**
 * Credit consumption based on pulse time and delta grace period.
 * Example: pulse=60, delta=2, duration=61 → 1 credit
 */
export function creditsForDuration(
  durationSec: number,
  pulseSec: number,
  deltaSec: number,
): number {
  if (durationSec <= 0) return 0;
  const effective = Math.max(0, durationSec - deltaSec);
  if (effective <= 0) return 1;
  return Math.max(1, Math.ceil(effective / pulseSec));
}

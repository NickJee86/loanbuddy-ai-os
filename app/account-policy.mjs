export function activeStateAfterPasswordReset(current, configured) {
  if (current) return current.active === true;
  return configured?.active !== false;
}

export function idempotencyMetadataCandidates(namespace, key, count = 8) {
  return Array.from({ length: count }, (_, attempt) => {
    let hash = 2166136261;
    const input = `${namespace}:${key}:${attempt}`;
    for (let index = 0; index < input.length; index += 1) hash = Math.imul(hash ^ input.charCodeAt(index), 16777619) >>> 0;
    return (hash & 0x7fffffff) || 1;
  });
}

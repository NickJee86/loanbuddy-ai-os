export function detectSupportedDocumentMime(bytes) {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  if (data.length >= 5 && String.fromCharCode(...data.slice(0, 5)) === "%PDF-") return "application/pdf";
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return "image/jpeg";
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (data.length >= png.length && png.every((value, index) => data[index] === value)) return "image/png";
  return "";
}

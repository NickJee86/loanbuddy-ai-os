function normalizeStatus(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ");
}

export function countCompletedDocuments(rows) {
  return rows.filter((row) =>
    ["complete", "completed", "verified"].includes(normalizeStatus(row.Status)),
  ).length;
}

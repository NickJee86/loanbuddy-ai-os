export const GOOGLE_SHEETS_VALUE_INPUT_OPTION = "RAW";

export function googleSheetsWriteSuffix(append = false) {
  return append
    ? `:append?valueInputOption=${GOOGLE_SHEETS_VALUE_INPUT_OPTION}&insertDataOption=INSERT_ROWS`
    : `?valueInputOption=${GOOGLE_SHEETS_VALUE_INPUT_OPTION}`;
}

export function googleSheetsBatchWriteBody(data) {
  return {
    valueInputOption: GOOGLE_SHEETS_VALUE_INPUT_OPTION,
    data,
  };
}

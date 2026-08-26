export const FOLLOW_UP_CONFIG = {
  enabled: "FOLLOW_UP_ENGINE_ENABLED",
  firstMinutes: "FOLLOW_UP_FIRST_MINUTES",
  secondMinutes: "FOLLOW_UP_SECOND_MINUTES",
  thirdMinutes: "FOLLOW_UP_THIRD_MINUTES",
  finalMinutes: "FOLLOW_UP_FINAL_MINUTES",
  maxCount: "FOLLOW_UP_MAX_COUNT",
  businessHoursOnly: "FOLLOW_UP_BUSINESS_HOURS_ONLY",
  businessStart: "FOLLOW_UP_BUSINESS_START",
  businessEnd: "FOLLOW_UP_BUSINESS_END",
  stopOnReply: "FOLLOW_UP_STOP_ON_REPLY",
  stopOnOptOut: "FOLLOW_UP_STOP_ON_OPTOUT",
  informationIncomplete: "FOLLOW_UP_INFO_INCOMPLETE",
  documentsIncomplete: "FOLLOW_UP_DOCUMENT_INCOMPLETE",
};

export const DEFAULT_FOLLOW_UP_SETTINGS = Object.freeze({
  enabled: false,
  firstMinutes: 120,
  secondMinutes: 1440,
  thirdMinutes: 4320,
  finalMinutes: 10080,
  maxCount: 4,
  businessHoursOnly: true,
  businessStart: "09:00",
  businessEnd: "18:00",
  stopOnReply: true,
  stopOnOptOut: true,
  informationIncomplete: true,
  documentsIncomplete: true,
});

const booleanValue = (value, fallback) => {
  const normalized = String(value || "").trim().toUpperCase();
  if (["ON", "TRUE", "YES", "1"].includes(normalized)) return true;
  if (["OFF", "FALSE", "NO", "0"].includes(normalized)) return false;
  return fallback;
};

const positiveInteger = (value, fallback) => {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const timeValue = (value, fallback) =>
  /^([01]\d|2[0-3]):[0-5]\d$/.test(String(value || "").trim())
    ? String(value).trim()
    : fallback;

const timeMinutes = (value) => {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
};

export function readFollowUpSettings(rows = []) {
  const byKey = new Map(
    rows.map((row) => [
      String(row["Config Key"] || "").trim().toUpperCase(),
      row,
    ]),
  );
  const value = (key) => byKey.get(key)?.["Config Value"];
  const settings = {
    enabled: booleanValue(
      value(FOLLOW_UP_CONFIG.enabled),
      DEFAULT_FOLLOW_UP_SETTINGS.enabled,
    ),
    firstMinutes: positiveInteger(
      value(FOLLOW_UP_CONFIG.firstMinutes),
      DEFAULT_FOLLOW_UP_SETTINGS.firstMinutes,
    ),
    secondMinutes: positiveInteger(
      value(FOLLOW_UP_CONFIG.secondMinutes),
      DEFAULT_FOLLOW_UP_SETTINGS.secondMinutes,
    ),
    thirdMinutes: positiveInteger(
      value(FOLLOW_UP_CONFIG.thirdMinutes),
      DEFAULT_FOLLOW_UP_SETTINGS.thirdMinutes,
    ),
    finalMinutes: positiveInteger(
      value(FOLLOW_UP_CONFIG.finalMinutes),
      DEFAULT_FOLLOW_UP_SETTINGS.finalMinutes,
    ),
    maxCount: positiveInteger(
      value(FOLLOW_UP_CONFIG.maxCount),
      DEFAULT_FOLLOW_UP_SETTINGS.maxCount,
    ),
    businessHoursOnly: booleanValue(
      value(FOLLOW_UP_CONFIG.businessHoursOnly),
      DEFAULT_FOLLOW_UP_SETTINGS.businessHoursOnly,
    ),
    businessStart: timeValue(
      value(FOLLOW_UP_CONFIG.businessStart),
      DEFAULT_FOLLOW_UP_SETTINGS.businessStart,
    ),
    businessEnd: timeValue(
      value(FOLLOW_UP_CONFIG.businessEnd),
      DEFAULT_FOLLOW_UP_SETTINGS.businessEnd,
    ),
    stopOnReply: booleanValue(
      value(FOLLOW_UP_CONFIG.stopOnReply),
      DEFAULT_FOLLOW_UP_SETTINGS.stopOnReply,
    ),
    stopOnOptOut: booleanValue(
      value(FOLLOW_UP_CONFIG.stopOnOptOut),
      DEFAULT_FOLLOW_UP_SETTINGS.stopOnOptOut,
    ),
    informationIncomplete: booleanValue(
      value(FOLLOW_UP_CONFIG.informationIncomplete),
      DEFAULT_FOLLOW_UP_SETTINGS.informationIncomplete,
    ),
    documentsIncomplete: booleanValue(
      value(FOLLOW_UP_CONFIG.documentsIncomplete),
      DEFAULT_FOLLOW_UP_SETTINGS.documentsIncomplete,
    ),
  };
  const updatedAt = [...byKey.values()]
    .map((row) => row["Last Updated"] || "")
    .filter(Boolean)
    .sort()
    .at(-1) || "";
  const configured = Object.values(FOLLOW_UP_CONFIG).every((key) => byKey.has(key));
  return { ...settings, configured, updatedAt };
}

export function validateFollowUpSettings(input = {}) {
  const normalized = {
    enabled: Boolean(input.enabled),
    firstMinutes: Number(input.firstMinutes),
    secondMinutes: Number(input.secondMinutes),
    thirdMinutes: Number(input.thirdMinutes),
    finalMinutes: Number(input.finalMinutes),
    maxCount: Number(input.maxCount),
    businessHoursOnly: Boolean(input.businessHoursOnly),
    businessStart: String(input.businessStart || "").trim(),
    businessEnd: String(input.businessEnd || "").trim(),
    stopOnReply: Boolean(input.stopOnReply),
    stopOnOptOut: Boolean(input.stopOnOptOut),
    informationIncomplete: Boolean(input.informationIncomplete),
    documentsIncomplete: Boolean(input.documentsIncomplete),
  };
  const timings = [
    normalized.firstMinutes,
    normalized.secondMinutes,
    normalized.thirdMinutes,
    normalized.finalMinutes,
  ];
  const errors = [];
  if (timings.some((item) => !Number.isSafeInteger(item) || item < 15))
    errors.push("Every reminder time must be a whole number of at least 15 minutes.");
  if (!timings.every((item, index) => index === 0 || item > timings[index - 1]))
    errors.push("Reminder times must increase from the first reminder to the final reminder.");
  if (!Number.isSafeInteger(normalized.maxCount) || normalized.maxCount < 1 || normalized.maxCount > 4)
    errors.push("Maximum reminders must be between 1 and 4.");
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(normalized.businessStart) ||
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(normalized.businessEnd))
    errors.push("Business hours must use 24-hour HH:mm format.");
  else if (timeMinutes(normalized.businessStart) >= timeMinutes(normalized.businessEnd))
    errors.push("Business hours must end after they start.");
  if (!normalized.informationIncomplete && !normalized.documentsIncomplete)
    errors.push("At least one incomplete-case type must be selected.");
  if (!normalized.stopOnReply)
    errors.push("Stop on customer reply is mandatory.");
  if (!normalized.stopOnOptOut)
    errors.push("Stop on opt-out is mandatory.");
  return { valid: errors.length === 0, errors, settings: normalized };
}

export function buildFollowUpConfigRecords(settings, updatedAt) {
  const onOff = (value) => (value ? "ON" : "OFF");
  const descriptions = {
    [FOLLOW_UP_CONFIG.enabled]: "Master switch for automated incomplete-case follow-up",
    [FOLLOW_UP_CONFIG.firstMinutes]: "Minutes from customer inactivity to reminder 1",
    [FOLLOW_UP_CONFIG.secondMinutes]: "Minutes from customer inactivity to reminder 2",
    [FOLLOW_UP_CONFIG.thirdMinutes]: "Minutes from customer inactivity to reminder 3",
    [FOLLOW_UP_CONFIG.finalMinutes]: "Minutes from customer inactivity to final reminder",
    [FOLLOW_UP_CONFIG.maxCount]: "Maximum automated reminders per inactive case",
    [FOLLOW_UP_CONFIG.businessHoursOnly]: "Send automated reminders only during business hours",
    [FOLLOW_UP_CONFIG.businessStart]: "Start of the approved automated follow-up sending window (MYT)",
    [FOLLOW_UP_CONFIG.businessEnd]: "End of the approved automated follow-up sending window (MYT)",
    [FOLLOW_UP_CONFIG.stopOnReply]: "Stop automated reminders immediately after a customer reply",
    [FOLLOW_UP_CONFIG.stopOnOptOut]: "Stop automated reminders after pause, refusal or opt-out",
    [FOLLOW_UP_CONFIG.informationIncomplete]: "Follow up when required application information is incomplete",
    [FOLLOW_UP_CONFIG.documentsIncomplete]: "Follow up when required documents are incomplete",
  };
  const values = {
    [FOLLOW_UP_CONFIG.enabled]: onOff(settings.enabled),
    [FOLLOW_UP_CONFIG.firstMinutes]: String(settings.firstMinutes),
    [FOLLOW_UP_CONFIG.secondMinutes]: String(settings.secondMinutes),
    [FOLLOW_UP_CONFIG.thirdMinutes]: String(settings.thirdMinutes),
    [FOLLOW_UP_CONFIG.finalMinutes]: String(settings.finalMinutes),
    [FOLLOW_UP_CONFIG.maxCount]: String(settings.maxCount),
    [FOLLOW_UP_CONFIG.businessHoursOnly]: onOff(settings.businessHoursOnly),
    [FOLLOW_UP_CONFIG.businessStart]: settings.businessStart,
    [FOLLOW_UP_CONFIG.businessEnd]: settings.businessEnd,
    [FOLLOW_UP_CONFIG.stopOnReply]: onOff(settings.stopOnReply),
    [FOLLOW_UP_CONFIG.stopOnOptOut]: onOff(settings.stopOnOptOut),
    [FOLLOW_UP_CONFIG.informationIncomplete]: onOff(settings.informationIncomplete),
    [FOLLOW_UP_CONFIG.documentsIncomplete]: onOff(settings.documentsIncomplete),
  };
  return Object.values(FOLLOW_UP_CONFIG).map((key) => ({
    "Config Key": key,
    "Config Value": values[key],
    Description: descriptions[key],
    Status: "Active",
    "Last Updated": updatedAt,
  }));
}

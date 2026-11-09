import fs from "node:fs";
import path from "node:path";

const projectRoot = path.resolve(new URL("..", import.meta.url).pathname);
const dataDir = path.join(projectRoot, "data");

const requiredCardFields = [
  "id",
  "titleAr",
  "titleEn",
  "categoryAr",
  "categoryEn",
  "summaryAr",
  "summaryEn",
  "promptAr",
  "promptEn",
  "variables",
  "stepsAr",
  "stepsEn",
  "limitationsAr",
  "limitationsEn",
  "image",
];

const issues = [];
const warnings = [];

function addIssue(code, message, cardId = null) {
  issues.push({ code, cardId, message });
}

function readCards(fileName) {
  const filePath = path.join(dataDir, fileName);
  if (!fs.existsSync(filePath)) {
    addIssue("missing_data_file", `Missing data file: ${fileName}`);
    return [];
  }
  try {
    const value = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (!Array.isArray(value)) {
      addIssue("invalid_data_shape", `${fileName} must contain a JSON array`);
      return [];
    }
    return value;
  } catch (error) {
    addIssue("invalid_json", `${fileName}: ${error.message}`);
    return [];
  }
}

function validateCards(cards, type) {
  const seenIds = new Set();
  for (const card of cards) {
    const id = card?.id ?? null;
    if (!id) addIssue("missing_id", `${type} card has no id`);
    if (id && seenIds.has(id)) addIssue("duplicate_id", `Duplicate id in ${type} data: ${id}`, id);
    if (id) seenIds.add(id);

    for (const field of requiredCardFields) {
      if (!(field in (card ?? {}))) addIssue("missing_field", `Missing field: ${field}`, id);
    }

    for (const field of ["titleAr", "titleEn", "categoryAr", "categoryEn", "summaryAr", "summaryEn", "promptAr", "promptEn", "limitationsAr", "limitationsEn"]) {
      if (typeof card?.[field] !== "string" || !card[field].trim()) {
        addIssue("invalid_field", `Field must be a non-empty string: ${field}`, id);
      }
    }

    for (const field of ["stepsAr", "stepsEn", "variables"]) {
      if (!Array.isArray(card?.[field])) addIssue("invalid_array", `Field must be an array: ${field}`, id);
    }

    if (typeof card?.image !== "string" || !card.image.startsWith("/")) {
      addIssue("invalid_asset_path", "Image path must be an absolute site path beginning with /", id);
    } else {
      const assetPath = path.join(projectRoot, card.image.replace(/^\/+/, ""));
      if (!fs.existsSync(assetPath)) addIssue("missing_asset", `Missing image asset: ${card.image}`, id);
    }

    const variables = Array.isArray(card?.variables) ? card.variables : [];
    const variableKeys = new Set();
    for (const variable of variables) {
      const key = variable?.key;
      if (!key || typeof key !== "string") {
        addIssue("invalid_variable", "Variable is missing a string key", id);
        continue;
      }
      if (variableKeys.has(key)) addIssue("duplicate_variable", `Duplicate variable key: ${key}`, id);
      variableKeys.add(key);
      for (const field of ["labelAr", "labelEn", "defaultValue"]) {
        if (!(field in variable)) addIssue("missing_variable_field", `Variable ${key} is missing ${field}`, id);
      }
      const options = Array.isArray(variable.options) ? variable.options : [];
      for (const option of options) {
        if (!option?.value || !option?.labelAr || !option?.labelEn) {
          addIssue("invalid_option", `Variable ${key} contains an incomplete option`, id);
        }
      }
      const placeholder = `{{${key}}}`;
      if (!card.promptAr.includes(placeholder) || !card.promptEn.includes(placeholder)) {
        addIssue("unbound_variable", `Variable ${key} is not used in both prompts`, id);
      }
    }

    const placeholdersAr = [...card.promptAr.matchAll(/{{([^{}]+)}}/g)].map((match) => match[1]);
    const placeholdersEn = [...card.promptEn.matchAll(/{{([^{}]+)}}/g)].map((match) => match[1]);
    for (const key of [...new Set([...placeholdersAr, ...placeholdersEn])]) {
      if (!variableKeys.has(key)) addIssue("unknown_placeholder", `Prompt placeholder has no variable definition: ${key}`, id);
    }

    if (card.mediaType === "video" || type === "video") {
      if (typeof card.basePromptAr !== "string" || typeof card.basePromptEn !== "string") {
        addIssue("missing_video_base_prompt", "Video card requires basePromptAr and basePromptEn", id);
      }
    }
  }
  return seenIds;
}

const imageCards = readCards("image-cards.json");
const videoCards = readCards("video-cards.json");
const imageIds = validateCards(imageCards, "image");
const videoIds = validateCards(videoCards, "video");
const allIds = new Set();
for (const id of [...imageIds, ...videoIds]) {
  if (allIds.has(id)) addIssue("duplicate_id_across_files", `Duplicate id across data files: ${id}`, id);
  allIds.add(id);
}

if (videoCards.length === 0) warnings.push("No video cards are defined yet; video-cards.json is intentionally empty.");

const result = {
  imageCards: imageCards.length,
  videoCards: videoCards.length,
  totalCards: imageCards.length + videoCards.length,
  uniqueIds: allIds.size,
  issueCount: issues.length,
  warningCount: warnings.length,
  issues,
  warnings,
};
console.log(JSON.stringify(result, null, 2));
if (issues.length > 0) process.exitCode = 1;

export const defaultDashboardTemplate =
  "{{name}}, ваш візит: завтра {{date}} о {{time}}.\nПідтвердити/змінити: {{confirm_url}}. Тел: {{clinic_phone}}";

const allowedPlaceholders = new Set([
  "clinic",
  "clinic_phone",
  "confirm_url",
  "date",
  "name",
  "time"
]);

const requiredPlaceholders = [
  "name",
  "date",
  "time",
  "confirm_url",
  "clinic_phone"
] as const;

const forbiddenContent = [
  /\b(diagnosis|diagnoses|clinical|procedure|treatment|prescription|medication)\b/iu,
  /(діагноз|клінічн|процедур|лікуван|рецепт|препарат|медикамент)/iu,
  /\b(payment|bank|banking|card|iban|cvv|pin|password|sms[-\s]?code|one[-\s]?time code)\b/iu,
  /(оплат|платіж|банк|карт|iban|cvv|pin|парол|sms[-\s]?код|смс[-\s]?код|одноразовий код)/iu
] as const;

const placeholderPattern = /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/gu;

export interface TemplateValidationResult {
  ok: boolean;
  errors: readonly string[];
  renderedSample: string;
  ucs2Length: number;
  segments: number;
}

export function validateDashboardTemplateBody(
  body: string
): TemplateValidationResult {
  const trimmed = body.trim();
  const errors: string[] = [];

  if (trimmed.length === 0) {
    errors.push("Шаблон не може бути порожнім.");
  }

  const normalized = trimmed.toLocaleLowerCase("uk-UA");
  for (const rule of forbiddenContent) {
    if (rule.test(normalized)) {
      errors.push("Шаблон має містити лише логістику запису.");
      break;
    }
  }

  const placeholders = extractPlaceholders(trimmed);
  for (const placeholder of placeholders) {
    if (!allowedPlaceholders.has(placeholder)) {
      errors.push(`Невідомий плейсхолдер: {{${placeholder}}}.`);
    }
  }

  for (const required of requiredPlaceholders) {
    if (!placeholders.has(required)) {
      errors.push(`Бракує плейсхолдера: {{${required}}}.`);
    }
  }

  const renderedSample = renderTemplateSample(trimmed);
  if (/\{\{/u.test(renderedSample)) {
    errors.push("У шаблоні лишився нерозпізнаний плейсхолдер.");
  }

  const ucs2Length = renderedSample.length;
  const segments = ucs2Length <= 70 ? 1 : Math.ceil(ucs2Length / 67);
  if (ucs2Length > 134) {
    errors.push("Шаблон перевищує бюджет у 2 SMS-сегменти.");
  }

  return {
    ok: errors.length === 0,
    errors,
    renderedSample,
    ucs2Length,
    segments
  };
}

function extractPlaceholders(body: string): Set<string> {
  const placeholders = new Set<string>();
  for (const match of body.matchAll(placeholderPattern)) {
    const [, placeholder] = match;
    if (placeholder !== undefined) {
      placeholders.add(placeholder.toLocaleLowerCase("en-US"));
    }
  }
  return placeholders;
}

function renderTemplateSample(body: string): string {
  return body
    .replaceAll(/\{\{\s*name\s*\}\}/giu, "Олено")
    .replaceAll(/\{\{\s*date\s*\}\}/giu, "18.06")
    .replaceAll(/\{\{\s*time\s*\}\}/giu, "14:30")
    .replaceAll(
      /\{\{\s*confirm_url\s*\}\}/giu,
      "https://r.dentino.com.ua/r/0123456789AbCdEfGhIjKl"
    )
    .replaceAll(/\{\{\s*clinic_phone\s*\}\}/giu, "+380679876111")
    .replaceAll(/\{\{\s*clinic\s*\}\}/giu, "Dentino");
}

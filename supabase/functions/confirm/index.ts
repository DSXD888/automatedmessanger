import { DEFAULT_CLINIC_PHONE } from "../_shared/templates.ts";
import { isCapabilityToken } from "../_shared/tokens.ts";

export const DEFAULT_CONFIRM_CLINIC_NAME = "Стоматологія Dentino, Львів";
export const DEFAULT_CONFIRM_CLINIC_PHONE_LABEL = "+380 67 987 6111";
export const CONFIRM_PAGE_MAX_GZIP_BYTES = 50 * 1024;

export interface ConfirmPageViewModel {
  token: string;
  patientDisplayName: string;
  appointmentDateLabel: string;
  appointmentTimeLabel: string;
  clinicName?: string;
  clinicPhone?: string;
  clinicPhoneLabel?: string;
  actionNonce?: string;
  optOutNonce?: string;
}

export interface ConfirmHttpRequest {
  method: string;
  url: string;
}

const confirmPageHeaders: HeadersInit = {
  "content-type": "text/html; charset=utf-8",
  "cache-control": "no-store, max-age=0",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "content-security-policy": [
    "default-src 'none'",
    "base-uri 'none'",
    "connect-src 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "img-src 'self' data:",
    "script-src 'none'",
    "style-src 'unsafe-inline'",
  ].join("; "),
};

const readMethodHandlers: Partial<Record<string, (token: string) => Response>> =
  {
    GET: (token: string) =>
      confirmPageResponse({
        token,
        patientDisplayName: "Олена К.",
        appointmentDateLabel: "18 червня",
        appointmentTimeLabel: "14:30",
      }),
    HEAD: () =>
      new Response(null, {
        status: 200,
        headers: confirmPageHeaders,
      }),
  };

export function renderConfirmPageChrome(model: ConfirmPageViewModel): string {
  const page = confirmPageModel(model);
  const tokenPath = `/r/${encodeURIComponent(page.token)}`;
  const actionNonce = page.actionNonce
    ? hiddenInput("nonce", page.actionNonce)
    : "";
  const optOutNonce = page.optOutNonce
    ? hiddenInput("nonce", page.optOutNonce)
    : "";

  return `<!doctype html>
<html lang="uk">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="robots" content="noindex,nofollow,noarchive">
  <title>Підтвердження запису | Dentino</title>
  <style>
    :root {
      color-scheme: light;
      --brand: #0A3576;
      --ink: #14213A;
      --muted: #51606F;
      --surface: #FFFFFF;
      --surface-warm: #FFFDFA;
      --border: #D7DCE3;
      --subtle: #EBEDEF;
      --focus: #0A3576;
      --button-height: 56px;
      --tap-target: 48px;
      --radius-card: 12px;
      --radius-button: 8px;
      --page-max: 480px;
      --font-stack: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", "Liberation Sans", sans-serif;
    }

    * {
      box-sizing: border-box;
    }

    html {
      -webkit-text-size-adjust: 100%;
      text-size-adjust: 100%;
      background: var(--surface-warm);
    }

    body {
      margin: 0;
      min-height: 100vh;
      color: var(--ink);
      background: var(--surface-warm);
      font-family: var(--font-stack);
      font-size: 18px;
      line-height: 1.5;
      letter-spacing: 0;
    }

    main {
      width: min(100%, var(--page-max));
      margin: 0 auto;
      padding: 24px 16px 32px;
    }

    .receipt {
      overflow-wrap: anywhere;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius-card);
      box-shadow: 0 1px 2px rgba(20, 33, 58, 0.06), 0 4px 12px rgba(20, 33, 58, 0.05);
    }

    .brand {
      display: flex;
      gap: 12px;
      align-items: center;
      padding: 24px 24px 18px;
      color: var(--brand);
      border-bottom: 1px solid var(--subtle);
    }

    .brand svg {
      flex: 0 0 auto;
      inline-size: 44px;
      block-size: 44px;
    }

    .wordmark {
      display: grid;
      gap: 1px;
    }

    .wordmark strong {
      font-size: 22px;
      line-height: 1.1;
      font-weight: 700;
    }

    .wordmark span {
      color: var(--muted);
      font-size: 14px;
      line-height: 1.3;
      font-weight: 700;
      text-transform: uppercase;
    }

    .content {
      display: grid;
      gap: 24px;
      padding: 24px;
    }

    .eyebrow {
      margin: 0 0 8px;
      color: var(--muted);
      font-size: 16px;
      font-weight: 700;
      text-transform: uppercase;
    }

    h1 {
      margin: 0;
      color: var(--ink);
      font-size: 28px;
      line-height: 1.2;
      font-weight: 700;
      letter-spacing: 0;
    }

    .appointment {
      display: grid;
      gap: 10px;
      padding-block-end: 4px;
    }

    .patient {
      margin: 0;
      color: var(--muted);
    }

    .when {
      margin: 0;
      color: var(--brand);
      font-size: 32px;
      line-height: 1.15;
      font-weight: 700;
      letter-spacing: 0;
    }

    .actions {
      display: grid;
      gap: 12px;
    }

    form {
      margin: 0;
    }

    .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 100%;
      min-height: var(--button-height);
      padding: 14px 18px;
      border: 2px solid var(--brand);
      border-radius: var(--radius-button);
      font: inherit;
      font-weight: 700;
      line-height: 1.2;
      text-align: center;
      text-decoration: none;
      cursor: pointer;
    }

    .btn-confirm {
      color: #FFFFFF;
      background: var(--brand);
    }

    .btn-cancel {
      color: var(--brand);
      background: #FFFFFF;
    }

    .info {
      display: grid;
      gap: 12px;
      padding-block-start: 2px;
    }

    .info p {
      margin: 0;
    }

    .muted {
      color: var(--muted);
    }

    .phone {
      display: inline-flex;
      align-items: center;
      min-height: var(--tap-target);
      color: var(--brand);
      font-weight: 700;
      text-decoration-thickness: 0.08em;
      text-underline-offset: 0.16em;
    }

    .footer {
      display: grid;
      gap: 8px;
      padding: 18px 24px 24px;
      border-top: 1px solid var(--subtle);
    }

    .link-button {
      min-height: var(--tap-target);
      padding: 8px 0;
      border: 0;
      color: var(--brand);
      background: transparent;
      font: inherit;
      font-weight: 700;
      text-align: left;
      text-decoration: underline;
      text-decoration-thickness: 0.08em;
      text-underline-offset: 0.16em;
      cursor: pointer;
    }

    a:focus-visible,
    button:focus-visible {
      outline: 3px solid var(--focus);
      outline-offset: 3px;
    }

    @media (max-width: 360px) {
      main {
        padding-inline: 12px;
      }

      .brand,
      .content,
      .footer {
        padding-inline: 18px;
      }

      .when {
        font-size: 30px;
      }
    }
  </style>
</head>
<body>
  <main>
    <section class="receipt" aria-labelledby="page-title">
      <header class="brand">
        ${inlineBrandMark()}
        <div class="wordmark">
          <strong>Dentino</strong>
          <span>Стоматологічна студія · Львів</span>
        </div>
      </header>

      <div class="content">
        <div class="appointment">
          <p class="eyebrow">${page.clinicName}</p>
          <h1 id="page-title">Ваш запис у Dentino</h1>
          <p class="patient">${page.patientDisplayName}</p>
          <p class="when">${page.appointmentDateLabel} о ${page.appointmentTimeLabel}</p>
        </div>

        <div class="actions" aria-label="Дії із записом">
          <form method="post" action="${tokenPath}/action">
            <input type="hidden" name="action" value="confirm">
            ${actionNonce}
            <button class="btn btn-confirm" type="submit">Підтвердити візит</button>
          </form>

          <form method="post" action="${tokenPath}/prepare">
            <input type="hidden" name="action" value="cancel">
            <button class="btn btn-cancel" type="submit">Потрібно перенести</button>
          </form>
        </div>

        <div class="info" aria-label="Довіра та контакт">
          <p>Ви отримали це SMS, бо у вас запланований запис у Dentino у Львові.</p>
          <p class="muted">Ми не просимо оплату, банківські дані, паролі або SMS-коди.</p>
          <p>Якщо потрібно перенести час, зателефонуйте адміністратору:
            <a class="phone" href="tel:${page.clinicPhone}">${page.clinicPhoneLabel}</a>
          </p>
        </div>
      </div>

      <footer class="footer">
        <form method="post" action="${tokenPath}/action">
          <input type="hidden" name="action" value="opt_out">
          ${optOutNonce}
          <button class="link-button" type="submit">Не надсилати SMS-нагадування</button>
        </form>
      </footer>
    </section>
  </main>
</body>
</html>`;
}

export function confirmPageResponse(
  model: ConfirmPageViewModel,
  init: ResponseInit = {},
): Response {
  const headers = new Headers(confirmPageHeaders);
  new Headers(init.headers).forEach((value, key) => headers.set(key, value));

  return new Response(renderConfirmPageChrome(model), {
    ...init,
    headers,
  });
}

export function handleConfirmRequest(request: ConfirmHttpRequest): Response {
  const handler = readMethodHandlers[request.method.toUpperCase()];
  if (!handler) {
    return methodNotAllowedResponse();
  }

  const token = tokenFromPath(new URL(request.url).pathname);
  if (token === null) {
    return new Response("Not Found", {
      status: 404,
      headers: confirmPageHeaders,
    });
  }

  return handler(token);
}

export async function gzipByteLength(value: string): Promise<number> {
  const stream = new Blob([value]).stream().pipeThrough(
    new CompressionStream("gzip"),
  );
  const buffer = await new Response(stream).arrayBuffer();
  return buffer.byteLength;
}

function confirmPageModel(
  model: ConfirmPageViewModel,
): Required<ConfirmPageViewModel> {
  if (!isCapabilityToken(model.token)) {
    throw new TypeError("Confirm page token must be 22-character base64url");
  }

  return {
    token: model.token,
    patientDisplayName: escapeHtml(model.patientDisplayName),
    appointmentDateLabel: escapeHtml(model.appointmentDateLabel),
    appointmentTimeLabel: escapeHtml(model.appointmentTimeLabel),
    clinicName: escapeHtml(model.clinicName ?? DEFAULT_CONFIRM_CLINIC_NAME),
    clinicPhone: escapeTelephone(model.clinicPhone ?? DEFAULT_CLINIC_PHONE),
    clinicPhoneLabel: escapeHtml(
      model.clinicPhoneLabel ?? DEFAULT_CONFIRM_CLINIC_PHONE_LABEL,
    ),
    actionNonce: model.actionNonce ?? "",
    optOutNonce: model.optOutNonce ?? "",
  };
}

function tokenFromPath(pathname: string): string | null {
  const parts = pathname.split("/").filter(Boolean);
  if (parts.length !== 2 || parts[0] !== "r") {
    return null;
  }

  const token = parts[1];
  return isCapabilityToken(token) ? token : null;
}

function methodNotAllowedResponse(): Response {
  return new Response("Method Not Allowed", {
    status: 405,
    headers: {
      ...confirmPageHeaders,
      allow: "GET, HEAD",
    },
  });
}

function hiddenInput(name: string, value: string): string {
  return `<input type="hidden" name="${escapeAttribute(name)}" value="${
    escapeAttribute(value)
  }">`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replaceAll("`", "&#96;");
}

function escapeTelephone(value: string): string {
  const trimmed = value.trim();
  if (!/^\+[1-9][0-9]{7,14}$/u.test(trimmed)) {
    throw new TypeError("Clinic phone must be an E.164 tel value");
  }
  return trimmed;
}

function inlineBrandMark(): string {
  return `<svg viewBox="0 0 44 44" role="img" aria-label="Dentino">
    <path fill="currentColor" d="M21.9 5.5c-7.2 0-12.3 4-12.3 10.5 0 4.3 1.7 7.5 2.9 11.5 1 3.4 1.4 11 4.5 11 2.6 0 2.2-7.2 3.8-10.2.7-1.4 3.2-1.4 4 0 1.6 3 1.2 10.2 3.8 10.2 3.1 0 3.5-7.6 4.5-11 1.2-4 2.9-7.2 2.9-11.5 0-6.5-5.1-10.5-12.3-10.5-1.2 0-2 .1-2.8 .1z"/>
  </svg>`;
}

if (import.meta.main) {
  Deno.serve(handleConfirmRequest);
}

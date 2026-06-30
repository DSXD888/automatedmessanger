import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  ExternalLink,
  FileDown,
  Send,
  ShieldCheck,
  TrendingUp,
} from "lucide-react";
import Link from "next/link";
import {
  boardRows,
  countRows,
  lastRunRecap,
  modeBanner,
  operationalReadiness,
  staleTrustPanel,
  trustPanel,
  valueMetrics,
} from "../lib/dashboard-data";
import { formatPercent } from "../lib/rollups";

const stateLabel = new Map([
  ["confirmed", "Підтверджено"],
  ["cancelled", "Скасовано"],
  ["no_reply", "Немає відповіді"],
  ["skipped", "Пропущено"],
  ["failed", "Проблема запису"],
  ["send_unknown", "Невідоме надсилання"],
  ["held_cancel", "Утримано запобіжником"],
  ["superseded", "Змінено персоналом"],
]);

const trustReasonLabel = new Map([
  ["all_accounted", "Усі поточні записи закриті без винятків"],
  [
    "staff_work_skips",
    "Є відомі винятки для персоналу, але немає червоних боргів",
  ],
  [
    "red_problem_counts",
    "Є невирішені помилки, невідомі надсилання або прогалини",
  ],
  ["waiting_for_current_day", "Поточний Kyiv target date ще очікує запуск"],
  ["stale_current_day", "Поточний день відсутній після 12:30 за Києвом"],
]);

const baselineLabel = new Map([
  ["noShowRate", "no-show"],
  ["emptySlotRate", "empty-slot"],
  ["manualCallMinutes", "manual-call minutes"],
  ["slotContributionUah", "slot contribution"],
]);

type DashboardPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function DashboardPage(
  { searchParams }: DashboardPageProps,
) {
  const params = await searchParams;
  const fixture = Array.isArray(params?.fixture)
    ? params?.fixture[0]
    : params?.fixture;
  const activeTrustPanel = fixture === "stale-current"
    ? staleTrustPanel
    : trustPanel;
  const staffMinutesValue =
    typeof valueMetrics.estimatedStaffMinutes === "number"
      ? `${valueMetrics.estimatedStaffMinutes} хв`
      : "missing";

  return (
    <main className="shell">
      <Topbar key="topbar" />
      <ModeBanner key="mode-banner" />

      <header className="pageHeader">
        <div>
          <p className="eyebrow">Операційна панель</p>
          <h1>Записи на завтра</h1>
        </div>
        <form
          action="/run-reminders"
          method="post"
          data-testid="manual-run-form"
        >
          <input key="trigger" type="hidden" name="trigger" value="manual" />
          <input
            key="pass-kind"
            type="hidden"
            name="pass_kind"
            value="manual"
          />
          <button className="button" type="submit">
            <Send key="send-icon" size={18} aria-hidden="true" />
            Надіслати нагадування
          </button>
        </form>
      </header>

      <section aria-labelledby="recap-title">
        <h2 id="recap-title">Останній запуск</h2>
        <div className="recap" data-testid="last-run-recap">
          <div className="recapLead">
            <strong>
              <Clock3 key="recap-clock" size={20} aria-hidden="true" />
              {lastRunRecap.targetDateLabel}
            </strong>
            <small>
              {lastRunRecap.passKind} · {lastRunRecap.kyivTimestamp} · health:
              {" "}
              {lastRunRecap.health}
            </small>
            <small>
              Heartbeat success:{" "}
              {lastRunRecap.successHeartbeatSent ? "sent" : "not sent"}
            </small>
          </div>
          <div className="recapStat">
            <small>Опрацьовано</small>
            <strong>{lastRunRecap.handled}</strong>
          </div>
          <div className="recapStat problem">
            <small>Проблеми</small>
            <strong>{lastRunRecap.problems}</strong>
          </div>
          <div className="recapStat">
            <small>Відповіді</small>
            <strong>{lastRunRecap.responses}</strong>
          </div>
          <div className="recapStat">
            <small>Потрібна увага</small>
            <strong>
              {boardRows.filter((row) => row.needsAttention).length}
            </strong>
          </div>
        </div>
      </section>

      <section
        aria-labelledby="trust-title"
        className={`panelBand trust-${activeTrustPanel.health}`}
        data-testid="trust-panel"
      >
        <div className="panelHeader">
          <div>
            <p className="eyebrow">Операційна довіра</p>
            <h2 id="trust-title">4-числова перевірка запуску</h2>
          </div>
          <span className={`statusBadge ${activeTrustPanel.health}`}>
            <ShieldCheck key="trust-state" size={18} aria-hidden="true" />
            {activeTrustPanel.health.toUpperCase()}
          </span>
        </div>
        <p className="panelLead">
          {trustReasonLabel.get(activeTrustPanel.reason)}
        </p>
        <div className="metricGrid">
          <MetricTile
            key="crm-remindable"
            label="CRM remindable"
            value={activeTrustPanel.numbers.clinicRemindable}
          />
          <MetricTile
            key="sms-handled"
            label="SMS handled"
            value={activeTrustPanel.numbers.smsHandled}
          />
          <MetricTile
            key="problems"
            label="Problems"
            value={activeTrustPanel.numbers.problems}
          />
          <MetricTile
            key="responses"
            label="Responses"
            value={activeTrustPanel.numbers.responses}
          />
        </div>
      </section>

      <section
        aria-labelledby="value-title"
        className="panelBand valuePanel"
        data-testid="value-panel"
      >
        <div className="panelHeader">
          <div>
            <p className="eyebrow">Метрики власника</p>
            <h2 id="value-title">Економія часу без змішування з trust</h2>
          </div>
          <span className={`statusBadge ${valueMetrics.valueSignal}`}>
            <TrendingUp key="value-state" size={18} aria-hidden="true" />
            {valueMetrics.valueSignal}
          </span>
        </div>
        <div className="valueGrid">
          <MetricTile
            key="action-rate"
            label="Action rate"
            value={formatPercent(valueMetrics.actionRate)}
            note="nonce-backed actions ÷ delivered/resolved"
          />
          <MetricTile
            key="staff-minutes"
            label="Staff minutes"
            value={staffMinutesValue}
            note={valueMetrics.staffMinutesTargetMet
              ? "≤30 хв target met"
              : "watch daily load"}
          />
          <div className="metricTile wide">
            <span>Template / send-hour segments</span>
            <strong>
              {valueMetrics.segments.map((segment) =>
                `${segment.templateKey} ${segment.sendHour}:00 ${
                  formatPercent(segment.actionRate)
                }`
              ).join(" · ")}
            </strong>
          </div>
          <div className="metricTile wide">
            <span>Missing owner baselines</span>
            <strong>
              {valueMetrics.missingBaselines.map((key) =>
                baselineLabel.get(key) ?? key
              ).join(" · ")}
            </strong>
          </div>
        </div>
      </section>

      <section
        aria-labelledby="ops-title"
        className="panelBand opsPanel"
        data-testid="ops-readiness"
      >
        <div className="panelHeader">
          <div>
            <p className="eyebrow">Готовність до go-live</p>
            <h2 id="ops-title">Runbooks та баланс</h2>
          </div>
          <span className={`statusBadge ${operationalReadiness.balanceStatus}`}>
            <AlertTriangle key="ops-state" size={18} aria-hidden="true" />
            {operationalReadiness.balanceStatus}
          </span>
        </div>
        <p className="panelLead">{operationalReadiness.balanceEvidence}</p>
        <div className="opsGrid">
          {operationalReadiness.items.map((item) => (
            <article className="opsItem" key={item.key}>
              <h3>
                {item.status === "ready"
                  ? <CheckCircle2 key="ready" size={18} aria-hidden="true" />
                  : <AlertTriangle key="watch" size={18} aria-hidden="true" />}
                {item.title}
              </h3>
              <p>{item.evidence}</p>
              <small>{item.staffAction}</small>
            </article>
          ))}
        </div>
      </section>

      <section aria-labelledby="board-title">
        <h2 id="board-title">Статус-борд</h2>
        <div className="chips" aria-label="Фільтри статусу">
          <span className="chip active">Усі {boardRows.length}</span>
          <span className="chip">Підтверджено {countRows("confirmed")}</span>
          <span className="chip">Скасовано {countRows("cancelled")}</span>
          <span className="chip">Немає відповіді {countRows("no_reply")}</span>
          <span className="chip">
            Потрібна увага{" "}
            {boardRows.filter((row) => row.needsAttention).length}
          </span>
        </div>

        <div className="tableWrap">
          <table data-testid="board-table">
            <thead>
              <tr>
                <th scope="col">Час</th>
                <th scope="col">Пацієнт</th>
                <th scope="col">Надсилання</th>
                <th scope="col">Відповідь</th>
                <th scope="col">Черга</th>
                <th scope="col">Дія</th>
              </tr>
            </thead>
            <tbody>
              {boardRows.map((row) => (
                <tr key={row.id}>
                  <td className="time">{row.time}</td>
                  <td>
                    <span className="patient">{row.patient}</span>
                    <span className="patientMeta">
                      ···{row.phoneLast4} · ID {row.visitId}
                    </span>
                  </td>
                  <td>{row.sendState}</td>
                  <td>
                    <span className={`pill ${row.responseState}`}>
                      {stateLabel.get(row.responseState)}
                    </span>
                  </td>
                  <td>{row.staffState}</td>
                  <td>
                    <Link
                      className="navLink"
                      href="/patients?needs_attention=1"
                    >
                      <ExternalLink
                        key={`open-${row.id}`}
                        size={16}
                        aria-hidden="true"
                      />
                      {row.actionLabel}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="workGrid" aria-labelledby="work-title">
        <div>
          <h2 id="work-title">Потребує уваги</h2>
          <div className="workList">
            {boardRows.filter((row) => row.needsAttention).slice(0, 4).map((
              row,
            ) => (
              <div className="workItem" key={row.id}>
                <span
                  className={`workIcon ${
                    row.staffState === "writeback_attention" ? "danger" : ""
                  }`}
                >
                  <AlertTriangle
                    key={`attention-${row.id}`}
                    size={18}
                    aria-hidden="true"
                  />
                </span>
                <div>
                  <h3>{stateLabel.get(row.responseState)}</h3>
                  <p>
                    {row.patient} · {row.time} · ID {row.visitId}
                  </p>
                </div>
                <Link
                  className="button secondary"
                  href="/patients?needs_attention=1"
                >
                  Відкрити
                </Link>
              </div>
            ))}
          </div>
        </div>

        <aside className="sidePanel" aria-labelledby="call-title">
          <h2 id="call-title">Черга дзвінків</h2>
          <p>Після денного догону · підтверджені за посиланням виключені</p>
          {boardRows.filter((row) => row.responseState === "no_reply").map((
            row,
          ) => (
            <div className="callRow" key={row.id}>
              <span>
                {row.time} · {row.patient} · ···{row.phoneLast4}
              </span>
              <span className="pill no_reply">No reply</span>
            </div>
          ))}
          <button className="button secondary" type="button">
            <FileDown key="export-calls" size={18} aria-hidden="true" />
            Експортувати список
          </button>
        </aside>
      </section>

      <section aria-labelledby="green-rule">
        <h2 id="green-rule">Контроль дзвінків</h2>
        <div className="validation">
          <strong>
            <CheckCircle2 key="call-rule" size={18} aria-hidden="true" />{" "}
            Пацієнти, які підтвердили запис за посиланням, не входять у звичайну
            чергу дзвінків.
          </strong>
        </div>
      </section>
    </main>
  );
}

function MetricTile({
  label,
  value,
  note,
}: {
  label: string;
  value: number | string;
  note?: string;
}) {
  return (
    <div className="metricTile">
      <span>{label}</span>
      <strong>{value}</strong>
      {note ? <small>{note}</small> : null}
    </div>
  );
}

function Topbar() {
  return (
    <nav className="topbar" aria-label="Dentino dashboard">
      <Link className="brandLockup" href="/">
        <span className="brandMark" aria-hidden="true">D</span>
        <span>
          <span className="brandName">DENTINO</span>
          <span className="brandSub">ПАНЕЛЬ НАГАДУВАНЬ</span>
        </span>
      </Link>
      <div className="navLinks">
        <Link className="navLink" href="/patients?needs_attention=1">
          Пацієнти
        </Link>
        <Link className="navLink" href="/templates">
          Шаблони
        </Link>
      </div>
    </nav>
  );
}

function ModeBanner() {
  return (
    <section
      className={`modeBanner ${modeBanner.live ? "live" : "guarded"}`}
      data-testid="mode-banner"
    >
      <strong>{modeBanner.mode}</strong>
      <span>
        SEND_MODE={modeBanner.sendMode}{" "}
        · CRM_WRITE_MODE={modeBanner.crmWriteMode}
      </span>
      <span>{modeBanner.text}</span>
    </section>
  );
}

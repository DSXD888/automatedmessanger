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
  countRows,
  type DashboardPageData,
  loadDashboardData,
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

const DashboardPage = async (
  { searchParams }: DashboardPageProps,
) => {
  const params = await searchParams;
  const fixture = Array.isArray(params?.fixture)
    ? params?.fixture[0]
    : params?.fixture;
  const data = await loadDashboardData({
    fixture: fixture === "stale-current" ? "stale-current" : undefined,
  });
  const staffMinutesValue =
    typeof data.valueMetrics.estimatedStaffMinutes === "number"
      ? `${data.valueMetrics.estimatedStaffMinutes} хв`
      : "missing";

  return (
    <main className="shell">
      <Topbar key="topbar" />
      <ModeBanner key="mode-banner" modeBanner={data.modeBanner} />

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
              {data.lastRunRecap.targetDateLabel}
            </strong>
            <small>
              {data.lastRunRecap.passKind} · {data.lastRunRecap.kyivTimestamp}
              {" "}
              · health: {data.lastRunRecap.health}
            </small>
            <small>
              Heartbeat success:{" "}
              {data.lastRunRecap.successHeartbeatSent ? "sent" : "not sent"}
            </small>
          </div>
          <div className="recapStat">
            <small>Опрацьовано</small>
            <strong>{data.lastRunRecap.handled}</strong>
          </div>
          <div className="recapStat problem">
            <small>Проблеми</small>
            <strong>{data.lastRunRecap.problems}</strong>
          </div>
          <div className="recapStat">
            <small>Відповіді</small>
            <strong>{data.lastRunRecap.responses}</strong>
          </div>
          <div className="recapStat">
            <small>Потрібна увага</small>
            <strong>{data.needsAttentionRows.length}</strong>
          </div>
        </div>
      </section>

      <section
        aria-labelledby="trust-title"
        className={`panelBand trust-${data.trustPanel.health}`}
        data-testid="trust-panel"
      >
        <div className="panelHeader">
          <div>
            <p className="eyebrow">Операційна довіра</p>
            <h2 id="trust-title">4-числова перевірка запуску</h2>
          </div>
          <span className={`statusBadge ${data.trustPanel.health}`}>
            <ShieldCheck key="trust-state" size={18} aria-hidden="true" />
            {data.trustPanel.health.toUpperCase()}
          </span>
        </div>
        <p className="panelLead">
          {trustReasonLabel.get(data.trustPanel.reason)}
        </p>
        <div className="metricGrid">
          <MetricTile
            key="crm-remindable"
            label="CRM remindable"
            value={data.trustPanel.numbers.clinicRemindable}
          />
          <MetricTile
            key="sms-handled"
            label="SMS handled"
            value={data.trustPanel.numbers.smsHandled}
          />
          <MetricTile
            key="problems"
            label="Problems"
            value={data.trustPanel.numbers.problems}
          />
          <MetricTile
            key="responses"
            label="Responses"
            value={data.trustPanel.numbers.responses}
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
          <span className={`statusBadge ${data.valueMetrics.valueSignal}`}>
            <TrendingUp key="value-state" size={18} aria-hidden="true" />
            {data.valueMetrics.valueSignal}
          </span>
        </div>
        <div className="valueGrid">
          <MetricTile
            key="action-rate"
            label="Action rate"
            value={formatPercent(data.valueMetrics.actionRate)}
            note="nonce-backed actions ÷ delivered/resolved"
          />
          <MetricTile
            key="staff-minutes"
            label="Staff minutes"
            value={staffMinutesValue}
            note={data.valueMetrics.staffMinutesTargetMet
              ? "≤30 хв target met"
              : "watch daily load"}
          />
          <div className="metricTile wide">
            <span>Template / send-hour segments</span>
            <strong>
              {data.valueMetrics.segments.map((segment) =>
                `${segment.templateKey} ${segment.sendHour}:00 ${
                  formatPercent(segment.actionRate)
                }`
              ).join(" · ")}
            </strong>
          </div>
          <div className="metricTile wide">
            <span>Missing owner baselines</span>
            <strong>
              {data.valueMetrics.missingBaselines.map((key) =>
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
          <span
            className={`statusBadge ${data.operationalReadiness.balanceStatus}`}
          >
            <AlertTriangle key="ops-state" size={18} aria-hidden="true" />
            {data.operationalReadiness.balanceStatus}
          </span>
        </div>
        <p className="panelLead">
          {data.operationalReadiness.balanceEvidence}
        </p>
        <div className="opsGrid">
          {data.operationalReadiness.items.map((item) => (
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
          <span className="chip active">Усі {data.boardRows.length}</span>
          <span className="chip">
            Підтверджено {countRows(data.boardRows, "confirmed")}
          </span>
          <span className="chip">
            Скасовано {countRows(data.boardRows, "cancelled")}
          </span>
          <span className="chip">
            Немає відповіді {countRows(data.boardRows, "no_reply")}
          </span>
          <span className="chip">
            Потрібна увага {data.needsAttentionRows.length}
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
              {data.boardRows.map((row) => (
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
            {data.needsAttentionRows.slice(0, 4).map((row) => (
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
          {data.callListRows.map((row) => (
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
};

export default DashboardPage;

const MetricTile = ({
  label,
  value,
  note,
}: {
  label: string;
  value: number | string;
  note?: string;
}) => {
  return (
    <div className="metricTile">
      <span>{label}</span>
      <strong>{value}</strong>
      {note ? <small>{note}</small> : null}
    </div>
  );
};

const Topbar = () => {
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
};

const ModeBanner = ({
  modeBanner,
}: {
  modeBanner: DashboardPageData["modeBanner"];
}) => {
  const modeClass = modeBanner.mode === "INVALID"
    ? "invalid"
    : modeBanner.live
    ? "live"
    : "guarded";

  return (
    <section
      className={`modeBanner ${modeClass}`}
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
};

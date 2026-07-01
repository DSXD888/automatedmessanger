import {
  AlertTriangle,
  CheckCircle2,
  FileDown,
  PhoneCall,
  ShieldCheck,
} from "lucide-react";
import Link from "next/link";
import { loadPatientsData } from "../../lib/dashboard-data";

const queueTitles: Record<string, string> = {
  blocked_allowlist: "Заблоковано allowlist",
  held_cancel: "Утримано запобіжником",
  no_phone: "Немає номера телефону",
  send_unknown: "Невідомий статус надсилання",
  stale_or_moved: "Запис змінився після SMS",
  writeback_attention: "Скасування: помилка запису в CRM",
};

const PatientsPage = async () => {
  const { callListRows, needsAttentionRows } = await loadPatientsData();

  return (
    <main className="shell">
      <nav className="topbar" aria-label="Dentino dashboard">
        <Link className="brandLockup" href="/">
          <span className="brandMark" aria-hidden="true">D</span>
          <span>
            <span className="brandName">DENTINO</span>
            <span className="brandSub">ПАЦІЄНТИ</span>
          </span>
        </Link>
        <div className="navLinks">
          <Link className="navLink" href="/">Борд</Link>
          <Link className="navLink" href="/templates">Шаблони</Link>
        </div>
      </nav>

      <header className="pageHeader">
        <div>
          <p className="eyebrow">Потребує уваги</p>
          <h1>Робочі черги персоналу</h1>
        </div>
        <button className="button secondary" type="button">
          <FileDown key="export-calls" size={18} aria-hidden="true" />
          Експортувати дзвінки
        </button>
      </header>

      <section className="workGrid" aria-labelledby="attention-title">
        <div>
          <h2 id="attention-title">Пріоритети</h2>
          <div className="workList" data-testid="needs-attention-list">
            {needsAttentionRows.map((row) => (
              <article className="workItem" key={row.id}>
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
                  <h3>{queueTitle(row.staffState)}</h3>
                  <p>
                    {row.patient} · {row.time} · ···{row.phoneLast4} · ID{" "}
                    {row.visitId}
                  </p>
                </div>
                <button className="button secondary" type="button">
                  {row.actionLabel}
                </button>
              </article>
            ))}
          </div>
        </div>

        <aside className="sidePanel" aria-labelledby="held-title">
          <h2 id="held-title">Утримані скасування</h2>
          <p>Перевірка в ClinicCards перед записом або закриттям без запису.</p>
          <form
            className="formStack"
            action="/held-cancels/resolve"
            method="post"
            data-rpc="resolve_held_cancels"
            data-testid="held-cancel-form"
          >
            <input
              key="target-date"
              type="hidden"
              name="target_date"
              value="2026-06-19"
            />
            <input
              key="message-ids"
              type="hidden"
              name="message_ids"
              value="709"
            />
            <input
              key="revalidation"
              aria-label="Revalidation evidence"
              name="revalidation"
              defaultValue='{"709":{"appointment_fingerprint":"checked-in-cliniccards"}}'
            />
            <button
              className="button danger"
              name="resolution"
              value="staff_closed_no_write"
            >
              <ShieldCheck key="held-close" size={18} aria-hidden="true" />
              Закрити без запису
            </button>
            <button
              className="button secondary"
              name="resolution"
              value="bulk_approved_safe"
            >
              <ShieldCheck key="held-approve" size={18} aria-hidden="true" />
              Bulk approve safe
            </button>
          </form>
        </aside>
      </section>

      <section className="workGrid" aria-labelledby="calls-title">
        <div>
          <h2 id="calls-title">Немає відповіді</h2>
          <div className="workList" data-testid="call-list">
            {callListRows.map((row) => (
              <article className="workItem" key={row.id}>
                <span className="workIcon">
                  <PhoneCall
                    key={`call-${row.id}`}
                    size={18}
                    aria-hidden="true"
                  />
                </span>
                <div>
                  <h3>
                    {row.time} · {row.patient}
                  </h3>
                  <p>
                    ···{row.phoneLast4} · ID {row.visitId}
                  </p>
                </div>
                <select
                  aria-label={`Причина для ${row.patient}`}
                  defaultValue=""
                >
                  <option value="" disabled>Причина</option>
                  <option value="did_not_see_sms">Не бачив SMS</option>
                  <option value="distrusts_link">Не довіряє посиланню</option>
                  <option value="prefers_call">Хоче дзвінок</option>
                  <option value="could_not_reach">Не додзвонились</option>
                </select>
              </article>
            ))}
          </div>
        </div>

        <aside className="sidePanel">
          <h2>Правило черги</h2>
          <p>
            Підтверджені через посилання пацієнти не потрапляють у звичайний
            список дзвінків.
          </p>
          <div className="validation">
            <strong>
              <CheckCircle2 key="call-rule" size={18} aria-hidden="true" />{" "}
              0 підтверджених через посилання у цій черзі
            </strong>
          </div>
        </aside>
      </section>
    </main>
  );
};

export default PatientsPage;

const queueTitle = (staffState: string): string => {
  return queueTitles[staffState] ?? "Потрібна дія";
};

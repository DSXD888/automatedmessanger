import { Save, ShieldCheck } from "lucide-react";
import Link from "next/link";
import {
  defaultDashboardTemplate,
  validateDashboardTemplateBody,
} from "../../lib/template-validation";

const validation = validateDashboardTemplateBody(defaultDashboardTemplate);

export default function TemplatesPage() {
  return (
    <main className="shell">
      <nav className="topbar" aria-label="Dentino dashboard">
        <Link className="brandLockup" href="/">
          <span className="brandMark" aria-hidden="true">D</span>
          <span>
            <span className="brandName">DENTINO</span>
            <span className="brandSub">ШАБЛОНИ</span>
          </span>
        </Link>
        <div className="navLinks">
          <Link className="navLink" href="/">Борд</Link>
          <Link className="navLink" href="/patients?needs_attention=1">
            Пацієнти
          </Link>
        </div>
      </nav>

      <header className="pageHeader">
        <div>
          <p className="eyebrow">Редактор SMS</p>
          <h1>Активний шаблон нагадування</h1>
        </div>
      </header>

      <section className="workGrid" aria-labelledby="template-title">
        <form
          className="editorPanel formStack"
          action="/templates/1"
          method="post"
          data-method="put"
          data-rpc="update_message_template"
          data-testid="template-form"
        >
          <h2 id="template-title">Версія 1 · Dentino · uk</h2>
          <input key="template-id" type="hidden" name="template_id" value="1" />
          <label>
            Текст SMS
            <textarea
              key="template-body"
              name="body"
              defaultValue={defaultDashboardTemplate}
            />
          </label>
          <div
            className={`validation ${validation.ok ? "" : "invalid"}`}
            data-testid="template-validation"
          >
            <strong>
              <ShieldCheck key="template-valid" size={18} aria-hidden="true" />
              {validation.ok ? "Шаблон проходить перевірку" : "Потрібні зміни"}
            </strong>
            <span>
              {validation.ucs2Length} символів · {validation.segments}{" "}
              SMS-сегменти
            </span>
            {validation.errors.map((error) => <span key={error}>{error}</span>)}
          </div>
          <button className="button" type="submit">
            <Save key="template-save" size={18} aria-hidden="true" />
            Зберегти активну версію
          </button>
        </form>

        <aside className="sidePanel" aria-labelledby="preview-title">
          <h2 id="preview-title">Попередній перегляд</h2>
          <p className="preview">{validation.renderedSample}</p>
        </aside>
      </section>
    </main>
  );
}

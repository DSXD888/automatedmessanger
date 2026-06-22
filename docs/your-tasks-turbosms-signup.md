# TurboSMS — self-service signup guide (owner task A1)

> Companion to `docs/your-tasks.md` task **A1**. This replaces the old "what to say on the Kyivstar call" guide — TurboSMS is **self-service, no sales call**. EN first, **Українською нижче**.
> **Don't paste API tokens or secrets into chat** — hand them over per task **C2** (into Supabase Vault / `.env`).

---

## English — step by step (~10 business days, mostly waiting on the alpha-name register)

1. **Create the account.** Go to **turbosms.ua** → register (email + phone). No phone call, no contract negotiation.
2. **Verify the business.** Upload the clinic's **ЄДРПОУ** (if a ТОВ) or **ІПН / РНОКПП** (if a ФОП). **If you are a ФОП you also need a Vodafone guarantee letter** — TurboSMS will tell you the template; ТОВ does not need it.
3. **Submit the alpha sender name `DentinoLviv`** (exactly 11 characters, **no space**) into the **national-names register**. This is the long pole (~**10 business days**).
   - ✅ **Verify gate 2:** ask/confirm that **one** submission covers **all three operators — Kyivstar, Vodafone, lifecell** (the national register), not just one.
4. **Register the transactional template** (cabinet → **«Шаблони»** → type **«Транзакційний»**). Paste the approved Ukrainian reminder body. The link must be a **static prefix `https://r.dentino.com.ua/r/`** + a **variable token**, and the template **must not start or end with a variable** (ours ends on the static phone line — fine).
   - ⚠️ **Verify gate 1 (most important):** get **written confirmation from a TurboSMS manager** that this **link-bearing template counts as transactional** — *not* reclassified to the pricier *advertising* rate.
   - ⚠️ **Do not edit a template after approval** — editing re-classifies it as advertising. Finalize the copy first (I'll send you the final wording, task B1).
5. **Medical-content sign-off.** Email TurboSMS the template(s) for **prior written medical-content approval** (required for clinic messages).
6. **Top up a small balance** (1 UAH minimum is enough to start; there's **no SMS monthly floor**). You also get **10 free test SMS**.
7. **Issue the API token + set up the delivery-receipt (DLR) webhook secret** in the cabinet. **Hand both to me (task C2)** — token + webhook secret — into Supabase Vault. Don't send them in chat.
8. **The other two things to verify** (at signup or during the C4 seed test — not blockers):
   - ⚠️ **Gate 3:** delivery to **ported / MNP** numbers (a number moved between operators).
   - ⚠️ **Gate 4:** the **per-operator price** within the ~**0.98–1.29 ₴/segment** tier (budget at the high end).

*If any gate fails, the fallback route is **AlphaSMS** (alphasms.ua) — same alpha name, same approach; I swap it in code with no spine change.*

---

## Українською — покроково (~10 робочих днів, переважно очікування реєстрації альфа-імені)

1. **Створіть акаунт.** Зайдіть на **turbosms.ua** → реєстрація (email + телефон). Без дзвінків і переговорів — все самостійно онлайн.
2. **Підтвердіть бізнес.** Завантажте **ЄДРПОУ** клініки (якщо ТОВ) або **ІПН / РНОКПП** (якщо ФОП). **Якщо ви ФОП — потрібен ще гарантійний лист для Vodafone** (TurboSMS дасть шаблон); для ТОВ він не потрібен.
3. **Подайте альфа-ім'я відправника `DentinoLviv`** (рівно 11 символів, **без пробілу**) до **національного реєстру імен**. Це найдовший етап (~**10 робочих днів**).
   - ✅ **Перевірка 2:** уточніть, що **одна** заявка покриває **всіх трьох операторів — Kyivstar, Vodafone, lifecell** (національний реєстр), а не лише одного.
4. **Зареєструйте транзакційний шаблон** (кабінет → **«Шаблони»** → тип **«Транзакційний»**). Вставте погоджений український текст нагадування. Посилання має бути **статичним префіксом `https://r.dentino.com.ua/r/`** + **змінний токен**, і шаблон **не може починатися або закінчуватися змінною** (наш закінчується статичним рядком з телефоном — це ок).
   - ⚠️ **Перевірка 1 (найважливіша):** отримайте **письмове підтвердження від менеджера TurboSMS**, що цей шаблон **із посиланням вважається транзакційним**, а *не* перекласифікується на дорожчий *рекламний* тариф.
   - ⚠️ **Не редагуйте шаблон після затвердження** — редагування перекласифікує його на рекламний. Спершу узгодьте остаточний текст (надішлю вам, завдання B1).
5. **Погодження медичного контенту.** Надішліть шаблон(и) на email TurboSMS для **попереднього письмового погодження медичного контенту** (обов'язково для повідомлень клініки).
6. **Поповніть невеликий баланс** (достатньо мінімуму 1 грн; **немає щомісячного мінімуму на SMS**). Також ви отримаєте **10 безкоштовних тестових SMS**.
7. **Створіть API-токен + налаштуйте секрет вебхука для звітів про доставку (DLR)** у кабінеті. **Передайте мені (завдання C2)** — токен + секрет вебхука — у Supabase Vault. Не надсилайте їх у чат.
8. **Ще дві речі для перевірки** (під час реєстрації або в тесті C4 — не блокують роботу):
   - ⚠️ **Перевірка 3:** доставка на **перенесені / MNP** номери (номер, перенесений між операторами).
   - ⚠️ **Перевірка 4:** **ціна по кожному оператору** в межах тарифу ~**0.98–1.29 ₴/сегмент** (закладаємо по верхній межі).

*Якщо якась перевірка не пройде — резервний маршрут **AlphaSMS** (alphasms.ua): те саме альфа-ім'я, той самий підхід; я перемикаю його в коді без зміни архітектури.*

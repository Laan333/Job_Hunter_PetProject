# JobHunter — дашборд поиска работы

Full-stack приложение для сбора вакансий (hh.ru), хранения в PostgreSQL, анализа совпадения с резюме через LLM (OpenAI / GigaChat), уведомлений и Telegram. Веб-интерфейс на Next.js, API на FastAPI, обратный прокси — nginx в Docker.

## Архитектура

Трафик снаружи идёт в **nginx** (статика и прокси). **Next.js** (`web`) обращается к **FastAPI** (`api`) по внутренней сети Compose; API использует **PostgreSQL** (`db`). Плановые задачи (синк hh.ru, пакетный матчинг, автоанализ) выполняются в процессе API через **APScheduler**.

```text
Браузер → nginx:HTTP(S) → Next.js → FastAPI → PostgreSQL
                              ↑______________|
                         (внутренняя сеть Docker)
```

## Возможности

- Синхронизация вакансий по сохранённым поискам (публичное API hh.ru), TTL и логи синка
- Формат работы в поисковых запросах (`remote`, `fullDay`, `shift`, `flexible`, `flyInFlyOut`)
- Резюме (несколько записей через API), редактирование в UI, модалка полного текста; загрузка файла **`.txt` / `.pdf` / `.docx`** с извлечением текста в API
- Анализ вакансии vs резюме (structured JSON, таксономия категорий v15), сопроводительные письма; ответы на скрининговые вопросы (LLM)
- Ограничение частоты вызовов LLM (настраиваемый интервал, ответ 429 + UI cooldown)
- Плановый матчинг, аналитика, избранное и статусы по вакансиям
- Live-статусы процессов (парсинг/AI-анализ), страница «Процессы и логи», фильтры по ожиданию/ошибкам
- Удаление вакансий: точечно и массово (очистка всех)
- Опционально: Telegram, вебхук алертов при ошибках синка
- API с префиксом **`/api/v1`** (дублирование маршрутов на **`/api`** для совместимости), health: **`GET /api/health`**
- Аутентификация API: заголовок **`X-API-Key`** или **`Authorization: Bearer <key>`** (`ADMIN_API_KEYS` в `.env`)

## Стек

| Слой        | Технологии |
|------------|------------|
| Backend    | Python 3.11+, FastAPI, Uvicorn, SQLAlchemy 2, Alembic, PostgreSQL (psycopg 3), APScheduler, httpx |
| Данные / AI | Pydantic v2, pydantic-settings, **orjson**, **json-repair**; извлечение текста из резюме: **pypdf**, **python-docx** |
| Frontend   | Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS 4, shadcn/ui (Radix), react-hook-form + zod, react-markdown |
| Инфра      | Docker Compose, nginx (шаблоны + `envsubst`), опционально TLS |

Подробнее про локальный запуск только API — в [`backend/README.md`](backend/README.md).

## Структура репозитория

```
.
├── backend/           # FastAPI-приложение, Alembic, pyproject.toml (пакет find-work-api)
├── front/             # Next.js (App Router)
├── nginx/             # Dockerfile, шаблоны конфигов, точка монтирования сертификатов
├── scripts/           # Вспомогательные скрипты (например backup_postgres.sh)
├── docker-compose.yml
├── .env.example       # Шаблон переменных окружения (скопировать в .env)
└── README.md
```

## Backend: устройство кода

- **`app/main.py`** — точка входа FastAPI, CORS, подключение роутеров, lifespan (планировщик).
- **`app/routers/`** — HTTP: вакансии, сохранённые поиски, настройки, резюме, синк, аналитика, процессы, LLM status.
- **`app/services/`** — интеграции: hh.ru, LLM, синхронизация, матчинг, Telegram, разбор файлов резюме и др.
- **`app/prompts/`**, **`keyword_taxonomy_v15.py`** — промпты и таксономия для структурированного вывода моделей.
- **`alembic/`** — миграции схемы БД.

Форматирование и линт: **Black** и **Ruff** (длина строки 120), см. `[tool.ruff]` / `[tool.black]` в `backend/pyproject.toml`.

## Быстрый старт (Docker)

1. Склонируйте репозиторий и перейдите в каталог проекта.

2. Создайте файл окружения:

   ```bash
   cp .env.example .env
   ```

   Обязательно задайте **`ADMIN_API_KEYS`**, **`HH_USER_AGENT`** (с контактом по правилам hh.ru), при необходимости **`DATABASE_URL`** и ключи LLM.

3. Запустите стек:

   ```bash
   docker compose up -d --build
   ```

4. Дождитесь healthy-статусов сервисов. По умолчанию UI и API доступны через nginx:

   - **Дашборд:** `http://localhost:8080` (или `http://<ваш_IP>:<HTTP_PORT>`)
   - **Health API:** `http://localhost:8080/api/health`

5. Войдите в приложение, введя один из ключей из `ADMIN_API_KEYS` (хранится в `localStorage` как API key).

Миграции БД выполняются при старте контейнера API (`alembic upgrade head` в entrypoint).

### Контейнер `api` сразу выходит с кодом 1

Чаще всего миграции не могут подключиться к PostgreSQL. В **`.env` не задавайте `DATABASE_URL` с `localhost` для сценария Docker** — внутри сети Compose хост БД — сервис `db`. В текущем `docker-compose.yml` URL для API собирается автоматически из `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB`.

Просмотр ошибки:

```bash
docker compose logs api
```

Логи nginx: **`docker compose logs nginx`** (имя **сервиса** из `docker-compose.yml`, не имя контейнера).

Если в логах была ошибка миграции (`DuplicateObject`, «таблица уже существует») и база в неизвестном состоянии, проще всего **сбросить том PostgreSQL** (данные удалятся) и поднять заново:

```bash
docker compose down -v
docker compose up -d --build
```

## Доступ из интернета

1. В **`.env`** укажите реальный публичный адрес:

   - **`PUBLIC_URL`** — тот же origin, с которого открываете сайт в браузере (например `http://203.0.113.10:8080`).
   - **`CORS_ALLOWED_ORIGINS`** — список через запятую, **обязательно** включите тот же origin, иначе браузер заблокирует запросы к API.

2. Проброс портов и фаервол: откройте **`HTTP_PORT`** на хосте/роутере. Проброс HTTPS в базовом `docker-compose.yml` **не задаётся** (чтобы не занимать 8443 впустую). Для TLS см. ниже.

3. **`NGINX_BIND=0.0.0.0`** (значение по умолчанию в `docker-compose`) — nginx слушает на всех интерфейсах хоста. Для привязки только к одному IP задайте, например, `NGINX_BIND=203.0.113.10`.

4. **`NGINX_SERVER_NAMES`:** по умолчанию **`_`** (подходит для захода по IP). Для домена: `NGINX_SERVER_NAMES=jobs.example.com`.

5. **HTTPS:** PEM в **`./nginx/certs`**, **`ENABLE_NGINX_SSL=1`**, затем поднимите с пробросом 443, например:
   ```bash
   docker compose -f docker-compose.yml -f docker-compose.ssl-ports.yml up -d
   ```
   При занятом **`HTTPS_PORT`** (по умолчанию 8443) задайте в `.env` другой, например `HTTPS_PORT=9443`.

## Локальная разработка (без полного Compose)

### Backend

```bash
cd backend
python -m venv .venv
# Windows: .venv\Scripts\activate
source .venv/bin/activate   # Linux / macOS
pip install -e .
# Поднимите PostgreSQL и задайте DATABASE_URL в .env или окружении
alembic upgrade head
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

### Frontend

```bash
cd front
pnpm install   # или npm install
# В .env.local задайте NEXT_PUBLIC_API_BASE=http://127.0.0.1:8000/api/v1 при прямом доступе к uvicorn
pnpm dev
```

Сборка образа фронта в Compose подставляет **`NEXT_PUBLIC_APP_URL`** и **`NEXT_PUBLIC_API_BASE`** из `.env` на этапе build.

## Переменные окружения

Полный перечень и комментарии — в **[`.env.example`](.env.example)**. Кратко:

| Группа | Примеры переменных |
|--------|-------------------|
| Публичный доступ | `PUBLIC_URL`, `HTTP_PORT`, `NGINX_BIND`, `NGINX_SERVER_NAMES`, `CORS_ALLOWED_ORIGINS` |
| Безопасность | `ADMIN_API_KEYS` |
| БД | `DATABASE_URL`, `POSTGRES_*` |
| hh.ru | `HH_USER_AGENT`, `HH_BASE_URL`, `HH_FETCH_VACANCY_DETAIL` |
| LLM | `LLM_PROVIDER`, `OPENAI_*`, `GIGACHAT_AUTHORIZATION_KEY` (ключ из кабинета GigaChat), `GIGACHAT_*`, `DEFAULT_LLM_MIN_INTERVAL_SECONDS` |
| Опции | `TELEGRAM_*`, `ALERT_WEBHOOK_URL` |

Файл **`.env`** в репозиторий не коммитится (см. `.gitignore`).

## Приоритет API-ключей LLM

Для OpenAI и GigaChat используется единое правило:

1. Если ключ задан в **`.env`** → используется значение из env.
2. Если в env пусто → используется ключ, сохранённый в настройках UI (БД `app_setting`).

Это позволяет держать прод-ключи в окружении и использовать UI-ключи как fallback.

## Резервное копирование БД

На хосте с установленным Docker Compose можно использовать скрипт (путь и имя дампа смотрите внутри файла):

```bash
chmod +x scripts/backup_postgres.sh
./scripts/backup_postgres.sh
```

## API (кратко)

- Префикс для защищённых маршрутов: **`/api/v1`** (дублирование на **`/api`**).
- Примеры: `GET /api/v1/vacancies`, `GET /api/v1/settings`, `PUT /api/v1/resume`, `GET /api/v1/resumes`, `POST /api/v1/resumes`, `GET /api/v1/llm/status`.
- Процессы и логи:
  - `GET /api/v1/process/status` — активный процесс (или ожидание автоанализа)
  - `GET /api/v1/process/logs?limit=150` — таймлайн событий парсинга/AI-анализа
- Управление вакансиями:
  - `DELETE /api/v1/vacancies/{id}` — удалить одну вакансию
  - `POST /api/v1/data/clear-vacancies` — удалить все вакансии
- Документация в режиме разработки: `http://127.0.0.1:8000/docs` (при прямом запуске uvicorn).

## Автоанализ: как работает

- Переключатель `autoAnalyze` включается в настройках UI.
- Планировщик тикает каждую минуту и запускает пакетный AI-анализ по интервалу `matchAnalysisIntervalMinutes`.
- Лимит частоты LLM контролируется `llmMinIntervalSeconds`.
- По умолчанию анализ идёт батчами (`BATCH_LIMIT = 5`), поэтому большой объём (например 200 вакансий) обрабатывается в несколько циклов.
- Текущий статус/ожидание видно в верхнем индикаторе и на странице «Процессы и логи».

## Тесты

Автоматический набор `pytest` в репозитории пока не подключён; при расширении логики API, парсеров и интеграций с LLM разумно добавить модульные тесты и моки внешних вызовов.

## Безопасность

- Смените **`ADMIN_API_KEYS`** и пароли PostgreSQL перед выкладкой в прод.
- Не публикуйте **`.env`** и ключи LLM/Telegram.
- Ограничьте доступ к портам nginx на уровне фаервола и по возможности используйте HTTPS.

## Лицензия

Укажите лицензию при публикации (файл `LICENSE` при необходимости добавьте отдельно).

# Find Work — дашборд поиска работы

Full-stack приложение для сбора вакансий (hh.ru), хранения в PostgreSQL, анализа совпадения с резюме через LLM (OpenAI / GigaChat), уведомлений и Telegram. Веб-интерфейс на Next.js, API на FastAPI, обратный прокси — nginx в Docker.

## Возможности

- Синхронизация вакансий по сохранённым поискам (публичное API hh.ru), TTL и логи синка
- Резюме (несколько записей через API), редактирование в UI, модалка полного текста
- Анализ вакансии vs резюме (structured JSON, таксономия категорий v15), сопроводительные письма
- Ограничение частоты вызовов LLM (настраиваемый интервал, ответ 429 + UI cooldown)
- Плановый матчинг, аналитика, избранное и статусы по вакансиям
- Опционально: Telegram, вебхук алертов при ошибках синка
- API с префиксом **`/api/v1`** (дублирование маршрутов на **`/api`** для совместимости), health: **`GET /api/health`**
- Аутентификация API: заголовок **`X-API-Key`** или **`Authorization: Bearer <key>`** (`ADMIN_API_KEYS` в `.env`)

## Стек

| Слой        | Технологии |
|------------|------------|
| Backend    | Python 3.11+, FastAPI, SQLAlchemy 2, Alembic, PostgreSQL, APScheduler, httpx |
| Frontend   | Next.js 16, React 19, TypeScript, Tailwind, shadcn/ui |
| Инфра      | Docker Compose, nginx (шаблоны + `envsubst`), optional TLS |

## Структура репозитория

```
find_work/
├── backend/           # FastAPI-приложение, Alembic, pyproject.toml
├── front/             # Next.js (App Router)
├── nginx/             # Dockerfile, шаблоны конфигов, точка монтирования сертификатов
├── scripts/           # Вспомогательные скрипты (например backup_postgres.sh)
├── docker-compose.yml
├── .env.example       # Шаблон переменных окружения (скопировать в .env)
├── Agent.md           # Расширенное ТЗ / чеклисты (опорная документация)
└── README.md
```

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

## Доступ из интернета

1. В **`.env`** укажите реальный публичный адрес:

   - **`PUBLIC_URL`** — тот же origin, с которого открываете сайт в браузере (например `http://203.0.113.10:8080`).
   - **`CORS_ALLOWED_ORIGINS`** — список через запятую, **обязательно** включите тот же origin, иначе браузер заблокирует запросы к API.

2. Проброс портов и фаервол: откройте **`HTTP_PORT`** (и при HTTPS — **`HTTPS_PORT`**) на хосте/роутере.

3. **`NGINX_BIND=0.0.0.0`** (значение по умолчанию в `docker-compose`) — nginx слушает на всех интерфейсах хоста. Для привязки только к одному IP задайте, например, `NGINX_BIND=203.0.113.10`.

4. **`NGINX_SERVER_NAMES`:** по умолчанию **`_`** (подходит для захода по IP). Для домена: `NGINX_SERVER_NAMES=jobs.example.com`.

5. HTTPS: положите PEM в **`./nginx/certs`**, в **`.env`** установите **`ENABLE_NGINX_SSL=1`** и при необходимости скорректируйте пути сертификатов (см. `.env.example`).

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

## Резервное копирование БД

На хосте с установленным Docker Compose можно использовать скрипт (путь и имя дампа смотрите внутри файла):

```bash
chmod +x scripts/backup_postgres.sh
./scripts/backup_postgres.sh
```

## API (кратко)

- Префикс для защищённых маршрутов: **`/api/v1`** (дублирование на **`/api`**).
- Примеры: `GET /api/v1/vacancies`, `GET /api/v1/settings`, `PUT /api/v1/resume`, `GET /api/v1/resumes`, `POST /api/v1/resumes`, `GET /api/v1/llm/status`.
- Документация в режиме разработки: `http://127.0.0.1:8000/docs` (при прямом запуске uvicorn).

## Безопасность

- Смените **`ADMIN_API_KEYS`** и пароли PostgreSQL перед выкладкой в прод.
- Не публикуйте **`.env`** и ключи LLM/Telegram.
- Ограничьте доступ к портам nginx на уровне фаервола и по возможности используйте HTTPS.

## Дополнительная документация

- **[`Agent.md`](Agent.md)** — цели проекта, этапы и детальные чеклисты.

## Лицензия

Укажите лицензию при публикации (файл `LICENSE` при необходимости добавьте отдельно).

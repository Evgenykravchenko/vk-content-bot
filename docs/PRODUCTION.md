# Production на Raspberry Pi

Production-стек запускает отдельные PostgreSQL, Redis и Directus для контентной платформы. Он не подключается к Docker-сетям BotCRM, n8n, сайтов и других проектов сервера.

CMS доступна через отдельный узел Tailscale Funnel:

```text
https://bot-content-cms.tailcc0b45.ts.net
```

Порты PostgreSQL, Redis и Directus на Raspberry Pi не публикуются. HTTPS завершается внутри Tailscale. Редакторы входят в Directus по обычным email и паролю.

## Что запускается

- `database` — отдельная база контентной платформы;
- `cache` — кеш и IP rate limiting Directus;
- `directus` — единая CMS;
- `cms-bootstrap` — создаёт пустую структуру коллекций и отключает блокировку конкретного аккаунта по числу неверных паролей;
- `tailscale` — отдельный публичный HTTPS-адрес через Funnel.

Демонстрационный контент не создаётся. Яндекс Диск используется только как источник медиа для ботов; резервное копирование на него не настраивается.

## Первый запуск

На сервере проект располагается в `/opt/vk-content-bot`. Секреты находятся только в `/opt/vk-content-bot/.env.production` с правами `600`.

```bash
cd /opt/vk-content-bot
docker compose --env-file .env.production -f compose.production.yaml up -d
```

При первом запуске новый контейнер Tailscale необходимо один раз авторизовать в существующем tailnet. Его состояние сохраняется в Docker volume, поэтому повторная авторизация после перезапусков не требуется.

## Проверка

```bash
docker compose --env-file .env.production -f compose.production.yaml ps
docker compose --env-file .env.production -f compose.production.yaml logs --tail=100 directus cms-bootstrap tailscale
```

Ожидаемый результат:

- `database`, `cache` и `directus` имеют статус `healthy`;
- `cms-bootstrap` завершился с кодом `0`;
- `tailscale` работает и показывает Funnel на порту `443`;
- `/server/health` отвечает `ok`;
- после входа списки контента пусты.

## Обновление

Перед обновлением проверьте изменения Compose и образов, затем выполните:

```bash
cd /opt/vk-content-bot
docker compose --env-file .env.production -f compose.production.yaml pull
docker compose --env-file .env.production -f compose.production.yaml up -d --remove-orphans
docker compose --env-file .env.production -f compose.production.yaml ps
```

Команда не перезапускает BotCRM и другие Compose-проекты.

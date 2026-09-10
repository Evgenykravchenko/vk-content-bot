# Production deployment

## Контракт

- CMS запущена из `bot-platform-infra`.
- Docker-сеть `bot_platform_backend` существует.
- Бот лежит в `/opt/vk-content-bot`.
- Секреты лежат в `/etc/bot-platform/bots/vk-content-bot.env` с правами `600`.
- `BOT_VERSION` содержит точную SemVer-версию, а не `latest`.

## Первая выкатка

```bash
sudo install -d -m 750 -o "$USER" /opt/vk-content-bot
sudo install -d -m 750 -o "$USER" /etc/bot-platform/bots
sudo install -m 600 -o "$USER" deploy/vk-content-bot.env.example \
  /etc/bot-platform/bots/vk-content-bot.env
```

Заполните production env на сервере. Затем:

```bash
cd /opt/vk-content-bot
./scripts/deploy.sh
```

## Проверка

```bash
cd /opt/vk-content-bot
./scripts/status.sh
docker inspect --format '{{.State.Health.Status}}' vk-content-bot-bot-1
```

В логах должны появиться `VK bot started` с правильным `groupId` и `contentBotKey`.

## Обновление

1. Создайте обычный PR с Conventional Commits.
2. Дождитесь зелёного CI.
3. Объедините Release Please PR.
4. Дождитесь публикации GHCR-образа.
5. Запустите **Deploy production** и введите версию без `v`, например `0.2.0`.

Выкладка имеет отдельный concurrency lock и не отменяет уже идущий deployment.

## Rollback

В `/etc/bot-platform/bots/vk-content-bot.env` верните предыдущую версию:

```dotenv
BOT_VERSION=0.1.0
```

Затем:

```bash
cd /opt/vk-content-bot
./scripts/deploy.sh
```

Откат бота не меняет базу CMS и не затрагивает BotCRM.

## Если GHCR-образ приватный

Один раз выполните на сервере:

```bash
docker login ghcr.io -u Evgenykravchenko
```

Введите PAT с минимальным правом `read:packages`. Токен не нужно добавлять в env-файл.

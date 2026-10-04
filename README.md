# QUADRANT - сайт ванильного Minecraft-сервера

```
node server.js        # без npm install, нужен Node 18+
```
Сайт: `http://localhost:3000`, админ-панель: `/admin`.

## Переменные окружения
| Переменная | Что делает |
|---|---|
| `PORT` | порт сайта (3000) |
| `PUBLIC_URL` | публичный адрес сайта, например `https://quadrant-mc.ru` (нужен для Discord) |
| `SERVER_IP` | IP для игроков, показывается на сайте |
| `ADMIN_TOKEN` | длинный секретный токен для входа в админку |
| `MC_HOST`, `MC_PORT` | адрес Minecraft-сервера для статуса онлайна |
| `RCON_HOST`, `RCON_PORT`, `RCON_PASSWORD` | RCON: вайтлист, баны, кики и консоль в админке |
| `WHITELIST_FILE` | путь к `whitelist.json`, если RCON не используется |
| `AUTO_WHITELIST=1` | добавлять в вайтлист сразу после проверки Discord |
| `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET` | приложение Discord (discord.com/developers) |
| `DISCORD_GUILD_ID` | ID вашего Discord-сервера |
| `DISCORD_INVITE` | ссылка-приглашение (по умолчанию `https://discord.gg/HnuYyrVPmS`) |
| `DISCORD_BOT_TOKEN` | необязательно: бот сам добавит игрока на сервер при привязке |
| `MAP_URL` | адрес веб-карты (BlueMap/squaremap/Dynmap), встраивается на странице «Карта» |
| `MAP_ENGINE` | подпись движка карты на баннере (по умолчанию `BlueMap`) |
| `STATS_DIR` | путь к `world/stats` сервера - для «Игрового времени» в профиле |

## Discord-верификация
1. Создайте приложение на discord.com/developers → OAuth2 → Redirect: `PUBLIC_URL/api/discord/callback`.
2. Укажите `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `DISCORD_GUILD_ID`, `DISCORD_INVITE`.
3. Игрок регистрируется → нажимает «Привязать Discord» → сайт проверяет, что он на вашем сервере.
4. Дальше - авто-вайтлист (`AUTO_WHITELIST=1`) или одобрение в админке.

## Страницы
`public/`: `index.html` (главная), `about`, `start`, `rules`, `faq`, `map`, `shop`, `profile` - открываются по чистым адресам (`/shop`, `/profile`).
Общие стили и скрипты - `public/assets/style.css` и `public/assets/app.js` (шапка, подвал, вход, демо-режим без сервера).

## Магазин
Товары хранятся в `data/products.json`, их цены, скидки, бейджи и видимость меняются в админке → «Товары».
Покупка создаёт заказ (`data/orders.json`) со статусом «Ждёт оплаты». **Платёжка не подключена:** в `server.js` в обработчике `/api/order`
создайте платёж (ЮKassa, CloudPayments и т.п.) и верните `payUrl` - сайт перенаправит игрока на оплату.
Статусы заказов меняются в админке → «Заказы»; статус «Выдан» для QUADRANT+ продлевает подписку автоматически.

## Minecraft
В `server.properties`: `white-list=true`, `enforce-whitelist=true`, `enable-rcon=true`, `rcon.password=...`.

## Данные
`data/users.json` (пароли - scrypt с солью) и `data/state.json` (объявление, журнал). Делайте бэкапы папки `data`.
Сессии хранятся в памяти: после перезапуска игрокам нужно войти заново.
Название, IP и ссылка на Discord - объект `CONFIG` в начале `public/assets/app.js`.

## Тестовый запуск на GitHub + Vercel
1. Залейте папку `quadrant` в репозиторий GitHub (папка `data` в `.gitignore` - там пароли и сессии).
2. На vercel.com: **Add New → Project → Import** репозиторий. Framework Preset - **Other**, больше ничего не меняйте - настройки уже в `vercel.json`.
3. Vercel показывает только папку `public` и **не запускает `server.js`**. Сайт сам перейдёт в демо-режим: аккаунты и заказы хранятся только в браузере тестирующего, админки и статуса сервера нет.
4. Для настоящего запуска (регистрация, вайтлист, админка) нужен хостинг, где можно держать запущенным `node server.js` (VPS, Railway, Render и т.п.).

## База данных на Vercel (v3)
1. Залейте проект на GitHub и импортируйте его в Vercel (Framework: Other).
2. В проекте Vercel: Storage (или Marketplace) -> Upstash Redis -> Create -> Connect to Project.
   Vercel сам добавит переменные KV_REST_API_URL и KV_REST_API_TOKEN.
3. Deployments -> Redeploy.
4. Зарегистрируйтесь на сайте с ником ccotan и почтой ccotanno@gmail.com - аккаунт автоматически станет админом,
   и справа от "Магазин" появится кнопка "Админ-панель".

Дополнительные переменные (необязательно): OWNERS="nick:email,nick2:email2", ADMIN_TOKEN, PUBLIC_URL, MC_HOST, DISCORD_*.
Локально: node server.js (данные хранятся в data/db.json).

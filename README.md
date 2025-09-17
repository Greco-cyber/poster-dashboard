# Poster Employee Dashboard

Одностраничное приложение для отображения информации о сотрудниках на смене с данными из Poster API.

## Функциональность

- ✅ Отображение сотрудников, которые сейчас на смене  
- ✅ Выручка каждого сотрудника за текущий день
- ✅ Количество обработанных чеков
- ✅ Расчет среднего чека
- ✅ Адаптивный дизайн для всех устройств
- ✅ Автоматическое обновление данных

## Технологии

- React 18
- Tailwind CSS
- Lucide React Icons
- Poster API

## Настройка переменных окружения

В настройках Render добавьте следующие переменные:

```
REACT_APP_POSTER_TOKEN=ваш_токен_poster_api
REACT_APP_POSTER_ACCOUNT=название_вашего_аккаунта
REACT_APP_POSTER_BASE_URL=https://ваш-аккаунт.joinposter.com/api (опционально)
```

## Развертывание на Render

1. Подключите репозиторий к Render
2. Выберите тип: **Static Site**
3. Настройки сборки:
   - **Build Command:** `npm install && npm run build`
   - **Publish Directory:** `build`
4. Добавьте переменные окружения
5. Деплой!

## Локальная разработка

```bash
# Установка зависимостей
npm install

# Создать файл .env.local с переменными:
# REACT_APP_POSTER_TOKEN=ваш_токен
# REACT_APP_POSTER_ACCOUNT=ваш_аккаунт

# Запуск в режиме разработки
npm start
```

## Структура проекта

```
poster-employee-dashboard/
├── public/
│   └── index.html
├── src/
│   ├── App.js          # Основной компонент
│   ├── index.js        # Точка входа
│   └── index.css       # Базовые стили
├── package.json        # Зависимости
└── README.md          # Документация
```

## API Endpoints

Приложение использует следующие методы Poster API:

- `access.getEmployees` - получение списка сотрудников
- `dash.getTransactionStats` - статистика продаж по сотрудникам

## Безопасность

- ✅ API токены хранятся в переменных окружения
- ✅ Никаких секретов в коде
- ✅ HTTPS для всех запросов к API

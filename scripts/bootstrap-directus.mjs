const baseUrl = process.env.DIRECTUS_URL ?? 'http://localhost:8055';
const token = process.env.DIRECTUS_TOKEN;

if (!token) {
  throw new Error('DIRECTUS_TOKEN is required');
}

async function request(path, init = {}) {
  const response = await fetch(new URL(path, baseUrl), {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...init.headers,
    },
  });

  if (!response.ok) {
    const body = await response.text();
    const error = new Error(`${init.method ?? 'GET'} ${path}: ${response.status} ${body}`);
    error.status = response.status;
    throw error;
  }

  if (response.status === 204) return null;
  return response.json();
}

async function waitForDirectus() {
  for (let attempt = 1; attempt <= 60; attempt += 1) {
    try {
      const response = await fetch(new URL('/server/health', baseUrl));
      if (response.ok) return;
    } catch {
      // Directus is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error('Directus did not become healthy in time');
}

async function ensureCollection(collection, meta) {
  try {
    await request(`/collections/${collection}`);
    return;
  } catch (error) {
    if (error.status !== 403 && error.status !== 404) throw error;
  }

  await request('/collections', {
    method: 'POST',
    body: JSON.stringify({
      collection,
      meta: {
        singleton: false,
        accountability: 'all',
        ...meta,
      },
      schema: { name: collection },
      fields: [
        {
          field: 'id',
          type: 'integer',
          meta: { hidden: true, readonly: true, interface: 'input' },
          schema: {
            is_primary_key: true,
            has_auto_increment: true,
            is_nullable: false,
          },
        },
      ],
    }),
  });
  console.log(`Created collection: ${collection}`);
}

async function ensureField(collection, definition) {
  try {
    await request(`/fields/${collection}/${definition.field}`);
    return;
  } catch (error) {
    if (error.status !== 403 && error.status !== 404) throw error;
  }

  await request(`/fields/${collection}`, {
    method: 'POST',
    body: JSON.stringify(definition),
  });
  console.log(`Created field: ${collection}.${definition.field}`);
}

async function ensureRelation(definition) {
  const existing = await request('/relations');
  const relationExists = existing.data.some(
    (relation) =>
      relation.collection === definition.collection && relation.field === definition.field,
  );
  if (relationExists) return;

  await request('/relations', {
    method: 'POST',
    body: JSON.stringify(definition),
  });
  console.log(`Created relation: ${definition.collection}.${definition.field}`);
}

function stringField(field, note, options = {}) {
  return {
    field,
    type: 'string',
    meta: {
      interface: options.interface ?? 'input',
      note,
      required: options.required ?? false,
      options: options.options,
      width: options.width ?? 'full',
    },
    schema: {
      is_nullable: !(options.required ?? false),
      max_length: options.maxLength ?? 255,
      default_value: options.defaultValue ?? null,
    },
  };
}

function textField(field, note) {
  return {
    field,
    type: 'text',
    meta: { interface: 'input-multiline', note, width: 'full' },
    schema: { is_nullable: true },
  };
}

function booleanField(field, note, defaultValue = true) {
  return {
    field,
    type: 'boolean',
    meta: { interface: 'boolean', note, width: 'half' },
    schema: { is_nullable: false, default_value: defaultValue },
  };
}

function integerField(field, note, defaultValue = null) {
  return {
    field,
    type: 'integer',
    meta: { interface: 'input', note, width: 'half' },
    schema: { is_nullable: defaultValue === null, default_value: defaultValue },
  };
}

function selectField(field, note, choices, defaultValue) {
  return stringField(field, note, {
    interface: 'select-dropdown',
    required: true,
    defaultValue,
    options: {
      choices: choices.map(([text, value]) => ({ text, value })),
    },
  });
}

async function findFirst(collection, filters) {
  const query = new URLSearchParams({ limit: '1' });
  for (const [field, value] of Object.entries(filters)) {
    query.set(`filter[${field}][_eq]`, String(value));
  }
  const result = await request(`/items/${collection}?${query.toString()}`);
  return result.data[0] ?? null;
}

async function createItem(collection, data) {
  const result = await request(`/items/${collection}`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
  return result.data;
}

async function createSchema() {
  await ensureCollection('responses', {
    icon: 'forum',
    note: 'Готовые сценарии ответа пользователю',
    display_template: '{{name}}',
    sort_field: null,
  });
  await ensureCollection('media_assets', {
    icon: 'perm_media',
    note: 'Файлы на Яндекс Диске и подготовленные вложения VK',
    display_template: '{{name}} — {{status}}',
  });
  await ensureCollection('keywords', {
    icon: 'key',
    note: 'Ключевые фразы и правила их сопоставления',
    display_template: '{{phrase}}',
  });
  await ensureCollection('response_blocks', {
    icon: 'view_agenda',
    note: 'Упорядоченные текстовые и медиа-блоки ответа',
    display_template: '{{sort}}. {{kind}}',
    sort_field: 'sort',
  });
  await ensureCollection('response_buttons', {
    icon: 'smart_button',
    note: 'Кнопки-команды и кнопки-ссылки под ответами',
    display_template: '{{label}}',
    sort_field: 'sort',
  });

  const responseFields = [
    stringField('name', 'Внутреннее понятное название ответа', { required: true }),
    selectField(
      'status',
      'Пользователям выдаются только опубликованные ответы',
      [
        ['Черновик', 'draft'],
        ['Опубликован', 'published'],
      ],
      'draft',
    ),
    textField('fallback_text', 'Текст на случай, если все блоки ответа пусты'),
  ];

  const mediaFields = [
    stringField('name', 'Понятное название материала', { required: true }),
    selectField(
      'kind',
      'Как материал будет загружен во VK',
      [
        ['Фотография', 'photo'],
        ['Видео', 'video'],
        ['Аудиофайл', 'audio'],
        ['Документ', 'document'],
      ],
      'document',
    ),
    stringField('yandex_path', 'Полный путь на Яндекс Диске, например /VK Bot/video.mp4', {
      required: true,
    }),
    selectField(
      'status',
      'Чтобы подготовить файл, выберите «В очереди»',
      [
        ['Черновик', 'draft'],
        ['В очереди', 'queued'],
        ['Обрабатывается', 'processing'],
        ['Готов', 'ready'],
        ['Ошибка', 'error'],
      ],
      'draft',
    ),
    stringField('vk_attachment', 'Идентификатор готового вложения VK', { width: 'full' }),
    stringField('mime_type', 'MIME-тип исходного файла', { width: 'half' }),
    {
      field: 'file_size',
      type: 'bigInteger',
      meta: { interface: 'input', note: 'Размер файла в байтах', width: 'half' },
      schema: { is_nullable: true },
    },
    textField('error_message', 'Последняя ошибка подготовки'),
  ];

  const keywordFields = [
    stringField('phrase', 'Фраза без кавычек, например: получить каталог', { required: true }),
    selectField(
      'match_mode',
      'Как сравнивать сообщение пользователя с фразой',
      [
        ['Точное совпадение', 'exact'],
        ['Содержит фразу', 'contains'],
        ['Любое слово', 'any_word'],
        ['Все слова', 'all_words'],
      ],
      'contains',
    ),
    integerField('priority', 'Более высокий приоритет побеждает при нескольких совпадениях', 100),
    booleanField('enabled', 'Правило участвует в поиске', true),
    {
      field: 'response',
      type: 'integer',
      meta: {
        interface: 'select-dropdown-m2o',
        display: 'related-values',
        display_options: { template: '{{name}}' },
        required: true,
        width: 'full',
      },
      schema: { is_nullable: false },
    },
  ];

  const blockFields = [
    {
      field: 'response',
      type: 'integer',
      meta: {
        interface: 'select-dropdown-m2o',
        display: 'related-values',
        display_options: { template: '{{name}}' },
        required: true,
        width: 'full',
      },
      schema: { is_nullable: false },
    },
    integerField('sort', 'Порядок блока: 10, 20, 30…', 10),
    selectField(
      'kind',
      'Тип содержимого блока',
      [
        ['Текст', 'text'],
        ['Фотография', 'photo'],
        ['Видео', 'video'],
        ['Аудиофайл', 'audio'],
        ['Документ', 'document'],
      ],
      'text',
    ),
    textField('body', 'Текст блока; для медиа можно оставить пустым'),
    {
      field: 'media',
      type: 'integer',
      meta: {
        interface: 'select-dropdown-m2o',
        display: 'related-values',
        display_options: { template: '{{name}} — {{status}}' },
        note: 'Выберите материал для фото, видео, аудио или документа',
        width: 'full',
      },
      schema: { is_nullable: true },
    },
    booleanField('send_separately', 'Отправить этот блок отдельным сообщением', false),
    booleanField('enabled', 'Блок включён', true),
  ];

  const buttonFields = [
    {
      field: 'response',
      type: 'integer',
      meta: {
        interface: 'select-dropdown-m2o',
        display: 'related-values',
        display_options: { template: '{{name}}' },
        required: true,
        width: 'full',
      },
      schema: { is_nullable: false },
    },
    stringField('label', 'Видимая подпись, не больше 40 символов', {
      required: true,
      maxLength: 40,
    }),
    selectField(
      'action',
      'Команда откроет другой ответ бота, ссылка откроет URL',
      [
        ['Команда', 'text'],
        ['Ссылка', 'open_link'],
      ],
      'text',
    ),
    stringField(
      'target',
      'Для команды — ключевая фраза; для ссылки — полный https://-URL',
      { required: true },
    ),
    selectField(
      'color',
      'Цвет кнопки-команды; для ссылки VK выберет оформление сам',
      [
        ['Синий', 'primary'],
        ['Серый', 'secondary'],
        ['Зелёный', 'positive'],
        ['Красный', 'negative'],
      ],
      'primary',
    ),
    integerField('row_number', 'Ряд кнопки: от 1 до 6', 1),
    integerField('sort', 'Порядок внутри ряда: 10, 20, 30…', 10),
    booleanField('enabled', 'Кнопка включена', true),
  ];

  for (const field of responseFields) await ensureField('responses', field);
  for (const field of mediaFields) await ensureField('media_assets', field);
  for (const field of keywordFields) await ensureField('keywords', field);
  for (const field of blockFields) await ensureField('response_blocks', field);
  for (const field of buttonFields) await ensureField('response_buttons', field);

  await ensureRelation({
    collection: 'keywords',
    field: 'response',
    related_collection: 'responses',
    schema: { on_delete: 'CASCADE' },
    meta: {
      many_collection: 'keywords',
      many_field: 'response',
      one_collection: 'responses',
      one_field: null,
    },
  });
  await ensureRelation({
    collection: 'response_blocks',
    field: 'response',
    related_collection: 'responses',
    schema: { on_delete: 'CASCADE' },
    meta: {
      many_collection: 'response_blocks',
      many_field: 'response',
      one_collection: 'responses',
      one_field: null,
    },
  });
  await ensureRelation({
    collection: 'response_blocks',
    field: 'media',
    related_collection: 'media_assets',
    schema: { on_delete: 'SET NULL' },
    meta: {
      many_collection: 'response_blocks',
      many_field: 'media',
      one_collection: 'media_assets',
      one_field: null,
    },
  });
  await ensureRelation({
    collection: 'response_buttons',
    field: 'response',
    related_collection: 'responses',
    schema: { on_delete: 'CASCADE' },
    meta: {
      many_collection: 'response_buttons',
      many_field: 'response',
      one_collection: 'responses',
      one_field: null,
    },
  });
}

async function seedDemo() {
  let demoResponse = await findFirst('responses', { name: 'Справка по боту' });
  if (!demoResponse) {
    demoResponse = await createItem('responses', {
      name: 'Справка по боту',
      status: 'published',
      fallback_text: 'Напишите ключевое слово, чтобы получить материал.',
    });
  }

  const existingBlock = await findFirst('response_blocks', {
    response: demoResponse.id,
    sort: 10,
  });
  if (!existingBlock) {
    await createItem('response_blocks', {
      response: demoResponse.id,
      sort: 10,
      kind: 'text',
      body: 'Бот работает. Добавьте свои ключевые слова и ответы в Directus.',
      send_separately: false,
      enabled: true,
    });
  }

  const existingKeyword = await findFirst('keywords', { phrase: 'помощь' });
  if (!existingKeyword) {
    await createItem('keywords', {
      phrase: 'помощь',
      match_mode: 'exact',
      priority: 1000,
      response: demoResponse.id,
      enabled: true,
    });
  }
}

await waitForDirectus();
await createSchema();
await seedDemo();
console.log('Directus schema is ready.');
